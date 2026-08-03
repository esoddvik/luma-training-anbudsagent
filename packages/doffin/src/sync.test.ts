import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FixtureTenderSourceAdapter } from './fixture-adapter.js';
import { DEFAULT_OVERLAP_DAYS, runSync, windowStart } from './sync.js';
import type { DoffinSearchHit } from './source-notice.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const now = new Date('2026-08-10T06:00:00Z');

function realHit(file: string): DoffinSearchHit {
  return JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as DoffinSearchHit;
}

/** Derives synthetic notices from a real payload, varying only what a test needs. */
function hitOn(id: string, publicationDate: string, overrides: Partial<DoffinSearchHit> = {}) {
  return { ...realHit('contract-notice.json'), id, publicationDate, ...overrides };
}

describe('windowStart', () => {
  it('is undefined on a first run, so nothing is filtered out', () => {
    expect(windowStart(undefined, DEFAULT_OVERLAP_DAYS)).toBeUndefined();
  });

  it('rewinds the checkpoint by the overlap', () => {
    const start = windowStart({ publishedThrough: new Date('2026-08-10T00:00:00Z') }, 10);
    expect(start?.toISOString()).toBe('2026-07-31T00:00:00.000Z');
  });

  it('defaults to ten days, covering the observed seven-day publication lag', () => {
    // A notice can be published up to 7 days after it was issued. A tighter
    // window would drop those permanently, with nothing to indicate a gap.
    expect(DEFAULT_OVERLAP_DAYS).toBeGreaterThanOrEqual(7);
  });
});

describe('runSync', () => {
  it('normalises everything on a first run', async () => {
    const adapter = new FixtureTenderSourceAdapter([
      hitOn('2026-000001', '2026-08-09'),
      hitOn('2026-000002', '2026-08-08'),
    ]);
    const result = await runSync({ adapter, now });

    expect(result.normalized).toHaveLength(2);
    expect(result.normalized.map((n) => n.tender.sourceId)).toEqual(['2026-000001', '2026-000002']);
  });

  it('advances the checkpoint to the newest publication date seen', async () => {
    const adapter = new FixtureTenderSourceAdapter([
      hitOn('2026-000001', '2026-08-09'),
      hitOn('2026-000002', '2026-08-05'),
    ]);
    const result = await runSync({ adapter, now });
    expect(result.nextCheckpoint.publishedThrough.toISOString()).toBe('2026-08-09T00:00:00.000Z');
  });

  it('re-reads the overlap window rather than only what is strictly newer', async () => {
    // The whole point of the overlap: a notice published two days before the
    // checkpoint must still be collected, because it may have been issued
    // before the previous run and published after it.
    const adapter = new FixtureTenderSourceAdapter([
      hitOn('2026-000001', '2026-08-09'),
      hitOn('2026-000002', '2026-08-06'),
    ]);
    const result = await runSync({
      adapter,
      now,
      checkpoint: { publishedThrough: new Date('2026-08-08T00:00:00Z') },
    });
    expect(result.normalized.map((n) => n.tender.sourceId)).toContain('2026-000002');
  });

  it('excludes notices older than the overlap window', async () => {
    const adapter = new FixtureTenderSourceAdapter([
      hitOn('2026-000001', '2026-08-09'),
      hitOn('2026-000002', '2026-06-01'),
    ]);
    const result = await runSync({
      adapter,
      now,
      checkpoint: { publishedThrough: new Date('2026-08-08T00:00:00Z') },
    });
    expect(result.normalized.map((n) => n.tender.sourceId)).toEqual(['2026-000001']);
  });

  it('does not rewind the checkpoint when a run finds nothing', async () => {
    // An empty result must not reset the watermark to the epoch and trigger a
    // full re-ingest on the next run.
    const checkpoint = { publishedThrough: new Date('2026-08-08T00:00:00Z') };
    const result = await runSync({
      adapter: new FixtureTenderSourceAdapter([]),
      now,
      checkpoint,
    });
    expect(result.normalized).toEqual([]);
    expect(result.nextCheckpoint.publishedThrough).toEqual(checkpoint.publishedThrough);
  });

  it('deduplicates a notice that appears on two pages', async () => {
    // Page boundaries are not clean cuts: publicationDate has day granularity
    // and the intra-day tie-break is undocumented.
    const duplicating = {
      source: 'doffin' as const,
      fetchNoticeById: async () => null,
      fetchNotices: async ({ page }: { page?: number }) => ({
        notices: [
          {
            sourceId: '2026-000001',
            publishedAt: new Date('2026-08-09T00:00:00Z'),
            payload: hitOn('2026-000001', '2026-08-09'),
          },
        ],
        totalMatches: 2,
        accessibleMatches: 2,
        hasMore: (page ?? 1) < 2,
      }),
    };

    const result = await runSync({ adapter: duplicating, now, pageSize: 1, maxPages: 2 });
    expect(result.normalized).toHaveLength(1);
    expect(result.duplicatesSkipped).toBe(1);
  });

  it('stops at maxPages and says so, rather than paging without bound', async () => {
    const endless = {
      source: 'doffin' as const,
      fetchNoticeById: async () => null,
      fetchNotices: async ({ page }: { page?: number }) => ({
        notices: [
          {
            sourceId: `2026-00000${page}`,
            publishedAt: new Date('2026-08-09T00:00:00Z'),
            payload: hitOn(`2026-00000${page}`, '2026-08-09'),
          },
        ],
        totalMatches: 10_000,
        accessibleMatches: 1000,
        hasMore: true,
      }),
    };

    const result = await runSync({ adapter: endless, now, pageSize: 1, maxPages: 3 });
    expect(result.pagesFetched).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it('reports a completed run as not truncated', async () => {
    const adapter = new FixtureTenderSourceAdapter([hitOn('2026-000001', '2026-08-09')]);
    expect((await runSync({ adapter, now })).truncated).toBe(false);
  });

  it('collects a warning for an unknown notice type without aborting the run', async () => {
    const adapter = new FixtureTenderSourceAdapter([
      hitOn('2026-000001', '2026-08-09', { type: 'BRAND_NEW_TYPE' }),
      hitOn('2026-000002', '2026-08-09'),
    ]);
    const seen: string[] = [];
    const result = await runSync({
      adapter,
      now,
      onWarning: (warning) => seen.push(warning.sourceId),
    });

    expect(result.normalized).toHaveLength(2);
    expect(seen).toEqual(['2026-000001']);
  });

  it('is deterministic across repeated runs over the same data', async () => {
    const hits = [hitOn('2026-000001', '2026-08-09'), hitOn('2026-000002', '2026-08-08')];
    const first = await runSync({ adapter: new FixtureTenderSourceAdapter(hits), now });
    const second = await runSync({ adapter: new FixtureTenderSourceAdapter(hits), now });

    expect(first.normalized.map((n) => n.tender.sourcePayloadHash)).toEqual(
      second.normalized.map((n) => n.tender.sourcePayloadHash),
    );
  });

  it('produces an unchanged payload hash on re-ingest, so nothing looks modified', async () => {
    // The property that makes re-ingest idempotent: identical source data must
    // hash identically, or every notice reports a change on every run.
    const hits = [hitOn('2026-000001', '2026-08-09')];
    const a = await runSync({ adapter: new FixtureTenderSourceAdapter(hits), now });
    const b = await runSync({
      adapter: new FixtureTenderSourceAdapter(hits),
      now: new Date('2026-08-11T06:00:00Z'),
    });

    expect(a.normalized[0]?.tender.sourcePayloadHash).toBe(
      b.normalized[0]?.tender.sourcePayloadHash,
    );
    // But the observation time does move.
    expect(a.normalized[0]?.tender.lastSyncedAt).not.toEqual(b.normalized[0]?.tender.lastSyncedAt);
  });
});

describe('FixtureTenderSourceAdapter', () => {
  it('orders notices publication-date descending, like the live API', async () => {
    const adapter = new FixtureTenderSourceAdapter([
      hitOn('old', '2026-08-01'),
      hitOn('new', '2026-08-09'),
    ]);
    const result = await adapter.fetchNotices({});
    expect(result.notices.map((n) => n.sourceId)).toEqual(['new', 'old']);
  });

  it('reports the 1000-hit ceiling the same way the live API does', async () => {
    const many = Array.from({ length: 1200 }, (_unused, i) =>
      hitOn(`2026-${String(i).padStart(6, '0')}`, '2026-08-09'),
    );
    const result = await new FixtureTenderSourceAdapter(many).fetchNotices({ pageSize: 100 });
    expect(result.totalMatches).toBe(1200);
    expect(result.accessibleMatches).toBe(1000);
  });

  it('finds a notice by id', async () => {
    const adapter = new FixtureTenderSourceAdapter([hitOn('2026-000001', '2026-08-09')]);
    expect((await adapter.fetchNoticeById('2026-000001'))?.sourceId).toBe('2026-000001');
  });

  it('returns null for an unknown id', async () => {
    const adapter = new FixtureTenderSourceAdapter([hitOn('2026-000001', '2026-08-09')]);
    expect(await adapter.fetchNoticeById('nope')).toBeNull();
  });
});
