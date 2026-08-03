import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { type PgBoss } from 'pg-boss';
import { ingestionCheckpoints, ingestionRuns, tenders } from '@luma/db';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import { FixtureTenderSourceAdapter, type DoffinSearchHit } from '@luma/doffin';
import { FakePostmarkClient } from '@luma/email';
import { createLogger } from '@luma/observability';
import { ALL_JOB_NAMES, JOB } from '../jobs/names.js';
import {
  DEAD_LETTER_QUEUE,
  QUEUE_SCHEMA,
  queueStatus,
  startQueue,
  type QueueRuntime,
} from './boss.js';
import { registerJobs, registerSchedules } from './register.js';

/**
 * The job runtime against a real PostgreSQL.
 *
 * None of these properties can be established without a database. "pg-boss
 * creates its schema", "a failing job reaches the dead-letter queue", "cron
 * re-registration does not duplicate" and "shutdown drains" are all statements
 * about what the database contains afterwards, and a fake queue would only
 * replay whatever this file told it.
 *
 * The load-bearing one is `enqueues matching only for tenders that changed`.
 * That test has been deliberately broken — the handler was changed to enqueue
 * for every ingested tender, including unchanged ones — and it went red on the
 * second-run assertion. It is the only automated thing standing between an
 * idempotent re-ingest and a user being alerted twice about one tender.
 *
 * **On waiting, which is where this file's one real bug was.** The first
 * version of that test waited on a row `runIngest` writes when it *starts*, so
 * the assertion ran before the handler had reached the enqueue at all. It
 * passed against the deliberately broken handler. A gate that cannot fail is
 * worse than no gate, because it is trusted.
 *
 * Every wait here has since been checked against the same question — does this
 * condition mean the thing I am about to assert has actually happened, or does
 * it merely correlate with it? The rule that came out of it: wait on the job's
 * own terminal state, or on a variable the handler itself set, and never on a
 * row written on the way in. Where a count is asserted, capture a baseline
 * first: this suite shares one database across its tests, so an absolute count
 * can be satisfied by a previous test's leftovers.
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

function hit(id: string, publicationDate: string): DoffinSearchHit {
  return { ...realHit('contract-notice.json'), id, publicationDate };
}

const logger = createLogger({ service: 'core', silent: true });

/** Rebuilds the harness database's own connection string for pg-boss. */
function connectionStringFor(databaseName: string): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is required for the queue integration tests');
  const url = new URL(base);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function waitFor(
  predicate: () => Promise<boolean>,
  what: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * Jobs ever created on a queue, in any state.
 *
 * Counted from `pgboss.job` rather than from `getQueue().queuedCount`, because
 * the assertion is about what was *enqueued*, and a handler that already ran
 * would have drained the queue before the assertion could see it. Completed
 * jobs are retained for seven days by default, so they are all still there.
 */
async function jobsCreated(boss: PgBoss, name: string): Promise<number> {
  const result = await boss
    .getDb()
    .executeSql(`SELECT count(*)::int AS count FROM ${QUEUE_SCHEMA}.job WHERE name = $1`, [name]);
  return Number(result.rows[0]?.count ?? 0);
}

async function jobStates(boss: PgBoss, name: string): Promise<string[]> {
  const result = await boss
    .getDb()
    .executeSql(`SELECT state FROM ${QUEUE_SCHEMA}.job WHERE name = $1`, [name]);
  return result.rows.map((row: { state: string }) => row.state);
}

/**
 * Waits for one specific job to reach a terminal state.
 *
 * Written after the weaker version of this file was caught passing against a
 * handler that had been deliberately broken: it waited on a row `runIngest`
 * writes when it *starts*, so the assertion ran before the handler had got as
 * far as enqueueing anything. Waiting on the job's own state is the only
 * condition that actually means "the handler finished".
 */
async function waitForJob(boss: PgBoss, jobId: string | null): Promise<string> {
  if (!jobId) throw new Error('no job id was returned by send()');
  let state = '';
  await waitFor(async () => {
    const result = await boss
      .getDb()
      .executeSql(`SELECT state FROM ${QUEUE_SCHEMA}.job WHERE id = $1`, [jobId]);
    state = String(result.rows[0]?.state ?? '');
    return state === 'completed' || state === 'failed' || state === 'cancelled';
  }, `job ${jobId} to settle`);
  return state;
}

describeDb('the pg-boss job runtime', () => {
  let harness: TestDatabase;
  let connectionString: string;
  const started: QueueRuntime[] = [];

  beforeAll(async () => {
    harness = await createTestDatabase();
    connectionString = connectionStringFor(harness.databaseName);
  }, 60_000);

  afterEach(async () => {
    // Each test owns its queue instance. Stopping them here rather than in the
    // test keeps a failed assertion from leaving a poller running against a
    // database the next test is about to truncate.
    while (started.length > 0) {
      const runtime = started.pop();
      await runtime?.close().catch(() => undefined);
    }
  });

  afterAll(async () => {
    await harness?.destroy();
  });

  async function start(options: { worker?: boolean } = {}): Promise<QueueRuntime> {
    const runtime = await startQueue({
      connectionString,
      logger,
      // Two, not the production default of five. Eleven integration files
      // contend for one PostgreSQL, and every connection this file does not
      // hold is one they can have. `hookTimeout: 60_000` at project level now
      // keeps that contention from being reported as a failure; not holding
      // three connections a test never uses is still the right default.
      max: 2,
      ...(options.worker === undefined ? {} : { worker: options.worker }),
    });
    started.push(runtime);
    return runtime;
  }

  it('creates its own schema in the application database', async () => {
    const { boss } = await start({ worker: false });

    const schemas = await harness.db.execute(
      sql`select schema_name from information_schema.schemata where schema_name = ${QUEUE_SCHEMA}`,
    );
    expect(schemas.length).toBe(1);

    // The operator-facing claim in boss.ts: an unfamiliar `pgboss` schema in
    // the application database is the queue, not a stray migration.
    const tablesResult = await harness.db.execute(
      sql`select table_name from information_schema.tables where table_schema = ${QUEUE_SCHEMA}`,
    );
    const tables = tablesResult.map((row) => String(row.table_name));
    expect(tables).toContain('job');
    expect(tables).toContain('queue');
    expect(tables).toContain('schedule');

    expect(await boss.isInstalled()).toBe(true);
  }, 60_000);

  it('picks up and runs an enqueued job', async () => {
    const { boss } = await start({ worker: false });
    const queue = 'test.picked-up';
    await boss.createQueue(queue);

    const seen: string[] = [];
    await boss.work(queue, { batchSize: 1, pollingIntervalSeconds: 0.5 }, async (jobs) => {
      for (const job of jobs) seen.push(job.id);
    });

    const jobId = await boss.send(queue, { hello: 'world' });
    expect(jobId).toBeTruthy();

    await waitFor(async () => seen.length === 1, 'the job to be handled');
    expect(seen[0]).toBe(jobId);
  }, 60_000);

  it('retries a throwing handler and lands it in a failed, dead-lettered state', async () => {
    const { boss } = await start({ worker: false });
    const queue = 'test.always-throws';

    await boss.createQueue(DEAD_LETTER_QUEUE);
    // The production queues use retryLimit 5 with exponential backoff, which
    // would take about ten minutes to exhaust. The *mechanism* is what is
    // under test here, so it is exercised at speed; that the real queues carry
    // the real policy is asserted separately below.
    await boss.createQueue(queue, {
      retryLimit: 2,
      retryDelay: 0,
      retryBackoff: false,
      deadLetter: DEAD_LETTER_QUEUE,
    });

    let attempts = 0;
    await boss.work(queue, { batchSize: 1, pollingIntervalSeconds: 0.5 }, async () => {
      attempts += 1;
      throw new Error('deliberate failure');
    });

    // Every test in this file shares one database, so an absolute count here
    // would be satisfied by anything an earlier test happened to dead-letter,
    // and the assertion would hold whether or not *this* job reached the
    // queue. A delta against a baseline cannot pass that way.
    const deadLetteredBefore = await jobsCreated(boss, DEAD_LETTER_QUEUE);

    await boss.send(queue, { attempt: 1 });

    await waitFor(async () => (await jobStates(boss, queue)).includes('failed'), 'the job to fail');

    // Three attempts: the first, plus two retries.
    expect(attempts).toBe(3);
    expect(await jobStates(boss, queue)).toContain('failed');

    // Exhausted retries are copied to the dead-letter queue, which is what
    // makes them visible to admin (spec §38 "feilet-jobbvisning").
    await waitFor(
      async () => (await jobsCreated(boss, DEAD_LETTER_QUEUE)) > deadLetteredBefore,
      'the job to be dead-lettered',
    );
  }, 60_000);

  it('reports real depth on an instance that runs no monitor', async () => {
    // `worker: false` means `supervise: false`, which means this process never
    // starts the monitor loop that maintains pg-boss's cached counts. That is
    // the case where the old `getQueues` implementation reported all-zero and
    // called it healthy.
    const { boss } = await start({ worker: false });

    await registerJobs({
      boss,
      db: harness.db,
      adapter: new FixtureTenderSourceAdapter([]),
      emailClient: new FakePostmarkClient(),
      logger,
      worker: false,
      config: emailConfig(),
    });

    // No handler is attached to this queue anywhere, so the job stays queued.
    const queue = JOB.feedbackProcess;
    await boss.send(queue, {});

    // The cached read, taken first because the forced read below repairs the
    // cache as a side effect. `monitor_on` is still NULL, so pg-boss's own
    // columns say zero — a queue with work in it, reporting empty.
    const cached = await boss.getQueues([queue]);
    expect(cached[0]?.readyCount).toBe(0);

    // The same instant, through `queueStatus`. This is the whole point of the
    // change: an operator asking "is work moving" gets 1, not 0.
    const status = await queueStatus(boss);
    expect(status.find((entry) => entry.name === queue)?.ready).toBe(1);

    // Every declared queue is present, so a caller can tell "zero" from
    // "missing" without consulting the job registry itself.
    expect(status.length).toBe(ALL_JOB_NAMES.length + 1);
    expect(status.map((entry) => entry.name)).toContain(DEAD_LETTER_QUEUE);
  }, 60_000);

  it('throws rather than hanging when the reading exceeds its budget', async () => {
    const { boss } = await start({ worker: false });
    await registerJobs({
      boss,
      db: harness.db,
      adapter: new FixtureTenderSourceAdapter([]),
      emailClient: new FakePostmarkClient(),
      logger,
      worker: false,
      config: emailConfig(),
    });

    // A dashboard that renders "unavailable" is more use than one that never
    // paints, so the caller needs a rejection it can catch.
    await expect(queueStatus(boss, 1)).rejects.toThrow(/timed out/);
  }, 60_000);

  it('configures every real queue with backoff, a retry limit and a dead letter', async () => {
    const { boss } = await start({ worker: false });
    const fake = new FakePostmarkClient();

    await registerJobs({
      boss,
      db: harness.db,
      adapter: new FixtureTenderSourceAdapter([]),
      emailClient: fake,
      logger,
      worker: false,
      config: emailConfig(),
    });

    const match = await boss.getQueue(JOB.tenderMatch);
    expect(match?.retryBackoff).toBe(true);
    expect(match?.retryLimit).toBe(5);
    expect(match?.deadLetter).toBe(DEAD_LETTER_QUEUE);

    // The one queue that must NOT retry: a retried send is a second email.
    const send = await boss.getQueue(JOB.emailSend);
    expect(send?.retryLimit).toBe(0);
  }, 60_000);

  it('registers each cron schedule exactly once, however many times it boots', async () => {
    const { boss } = await start({ worker: false });

    await registerJobs({
      boss,
      db: harness.db,
      adapter: new FixtureTenderSourceAdapter([]),
      emailClient: new FakePostmarkClient(),
      logger,
      worker: false,
      config: emailConfig(),
    });

    const first = await boss.getSchedules();
    expect(first.map((entry) => entry.name).sort()).toEqual(
      [JOB.doffinSync, JOB.notificationDigestPrepare, JOB.shareCleanup].sort(),
    );

    // A redeploy re-runs registration. pg-boss upserts on (name, key), so this
    // must correct a changed expression without accumulating rows.
    await registerSchedules(boss);
    await registerSchedules(boss);

    const again = await boss.getSchedules();
    expect(again.length).toBe(first.length);
    expect(new Set(again.map((entry) => entry.name)).size).toBe(3);
  }, 60_000);

  it('enqueues matching only for tenders that changed', async () => {
    await harness.db.execute(
      sql`truncate table ${tenders}, ${ingestionRuns}, ${ingestionCheckpoints} restart identity cascade`,
    );

    const { boss } = await start();
    const hits = [hit('2026-950001', '2026-08-09'), hit('2026-950002', '2026-08-09')];

    await registerJobs({
      boss,
      db: harness.db,
      adapter: new FixtureTenderSourceAdapter(hits),
      emailClient: new FakePostmarkClient(),
      logger,
      config: emailConfig(),
    });

    const firstRun = await boss.send(JOB.doffinSync, {});
    expect(await waitForJob(boss, firstRun)).toBe('completed');

    const rows = await harness.db.select({ id: tenders.id }).from(tenders);
    expect(rows.length).toBe(2);

    // Two new tenders, so exactly one match job carrying both of them.
    const afterFirstRun = await jobsCreated(boss, JOB.tenderMatch);
    expect(afterFirstRun).toBe(1);

    // The same notices again. Every payload hash is unchanged, so `runIngest`
    // reports them as `unchanged` and the handler must enqueue nothing. If it
    // did, matching would rewrite the match rows, the immediate-alert query
    // would see them as fresh, and a user would be interrupted a second time
    // about a tender they were already told about.
    const secondRun = await boss.send(JOB.doffinSync, {});
    expect(await waitForJob(boss, secondRun)).toBe('completed');

    const runs = await harness.db.select({ id: ingestionRuns.id }).from(ingestionRuns);
    expect(runs.length).toBe(2);

    expect(await jobsCreated(boss, JOB.tenderMatch)).toBe(afterFirstRun);
  }, 90_000);

  it('drains an in-flight handler on shutdown rather than abandoning it', async () => {
    const runtime = await start({ worker: false });
    const queue = 'test.slow-handler';
    await runtime.boss.createQueue(queue);

    let entered = false;
    let finished = false;
    await runtime.boss.work(queue, { batchSize: 1, pollingIntervalSeconds: 0.5 }, async () => {
      entered = true;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      finished = true;
    });

    await runtime.boss.send(queue, {});
    await waitFor(async () => entered, 'the handler to start');

    // Shutdown while the handler is mid-flight. Spec §38 requires the drain:
    // abandoning a handler is how at-least-once delivery turns a crash into a
    // duplicate email on the next boot.
    await runtime.close();
    started.pop();

    expect(finished).toBe(true);
  }, 60_000);
});

/** The non-database configuration the email jobs need. Values are irrelevant here. */
function emailConfig() {
  return {
    appUrl: 'https://anbudsvarsling.example.test',
    privacyUrl: 'https://example.test/personvern',
    termsUrl: 'https://example.test/vilkar',
    senderName: 'Luma Training',
    senderPostalAddress: 'Luma Training AS, Oslo',
    senderContactEmail: 'post@example.test',
    osloRegionCodes: ['NO081'],
  };
}
