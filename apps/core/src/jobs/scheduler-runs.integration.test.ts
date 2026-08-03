import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { schedulerRuns } from '@luma/db';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import { createLogger } from '@luma/observability';
import { runDigestScheduler } from './digest.js';
import { JOB } from './names.js';

/**
 * §38: «Siste kjørevindu skal registreres».
 *
 * The property under test is not that busy ticks are recorded — those leave
 * `notification_deliveries` behind anyway. It is that an **empty** tick is
 * recorded, because that is the only case where the table carries information
 * nothing else does. With no row, "the scheduler ran and nothing was due" and
 * "no worker has been running since Friday" are the same observation.
 */
const describeDb = hasDatabase ? describe : describe.skip;

describeDb('digest scheduler run recording', () => {
  let harness: TestDatabase;
  const logger = createLogger({ service: 'test', level: 'silent' });

  beforeAll(async () => {
    harness = await createTestDatabase();
  });

  afterAll(async () => {
    await harness?.destroy();
  });

  beforeEach(async () => {
    await harness.db.delete(schedulerRuns);
  });

  const latest = async () =>
    harness.db
      .select()
      .from(schedulerRuns)
      .where(eq(schedulerRuns.jobName, JOB.notificationDigestPrepare))
      .orderBy(desc(schedulerRuns.windowTo));

  it('records a tick that found nothing at all', async () => {
    const now = new Date('2026-08-03T06:00:00.000Z');
    const report = await runDigestScheduler({ db: harness.db, logger, now });

    expect(report.claimed).toBe(0);
    const rows = await latest();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.windowTo).toEqual(now);
    expect(rows[0]?.claimedCount).toBe(0);
  });

  // Null means "no earlier run recorded". A reader must not read it as an
  // interval running back to the beginning of time.
  it('leaves the first window open at the start and closes the next one against it', async () => {
    const first = new Date('2026-08-03T06:00:00.000Z');
    const second = new Date('2026-08-03T06:15:00.000Z');

    await runDigestScheduler({ db: harness.db, logger, now: first });
    await runDigestScheduler({ db: harness.db, logger, now: second });

    const rows = await latest();
    expect(rows).toHaveLength(2);
    expect(rows[1]?.windowFrom).toBeNull();
    expect(rows[0]?.windowFrom).toEqual(first);
    expect(rows[0]?.windowTo).toEqual(second);
  });

  // The window is read back from the previous row rather than derived from the
  // cron interval, so a gap where nothing ran stays visible as a gap instead of
  // being papered over with an interval that looks continuous.
  it('reports the true gap after a period when nothing ran', async () => {
    const before = new Date('2026-08-03T06:00:00.000Z');
    const afterOutage = new Date('2026-08-03T14:00:00.000Z');

    await runDigestScheduler({ db: harness.db, logger, now: before });
    await runDigestScheduler({ db: harness.db, logger, now: afterOutage });

    const rows = await latest();
    const gapMs = Number(rows[0]!.windowTo) - Number(rows[0]!.windowFrom);
    expect(gapMs).toBe(8 * 60 * 60 * 1000);
  });
});
