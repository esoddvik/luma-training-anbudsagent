import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  alertProfiles,
  notificationDeliveries,
  notificationPreferences,
  tenderMatches,
  tenders,
  users,
} from '@luma/db';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import { createLogger } from '@luma/observability';
import {
  claimImmediateAlert,
  findImmediateCandidates,
  immediateIdempotencyKey,
  runImmediateAlerts,
} from './immediate.js';
import { unsentMatchesForProfile } from './digest.js';

/**
 * Immediate alerts, and the property that matters most about them: an
 * immediately-alerted tender must not then arrive again in the digest.
 */

const describeDb = hasDatabase ? describe : describe.skip;
const logger = createLogger({ service: 'core', silent: true });
const now = new Date('2026-08-10T09:00:00Z');

describeDb('immediate alerts', () => {
  let harness: TestDatabase;
  let db: TestDatabase['db'];
  let userId: string;
  let profileId: string;
  let tenderId: string;

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db;
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table ${users}, ${tenders} restart identity cascade`);

    userId = (
      await db.insert(users).values({ email: 'anbud@entreprenor.no' }).returning({ id: users.id })
    )[0]!.id;

    await db
      .insert(notificationPreferences)
      .values({ userId, tenderAlertsEnabled: true, immediateAlertsEnabled: true });

    profileId = (
      await db
        .insert(alertProfiles)
        .values({ userId, name: 'Bygg', frequency: 'immediate', minimumMatchScore: 20 })
        .returning({ id: alertProfiles.id })
    )[0]!.id;

    tenderId = (
      await db
        .insert(tenders)
        .values({
          source: 'doffin',
          sourceId: '2026-950001',
          sourceUrl: 'https://www.doffin.no/notices/2026-950001',
          title: 'Rehabilitering av skole',
          buyerName: 'Bærum kommune',
          noticeCategory: 'competition',
          status: 'open',
          publishedAt: new Date('2026-08-09T00:00:00Z'),
          sourcePayloadHash: 'hash-1',
          rawPayload: {},
        })
        .returning({ id: tenders.id })
    )[0]!.id;
  });

  async function addMatch(confidence: 'high' | 'medium' | 'low', score = 85) {
    await db.insert(tenderMatches).values({
      tenderId,
      alertProfileId: profileId,
      score,
      confidence,
      included: true,
      matchingVersion: '2026.08.1',
    });
  }

  it('claims an alert for a high-confidence match', async () => {
    await addMatch('high');
    const report = await runImmediateAlerts({ db, logger, now });

    expect(report.claimed).toBe(1);
    expect(await db.$count(notificationDeliveries)).toBe(1);
  });

  it('does not interrupt anyone for a medium match', async () => {
    // A service that interrupts for a medium match gets muted, and then it
    // stops delivering the high ones too.
    await addMatch('medium');
    expect((await runImmediateAlerts({ db, logger, now })).claimed).toBe(0);
  });

  it('does not alert when the user has not opted in', async () => {
    // Off by default per the `notification_preferences` column default, not
    // §22: being interrupted is opt-in.
    await db
      .update(notificationPreferences)
      .set({ immediateAlertsEnabled: false })
      .where(eq(notificationPreferences.userId, userId));
    await addMatch('high');

    expect((await runImmediateAlerts({ db, logger, now })).claimed).toBe(0);
  });

  it('does not alert when tender alerts are switched off entirely', async () => {
    await db
      .update(notificationPreferences)
      .set({ tenderAlertsEnabled: false })
      .where(eq(notificationPreferences.userId, userId));
    await addMatch('high');

    expect((await runImmediateAlerts({ db, logger, now })).claimed).toBe(0);
  });

  it('does not alert from a paused profile', async () => {
    await db.update(alertProfiles).set({ active: false }).where(eq(alertProfiles.id, profileId));
    await addMatch('high');

    expect((await runImmediateAlerts({ db, logger, now })).claimed).toBe(0);
  });

  it('claims each tender exactly once, however often the pass runs', async () => {
    await addMatch('high');
    const first = await runImmediateAlerts({ db, logger, now });
    const second = await runImmediateAlerts({ db, logger, now });

    expect(first.claimed).toBe(1);
    expect(second.claimed).toBe(0);
    // Zero, not one, and the distinction is the design: the candidate query
    // already excludes a delivered tender, so the second pass finds nothing to
    // claim rather than trying and losing. The unique key below is the
    // backstop for a genuine race, not the everyday mechanism.
    expect(second.considered).toBe(0);
    expect(await db.$count(notificationDeliveries)).toBe(1);
  });

  it('lets only one of two concurrent passes claim the same alert', async () => {
    // The race the unique idempotency key exists for: two workers reaching the
    // same fresh match in the same instant, before either has written a
    // delivery row for the other to see.
    await addMatch('high');
    const candidates = await findImmediateCandidates(db);
    expect(candidates).toHaveLength(1);

    const results = await Promise.all([
      claimImmediateAlert(db, candidates[0]!, now),
      claimImmediateAlert(db, candidates[0]!, now),
    ]);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(await db.$count(notificationDeliveries)).toBe(1);
  });

  it('removes the tender from the next digest, which is the whole point', async () => {
    // Spec §9.3 requires deduplication between the two paths. It is not a
    // separate check: the immediate alert writes the same delivery rows the
    // digest query reads, so exclusion falls out of one mechanism.
    await addMatch('high');

    const beforeAlert = await unsentMatchesForProfile(db, profileId);
    expect(beforeAlert).toHaveLength(1);

    await runImmediateAlerts({ db, logger, now });

    const afterAlert = await unsentMatchesForProfile(db, profileId);
    expect(afterAlert).toEqual([]);
  });

  it('can be restricted to specific tenders, for the post-ingest pass', async () => {
    await addMatch('high');
    const other = (
      await db
        .insert(tenders)
        .values({
          source: 'doffin',
          sourceId: '2026-950002',
          sourceUrl: 'https://www.doffin.no/notices/2026-950002',
          title: 'Annet anbud',
          buyerName: 'Oslo kommune',
          noticeCategory: 'competition',
          status: 'open',
          publishedAt: new Date('2026-08-09T00:00:00Z'),
          sourcePayloadHash: 'hash-2',
          rawPayload: {},
        })
        .returning({ id: tenders.id })
    )[0]!.id;

    await db.insert(tenderMatches).values({
      tenderId: other,
      alertProfileId: profileId,
      score: 90,
      confidence: 'high',
      included: true,
      matchingVersion: '2026.08.1',
    });

    const report = await runImmediateAlerts({ db, logger, now, tenderIds: [other] });
    expect(report.claimed).toBe(1);
    expect(report.claims[0]?.candidate.tenderId).toBe(other);
  });

  it('ignores an excluded match', async () => {
    await db.insert(tenderMatches).values({
      tenderId,
      alertProfileId: profileId,
      score: 95,
      confidence: 'high',
      included: false,
      matchingVersion: '2026.08.1',
    });

    expect((await runImmediateAlerts({ db, logger, now })).claimed).toBe(0);
  });
});

describe('immediateIdempotencyKey', () => {
  it('is keyed on the profile and the tender, not on time', () => {
    // An immediate alert about a given tender is sent to a given profile once,
    // ever. A time component would let the same tender alert again tomorrow.
    expect(immediateIdempotencyKey('p1', 't1')).toBe('immediate:p1:t1');
  });

  it('differs between profiles and between tenders', () => {
    expect(immediateIdempotencyKey('p1', 't1')).not.toBe(immediateIdempotencyKey('p2', 't1'));
    expect(immediateIdempotencyKey('p1', 't1')).not.toBe(immediateIdempotencyKey('p1', 't2'));
  });
});
