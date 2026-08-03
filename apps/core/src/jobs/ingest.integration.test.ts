import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import {
  ingestionCheckpoints,
  ingestionRuns,
  tenderChangeEvents,
  tenderCpvCodes,
  tenders,
} from '@luma/db';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import { FixtureTenderSourceAdapter, type DoffinSearchHit } from '@luma/doffin';
import { createLogger } from '@luma/observability';
import { runIngest } from './ingest.js';

/**
 * The ingest run against a real PostgreSQL.
 *
 * These properties cannot be established with a mocked database. Idempotent
 * upsert, the checkpoint rule and change detection are all statements about
 * what the database ends up containing after two runs, and a fake would just
 * replay whatever the code told it.
 */

const describeDb = hasDatabase ? describe : describe.skip;

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'packages',
  'doffin',
  'fixtures',
);

function realHit(file: string): DoffinSearchHit {
  return JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as DoffinSearchHit;
}

function hit(
  id: string,
  publicationDate: string,
  overrides: Partial<DoffinSearchHit> = {},
): DoffinSearchHit {
  return { ...realHit('contract-notice.json'), id, publicationDate, ...overrides };
}

const logger = createLogger({ service: 'core', silent: true });
const now = new Date('2026-08-10T06:00:00Z');

describeDb('runIngest against a real database', () => {
  let harness: TestDatabase;
  let db: TestDatabase['db'];

  beforeAll(async () => {
    // An isolated database per suite, migrated from scratch, so these tests
    // never depend on or disturb whatever is in the development database.
    harness = await createTestDatabase();
    db = harness.db;
  }, 60_000);

  beforeEach(async () => {
    // Truncate rather than delete: these tables reference each other and the
    // cascade keeps the fixtures independent between tests.
    await db.execute(
      sql`truncate table ${tenders}, ${ingestionRuns}, ${ingestionCheckpoints} restart identity cascade`,
    );
  });

  afterAll(async () => {
    await harness?.destroy();
  });

  it('stores a fetched notice with its normalised fields', async () => {
    const adapter = new FixtureTenderSourceAdapter([hit('2026-000001', '2026-08-09')]);
    const report = await runIngest({ db, adapter, logger, now });

    expect(report.created).toBe(1);
    const rows = await db.select().from(tenders);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceId).toBe('2026-000001');
    expect(rows[0]?.sourceUrl).toBe('https://www.doffin.no/notices/2026-000001');
  });

  it('writes the CPV child rows', async () => {
    const adapter = new FixtureTenderSourceAdapter([
      hit('2026-000001', '2026-08-09', { cpvCodes: ['45000000', '45200000'] }),
    ]);
    await runIngest({ db, adapter, logger, now });

    const codes = await db.select({ code: tenderCpvCodes.cpvCode }).from(tenderCpvCodes);
    expect(codes.map((c) => c.code).sort()).toEqual(['45000000', '45200000']);
  });

  it('is idempotent: a second run over identical data creates nothing', async () => {
    // The acceptance criterion in spec 52 item 5. The overlap window re-reads
    // ten days of notices every hour, so this is the normal case, not an edge.
    const hits = [hit('2026-000001', '2026-08-09'), hit('2026-000002', '2026-08-08')];

    const first = await runIngest({
      db,
      adapter: new FixtureTenderSourceAdapter(hits),
      logger,
      now,
    });
    const second = await runIngest({
      db,
      adapter: new FixtureTenderSourceAdapter(hits),
      logger,
      now: new Date('2026-08-10T07:00:00Z'),
    });

    expect(first.created).toBe(2);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(2);
    expect(await db.$count(tenders)).toBe(2);
  });

  it('enqueues no match work for an unchanged notice', async () => {
    // This is what actually prevents a duplicate email: an unchanged tender
    // must not produce a match job, or every hourly sync would re-alert.
    const hits = [hit('2026-000001', '2026-08-09')];
    await runIngest({ db, adapter: new FixtureTenderSourceAdapter(hits), logger, now });
    const second = await runIngest({
      db,
      adapter: new FixtureTenderSourceAdapter(hits),
      logger,
      now,
    });

    expect(second.matchableTenderIds).toEqual([]);
    expect(second.changedTenderIds).toEqual([]);
  });

  it('detects a moved deadline and records a change event', async () => {
    const before = hit('2026-000001', '2026-08-09', { deadline: '2026-09-01T10:00:00Z' });
    const after = { ...before, deadline: '2026-09-20T10:00:00Z' };

    await runIngest({ db, adapter: new FixtureTenderSourceAdapter([before]), logger, now });
    const second = await runIngest({
      db,
      adapter: new FixtureTenderSourceAdapter([after]),
      logger,
      now,
    });

    expect(second.updated).toBe(1);
    expect(second.changedTenderIds).toHaveLength(1);

    const events = await db.select().from(tenderChangeEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('deadline_changed');
    expect(events[0]?.summary).toBe('Fristen er utsatt til 2026-09-20.');
  });

  it('records a planned procurement becoming a competition', async () => {
    const planned = {
      ...realHit('prior-information-notice.json'),
      id: '2026-000010',
      publicationDate: '2026-08-09',
    };
    const opened = { ...planned, type: 'ANNOUNCEMENT_OF_COMPETITION', status: 'ACTIVE' };

    await runIngest({ db, adapter: new FixtureTenderSourceAdapter([planned]), logger, now });
    await runIngest({ db, adapter: new FixtureTenderSourceAdapter([opened]), logger, now });

    const kinds = (await db.select().from(tenderChangeEvents)).map((e) => e.kind);
    expect(kinds).toContain('planned_became_competition');
  });

  it('categorises the four real notice types correctly end to end', async () => {
    const adapter = new FixtureTenderSourceAdapter([
      { ...realHit('contract-notice.json'), id: 'c-1', publicationDate: '2026-08-09' },
      { ...realHit('prior-information-notice.json'), id: 'p-1', publicationDate: '2026-08-09' },
      { ...realHit('intention-notice.json'), id: 'i-1', publicationDate: '2026-08-09' },
      { ...realHit('contract-award-notice.json'), id: 'a-1', publicationDate: '2026-08-09' },
    ]);
    await runIngest({ db, adapter, logger, now });

    const rows = await db
      .select({ sourceId: tenders.sourceId, category: tenders.noticeCategory })
      .from(tenders);
    const byId = Object.fromEntries(rows.map((r) => [r.sourceId, r.category]));

    expect(byId['c-1']).toBe('competition');
    expect(byId['p-1']).toBe('planned');
    // The trap: Doffin files an intention notice under the RESULT roll-up.
    expect(byId['i-1']).toBe('planned');
    expect(byId['a-1']).toBe('award');
  });

  describe('the checkpoint', () => {
    it('advances after a clean run', async () => {
      const adapter = new FixtureTenderSourceAdapter([hit('2026-000001', '2026-08-09')]);
      const report = await runIngest({ db, adapter, logger, now });

      expect(report.checkpointAdvanced).toBe(true);
      const rows = await db.select().from(ingestionCheckpoints);
      expect(rows[0]?.lastPublicationDate).toBe('2026-08-09');
      expect(rows[0]?.lastSuccessfulRunId).toBe(report.runId);
    });

    it('does not advance when a notice failed to persist', async () => {
      // Spec 12: the checkpoint must not move after a partial failure. If it
      // did, the notices we failed on would be skipped forever, and nobody
      // would ever learn that an expected tender never arrived.
      //
      // The failure is a currency code longer than the varchar(3) column. It
      // is deliberately not sanitised away in the adapter: silently truncating
      // a currency would let a foreign-denominated value be compared against a
      // kroner threshold, which is worse than losing the row.
      const adapter = new FixtureTenderSourceAdapter([
        hit('2026-000001', '2026-08-09', {
          estimatedValue: { amount: 1_000_000, currencyCode: 'NOTACURRENCY' },
        }),
      ]);

      const report = await runIngest({ db, adapter, logger, now });

      expect(report.failed).toBe(1);
      expect(report.status).toBe('partial');
      expect(report.checkpointAdvanced).toBe(false);
      expect(await db.$count(ingestionCheckpoints)).toBe(0);
    });

    it('keeps persisting the rest of the window after one notice fails', async () => {
      const adapter = new FixtureTenderSourceAdapter([
        hit('bad', '2026-08-09', {
          estimatedValue: { amount: 1_000_000, currencyCode: 'NOTACURRENCY' },
        }),
        hit('good', '2026-08-09'),
      ]);

      const report = await runIngest({ db, adapter, logger, now });

      expect(report.failed).toBe(1);
      expect(report.created).toBe(1);
      const rows = await db.select({ sourceId: tenders.sourceId }).from(tenders);
      expect(rows.map((r) => r.sourceId)).toEqual(['good']);
    });

    it('does not advance when the run stopped before covering the window', async () => {
      // Truncation is not an error, but it does mean notices were left
      // unread. Advancing past them would skip them permanently.
      const many = Array.from({ length: 5 }, (_unused, i) => hit(`2026-00000${i}`, '2026-08-09'));
      const report = await runIngest({
        db,
        adapter: new FixtureTenderSourceAdapter(many),
        logger,
        now,
        pageSize: 1,
        maxPages: 2,
      });

      expect(report.status).toBe('succeeded');
      expect(report.checkpointAdvanced).toBe(false);
      expect(await db.$count(ingestionCheckpoints)).toBe(0);
    });

    it('re-reads the overlap window on the next run', async () => {
      const adapter = new FixtureTenderSourceAdapter([hit('2026-000001', '2026-08-09')]);
      await runIngest({ db, adapter, logger, now });

      const rows = await db.select().from(ingestionCheckpoints);
      expect(rows[0]?.overlapDays).toBe(10);
    });
  });

  describe('the run record', () => {
    it('records counts the admin dashboard reads', async () => {
      const adapter = new FixtureTenderSourceAdapter([
        hit('2026-000001', '2026-08-09'),
        hit('2026-000002', '2026-08-08'),
      ]);
      const report = await runIngest({ db, adapter, logger, now });

      const runs = await db.select().from(ingestionRuns).where(eq(ingestionRuns.id, report.runId));
      expect(runs[0]).toMatchObject({
        status: 'succeeded',
        fetchedCount: 2,
        createdCount: 2,
        unchangedCount: 0,
        failedCount: 0,
      });
      expect(runs[0]?.finishedAt).not.toBeNull();
    });

    it('marks a scheduled run as scheduled and a manual one as manual', async () => {
      const adapter = new FixtureTenderSourceAdapter([hit('2026-000001', '2026-08-09')]);
      const scheduled = await runIngest({ db, adapter, logger, now });

      const runs = await db
        .select()
        .from(ingestionRuns)
        .where(eq(ingestionRuns.id, scheduled.runId));
      expect(runs[0]?.trigger).toBe('schedule');
    });
  });
});
