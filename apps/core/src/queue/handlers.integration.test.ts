import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  alertProfiles,
  consentEvents,
  consentTextVersions,
  emailSuppressions,
  notificationDeliveries,
  notificationDeliveryItems,
  tenderMatches,
  tenderShares,
  tenders,
  users,
} from '@luma/db';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import { FixtureTenderSourceAdapter } from '@luma/doffin';
import { FakePostmarkClient } from '@luma/email';
import { createLogger } from '@luma/observability';
import { runConsentSync } from '../jobs/consent-sync.js';
import { runShareCleanup } from '../jobs/share-cleanup.js';
import { JOB } from '../jobs/names.js';
import { QUEUE_SCHEMA, startQueue, type QueueRuntime } from './boss.js';
import { registerJobs } from './register.js';

/**
 * The job handlers this module introduced, against a real database.
 *
 * The one that earns its runtime is `does not send a delivery that is already
 * sent`. Spec §38 requires "ingen doble e-poster" under at-least-once
 * delivery, and the delivery claim key does not provide it on its own: the key
 * stops two *preparers* racing, but it says nothing about the same `email.send`
 * job being delivered twice, which pg-boss guarantees will eventually happen.
 * The state of the delivery row is the gate that holds on a redelivery, and
 * this is the test that says so.
 */

const describeDb = hasDatabase ? describe : describe.skip;

const logger = createLogger({ service: 'core', silent: true });
const now = new Date('2026-08-10T09:00:00Z');

function connectionStringFor(databaseName: string): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is required for these tests');
  const url = new URL(base);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function waitFor(predicate: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describeDb('the queue handlers', () => {
  let harness: TestDatabase;
  let db: TestDatabase['db'];

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db;
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table ${users}, ${tenders}, ${consentTextVersions}, ${emailSuppressions} restart identity cascade`,
    );
  });

  describe('share.cleanup', () => {
    it('deletes expired links and leaves live ones alone', async () => {
      const userId = await seedUser(db, 'deler@eksempel.no');
      const tenderId = await seedTender(db, '2026-960001');

      await db.insert(tenderShares).values([
        {
          tenderId,
          createdByUserId: userId,
          token: 'a'.repeat(48),
          expiresAt: new Date(now.getTime() - 86_400_000),
        },
        {
          tenderId,
          createdByUserId: userId,
          token: 'b'.repeat(48),
          expiresAt: new Date(now.getTime() + 86_400_000),
        },
        {
          // Revoked but not expired: deliberately kept, so the user can still
          // see that they revoked it.
          tenderId,
          createdByUserId: userId,
          token: 'c'.repeat(48),
          expiresAt: new Date(now.getTime() + 86_400_000),
          revokedAt: new Date(now.getTime() - 3600_000),
        },
      ]);

      const report = await runShareCleanup({ db, logger, now });
      expect(report.deleted).toBe(1);

      const remaining = await db.select({ token: tenderShares.token }).from(tenderShares);
      expect(remaining.map((row) => row.token).sort()).toEqual(
        ['b'.repeat(48), 'c'.repeat(48)].sort(),
      );
    });
  });

  describe('consent.sync', () => {
    beforeEach(async () => {
      await db.insert(consentTextVersions).values({
        consentType: 'marketing_email',
        version: '1.0',
        body: 'Jeg vil gjerne motta e-post fra Luma Training.',
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      });
    });

    it('records the withdrawal locally and pushes the suppression to Postmark', async () => {
      const withdrawnId = await seedUser(db, 'trukket@eksempel.no');
      const activeId = await seedUser(db, 'aktiv@eksempel.no');

      await db
        .insert(consentEvents)
        .values([
          marketingConsent(withdrawnId, 'granted', '2026-02-01T00:00:00Z'),
          marketingConsent(withdrawnId, 'withdrawn', '2026-03-01T00:00:00Z'),
          marketingConsent(activeId, 'granted', '2026-02-01T00:00:00Z'),
        ]);

      const fake = new FakePostmarkClient();
      const report = await runConsentSync({ db, emailClient: fake, logger, now });

      expect(report.withdrawalsConsidered).toBe(1);
      expect(report.suppressionsRecorded).toBe(1);
      expect(report.pushedToPostmark).toBe(1);

      const rows = await db.select().from(emailSuppressions);
      expect(rows.length).toBe(1);
      expect(rows[0]?.email).toBe('trukket@eksempel.no');
      expect(rows[0]?.messageStream).toBe('luma_marketing');

      // The push landed.
      expect(await fake.isSuppressed('trukket@eksempel.no', 'luma-marketing')).toBe(true);

      // Drift is read before the push, so it reports the state this run found
      // rather than the state this run created.
      expect(report.postmarkChecked).toBe(1);
      expect(report.postmarkMissing).toBe(1);

      // The user who never withdrew is untouched on every stream.
      expect(await fake.isSuppressed('aktiv@eksempel.no', 'luma-marketing')).toBe(false);
    });

    it('suppresses marketing only, never account-critical mail', async () => {
      const userId = await seedUser(db, 'trukket@eksempel.no');
      await db
        .insert(consentEvents)
        .values([
          marketingConsent(userId, 'granted', '2026-02-01T00:00:00Z'),
          marketingConsent(userId, 'withdrawn', '2026-03-01T00:00:00Z'),
        ]);

      const fake = new FakePostmarkClient();
      await runConsentSync({ db, emailClient: fake, logger, now });

      // Spec §27. If this ever goes the other way, a user who unsubscribed
      // from a newsletter can no longer receive a magic link, and to them that
      // is indistinguishable from losing their account.
      expect(await fake.isSuppressed('trukket@eksempel.no', 'luma-marketing')).toBe(true);
      expect(await fake.isSuppressed('trukket@eksempel.no', 'transactional')).toBe(false);
      expect(await fake.isSuppressed('trukket@eksempel.no', 'tender-notifications')).toBe(false);

      // And the local row is scoped the same way.
      const streams = (await db.select().from(emailSuppressions)).map((row) => row.messageStream);
      expect(streams).toEqual(['luma_marketing']);
    });

    it('is idempotent, as at-least-once delivery requires', async () => {
      const userId = await seedUser(db, 'trukket@eksempel.no');
      await db
        .insert(consentEvents)
        .values([
          marketingConsent(userId, 'granted', '2026-02-01T00:00:00Z'),
          marketingConsent(userId, 'withdrawn', '2026-03-01T00:00:00Z'),
        ]);

      const fake = new FakePostmarkClient();
      await runConsentSync({ db, emailClient: fake, logger, now });
      const second = await runConsentSync({ db, emailClient: fake, logger, now });

      expect(second.suppressionsRecorded).toBe(0);
      expect(second.alreadyRecorded).toBe(1);
      expect((await db.select().from(emailSuppressions)).length).toBe(1);

      // Re-asserted anyway: a repeat suppression is a no-op at Postmark, and
      // re-asserting is what makes a suppression someone removed by hand come
      // back on the next tick.
      expect(second.pushedToPostmark).toBe(1);
      // Nothing to report as drift the second time, because the first run
      // fixed it.
      expect(second.postmarkMissing).toBe(0);
    });

    it('re-asserts a suppression that was removed outside this system', async () => {
      const userId = await seedUser(db, 'trukket@eksempel.no');
      await db
        .insert(consentEvents)
        .values([
          marketingConsent(userId, 'granted', '2026-02-01T00:00:00Z'),
          marketingConsent(userId, 'withdrawn', '2026-03-01T00:00:00Z'),
        ]);

      const fake = new FakePostmarkClient();
      await runConsentSync({ db, emailClient: fake, logger, now });

      // Somebody deletes the suppression in Postmark's own interface.
      fake.unsuppress('trukket@eksempel.no', 'luma-marketing');

      const second = await runConsentSync({ db, emailClient: fake, logger, now });

      expect(second.postmarkMissing).toBe(1);
      expect(await fake.isSuppressed('trukket@eksempel.no', 'luma-marketing')).toBe(true);
    });

    it('fails rather than reporting a clean run when the push fails', async () => {
      const userId = await seedUser(db, 'trukket@eksempel.no');
      await db
        .insert(consentEvents)
        .values([
          marketingConsent(userId, 'granted', '2026-02-01T00:00:00Z'),
          marketingConsent(userId, 'withdrawn', '2026-03-01T00:00:00Z'),
        ]);

      class BrokenPostmark extends FakePostmarkClient {
        override async suppressAddress(): Promise<void> {
          throw new Error('Postmark unavailable');
        }
      }

      // The failure that must never be swallowed: a withdrawal that did not
      // reach the processor, on a run that logged success.
      await expect(
        runConsentSync({ db, emailClient: new BrokenPostmark(), logger, now }),
      ).rejects.toThrow(/Postmark unavailable/);
    });

    it('leaves a re-granted consent alone', async () => {
      const userId = await seedUser(db, 'ombestemt@eksempel.no');
      await db
        .insert(consentEvents)
        .values([
          marketingConsent(userId, 'granted', '2026-02-01T00:00:00Z'),
          marketingConsent(userId, 'withdrawn', '2026-03-01T00:00:00Z'),
          marketingConsent(userId, 'granted', '2026-04-01T00:00:00Z'),
        ]);

      const report = await runConsentSync({
        db,
        emailClient: new FakePostmarkClient(),
        logger,
        now,
      });

      expect(report.withdrawalsConsidered).toBe(0);
      expect((await db.select().from(emailSuppressions)).length).toBe(0);
    });
  });

  describe('email.send', () => {
    let runtime: QueueRuntime;
    const fake = new FakePostmarkClient();

    /**
     * One queue for the whole block, started once.
     *
     * It was a `beforeEach`, which meant two pg-boss starts — each of which
     * connects, checks its schema version and runs its own migration path.
     * Eleven integration files contend for one PostgreSQL, and the symptom
     * this removed was a hook in some *other* suite timing out.
     *
     * That symptom is now also addressed from the other end: every package
     * that touches a database sets `hookTimeout: 60_000` at project level, so
     * a slow hook is no longer a failed hook. This stays regardless — the
     * timeout stops contention being reported as a failure, it does not make
     * two redundant queue startups a good idea.
     *
     * The queue holds no per-test state: `registerJobs` wires handlers, and
     * every test drives it through a job it enqueues itself.
     */
    beforeAll(async () => {
      runtime = await startQueue({
        connectionString: connectionStringFor(harness.databaseName),
        logger,
        // Two, not the production default of five. A test drives one job at a
        // time and every spare connection here is one another suite cannot have.
        max: 2,
      });
      await registerJobs({
        boss: runtime.boss,
        db,
        adapter: new FixtureTenderSourceAdapter([]),
        emailClient: fake,
        logger,
        now: () => now,
        config: {
          appUrl: 'https://example.test/anbudsvarsling',
          privacyUrl: 'https://example.test/personvern',
          termsUrl: 'https://example.test/vilkar',
          senderName: 'Luma Training',
          senderPostalAddress: 'Luma Training AS, Oslo',
          senderContactEmail: 'post@example.test',
          osloRegionCodes: ['NO081'],
        },
      });
    }, 60_000);

    afterAll(async () => {
      await runtime?.close().catch(() => undefined);
    });

    // The fake outlives each test now that the queue does, so every assertion
    // is a delta against what this test found. Same discipline as the
    // dead-letter count in `queue.integration.test.ts`: an absolute number
    // against shared state can be satisfied by a neighbour's leftovers.
    it('does not send a delivery that is already sent', async () => {
      const before = fake.sent.length;
      const deliveryId = await seedClaimedDigest(db, 'sent');

      const jobId = await runtime.boss.send(JOB.emailSend, { deliveryId });
      await waitForJobSettled(runtime, jobId);

      // The whole point: a redelivered send job for a delivery that already
      // went out must produce no second email.
      expect(fake.sent.length - before).toBe(0);
    }, 60_000);

    it('sends a pending delivery exactly once', async () => {
      const before = fake.sent.length;
      const deliveryId = await seedClaimedDigest(db, 'pending');

      const jobId = await runtime.boss.send(JOB.emailSend, { deliveryId });
      await waitForJobSettled(runtime, jobId);

      expect(fake.sent.length - before).toBe(1);
      expect(fake.sent.at(-1)?.to).toBe('mottaker@eksempel.no');

      const rows = await db
        .select({ status: notificationDeliveries.status })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, deliveryId));
      expect(rows[0]?.status).toBe('sent');

      // And the redelivery that at-least-once guarantees.
      const again = await runtime.boss.send(JOB.emailSend, { deliveryId });
      await waitForJobSettled(runtime, again);
      expect(fake.sent.length - before).toBe(1);
    }, 60_000);

    async function waitForJobSettled(queue: QueueRuntime, jobId: string | null): Promise<void> {
      if (!jobId) throw new Error('send() returned no job id');
      await waitFor(async () => {
        const result = await queue.boss
          .getDb()
          .executeSql(`SELECT state FROM ${QUEUE_SCHEMA}.job WHERE id = $1`, [jobId]);
        const state = String(result.rows[0]?.state ?? '');
        return state === 'completed' || state === 'failed' || state === 'cancelled';
      }, `job ${jobId} to settle`);
    }
  });
});

function marketingConsent(userId: string, status: 'granted' | 'withdrawn', occurredAt: string) {
  return {
    userId,
    consentType: 'marketing_email' as const,
    status,
    source: 'account_settings' as const,
    consentTextVersion: '1.0',
    occurredAt: new Date(occurredAt),
  };
}

async function seedUser(db: TestDatabase['db'], email: string): Promise<string> {
  const rows = await db.insert(users).values({ email }).returning({ id: users.id });
  const id = rows[0]?.id;
  if (!id) throw new Error('failed to seed user');
  return id;
}

async function seedTender(db: TestDatabase['db'], sourceId: string): Promise<string> {
  const rows = await db
    .insert(tenders)
    .values({
      source: 'doffin',
      sourceId,
      sourceUrl: `https://doffin.no/notices/${sourceId}`,
      title: 'Rammeavtale for kontormøbler',
      buyerName: 'Bærum kommune',
      noticeCategory: 'competition',
      publishedAt: new Date('2026-08-09T00:00:00Z'),
      sourcePayloadHash: `hash-${sourceId}`,
      rawPayload: { id: sourceId },
    })
    .returning({ id: tenders.id });
  const id = rows[0]?.id;
  if (!id) throw new Error('failed to seed tender');
  return id;
}

/** A user, a profile, a matched tender and a claimed daily digest for it. */
async function seedClaimedDigest(
  db: TestDatabase['db'],
  status: 'pending' | 'sent',
): Promise<string> {
  const userId = await seedUser(db, 'mottaker@eksempel.no');
  const tenderId = await seedTender(db, '2026-970001');

  const profileRows = await db
    .insert(alertProfiles)
    .values({
      userId,
      name: 'Kontorutstyr',
      active: true,
      frequency: 'daily',
      digestHourLocal: 7,
      timezone: 'Europe/Oslo',
      minimumMatchScore: 30,
    })
    .returning({ id: alertProfiles.id });
  const alertProfileId = profileRows[0]!.id;

  const matchRows = await db
    .insert(tenderMatches)
    .values({
      tenderId,
      alertProfileId,
      score: 72,
      confidence: 'high',
      included: true,
      matchingVersion: 'test-1',
    })
    .returning({ id: tenderMatches.id });
  const matchId = matchRows[0]!.id;

  const deliveryRows = await db
    .insert(notificationDeliveries)
    .values({
      userId,
      alertProfileId,
      kind: 'daily_digest',
      status,
      messageStream: 'tender_notifications',
      templateAlias: 'tender-daily-digest-v1',
      scheduledFor: now,
      itemCount: 1,
      idempotencyKey: `daily_digest:${alertProfileId}:2026-08-10T09`,
    })
    .returning({ id: notificationDeliveries.id });
  const deliveryId = deliveryRows[0]!.id;

  await db.insert(notificationDeliveryItems).values({
    deliveryId,
    tenderId,
    tenderMatchId: matchId,
    section: 'daily_digest',
    sortOrder: 0,
  });

  return deliveryId;
}
