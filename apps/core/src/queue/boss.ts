import { PgBoss } from 'pg-boss';
import type { DependencyCheck, Logger } from '@luma/observability';
import { ALL_JOB_NAMES, type JobName } from '../jobs/names.js';

/**
 * The pg-boss instance (spec §38, ADR-0008).
 *
 * **pg-boss creates and owns its own schema, `pgboss`, inside the application
 * database.** An operator who opens the database and finds `pgboss.job`,
 * `pgboss.queue`, `pgboss.schedule` and a handful of partitions has not found
 * a stray migration: that is the queue, and it is deliberately in the same
 * database as the application tables so an enqueue can share a transaction
 * with the write that caused it. There is no Redis, and there never was one.
 * The schema is versioned by the library, so a pg-boss major upgrade is a
 * database migration and is treated as one.
 *
 * The pool here is separate from, and smaller than, the application pool.
 * Three services share one PostgreSQL instance; a worker that polls on ten
 * connections per replica is how a small system runs out of `max_connections`
 * while every dashboard says idle.
 */

/** The schema pg-boss creates. Named explicitly so it is greppable. */
export const QUEUE_SCHEMA = 'pgboss';

/**
 * Where jobs go when their retries are exhausted (spec §38, "feilet-jobbvisning").
 *
 * One shared queue rather than one per job type, because the operator question
 * is "what failed", not "what failed on which queue" — the original queue is
 * recorded on each dead-lettered job anyway, and `redrive` can filter on it.
 * Nothing works this queue; it is a table you read.
 */
export const DEAD_LETTER_QUEUE = 'job.dead-letter';

const DEFAULT_POOL_MAX = 5;

/**
 * Must fit inside `shutdown.ts`'s 15-second budget alongside the HTTP close
 * and the database close. A queue drain longer than the process-level timeout
 * would be force-exited anyway, which is the abandonment it exists to prevent.
 */
const DEFAULT_STOP_TIMEOUT_MS = 10_000;

export interface StartQueueOptions {
  readonly connectionString: string;
  readonly logger: Logger;
  /** Bounded deliberately. See the note above about `max_connections`. */
  readonly max?: number;
  /** How long a graceful stop waits for in-flight handlers before closing. */
  readonly stopTimeoutMs?: number;
  /**
   * `false` turns this process into a producer only: it can enqueue, read
   * queue state and answer readiness, but it runs no cron, no maintenance and
   * no handlers. That is what `WORKER_ENABLED=false` buys — an instance that
   * serves HTTP without competing for jobs.
   */
  readonly worker?: boolean;
}

export interface QueueRuntime {
  readonly boss: PgBoss;
  /** Whether this instance runs handlers, cron and maintenance. */
  readonly worker: boolean;
  /**
   * Stops polling, waits for in-flight handlers, then closes the queue's own
   * pool. Registered between HTTP and the database in `installShutdownHandlers`.
   */
  readonly close: () => Promise<void>;
}

export async function startQueue(options: StartQueueOptions): Promise<QueueRuntime> {
  const { logger } = options;
  const worker = options.worker ?? true;
  const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;

  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema: QUEUE_SCHEMA,
    application_name: 'luma-core-queue',
    max: options.max ?? DEFAULT_POOL_MAX,
    // Cron and maintenance are worker responsibilities. A producer-only
    // instance that still ran the timekeeper would fire scheduled jobs it has
    // no intention of processing.
    schedule: worker,
    supervise: worker,
  });

  // pg-boss emits `error` on background failures. Without a listener, Node's
  // EventEmitter turns those into an unhandled 'error' event and kills the
  // process — a transient poll failure must not take the API down with it.
  boss.on('error', (error: unknown) => {
    logger.error({ err: error }, 'queue error');
  });

  // Only the message. A warning's `data` carries the offending SQL and its
  // bound parameter values, which is exactly the payload free text spec §40
  // says must not reach the logs.
  boss.on('warning', (warning: { message: string }) => {
    logger.warn({ warning: warning.message }, 'queue warning');
  });

  await boss.start();
  logger.info({ schema: QUEUE_SCHEMA, worker }, 'queue started');

  return {
    boss,
    worker,
    close: async () => {
      // graceful: stop fetching, let in-flight handlers finish, then close the
      // pool. Abandoning a handler mid-send is the one way this system could
      // produce a duplicate email on the next boot.
      await boss.stop({ graceful: true, close: true, timeout: stopTimeoutMs });
      logger.info('queue stopped');
    },
  };
}

/**
 * Whether the queue answers.
 *
 * Returns `false` rather than throwing, to match `databaseDependencyCheck`:
 * the readiness probe treats a rejection and a `false` identically but reports
 * the former with a stack trace nobody needs for "the queue is down".
 */
export async function checkQueueHealth(boss: PgBoss): Promise<boolean> {
  try {
    return await boss.isInstalled();
  } catch {
    return false;
  }
}

export function queueDependencyCheck(boss: PgBoss): DependencyCheck {
  return {
    name: 'queue',
    probe: () => checkQueueHealth(boss),
    critical: true,
  };
}

export interface QueueDepth {
  readonly name: string;
  /** Jobs waiting that are runnable now, excluding future-dated ones. */
  readonly ready: number;
  readonly active: number;
  /** Recent failures still retained. A rolling count, not an all-time total. */
  readonly failed: number;
}

/** How long the whole reading may take before it is abandoned. */
const QUEUE_STATUS_TIMEOUT_MS = 5_000;

/**
 * Queue depth and failure counts per queue (spec §45 "køstatus", §47 metrics).
 *
 * The dead-letter queue is included, and its `ready` count is the number that
 * matters operationally: those are jobs that exhausted their retries and are
 * waiting for a human. `redrive` puts them back.
 *
 * **Why this asks per queue with `force` instead of one `getQueues` call.**
 * `getQueues` looks like the obvious choice and is the wrong one. It selects
 * `queued_count`, `ready_count`, `active_count` and `failed_count` as *columns
 * on `pgboss.queue`* — a cache, not an aggregate over the job table. Those
 * columns are written only by pg-boss's `cacheQueueStats`, which runs from the
 * monitor loop, which runs from the supervisor, which `PgBoss.start()` starts
 * **only when `supervise` is true** — and `supervise` is `worker` here.
 *
 * So with `getQueues`, an estate where no instance is a worker reports frozen
 * counts, and a queue that has never been monitored reports all-zero. Both are
 * indistinguishable from "empty and healthy" at exactly the moment nothing is
 * being processed. That is a metric whose failure mode is silence during the
 * outage it exists to reveal — the same shape as a test that cannot fail.
 *
 * `getQueueStats(name, { force: true })` closes it. `capturedOn` is
 * `monitor_on`, so a never-monitored queue reads as infinitely stale and is
 * recomputed from the job table; anything older than 60 seconds is likewise
 * recomputed and re-cached. The recompute is a plain `UPDATE … RETURNING` with
 * no advisory lock, so it works from a producer-only replica that runs no
 * monitor at all.
 *
 * **State the guarantee precisely, because it is easy to over-read.** `force`
 * does *not* mean "always fresh": a value computed in the last 60 seconds is
 * reused, so repeated dashboard refreshes do not each re-run the aggregate.
 * What it buys is a *bound* — the reading is never more than about a minute
 * old, with or without a worker running. `getQueues` offers no bound at all
 * once the monitor stops. A test asserting that a job sent a moment ago shows
 * up immediately would fail, and did: that property was never on offer.
 *
 * The cost is one aggregate per queue per minute, on an admin-only,
 * rate-limited path. That would be the wrong trade on a customer route and is
 * the right one here.
 *
 * **What this can and cannot detect, for spec §47.** Because the read
 * recomputes rather than waiting on a monitor, these counts are a usable alert
 * input — a rising `ready` with `active` stuck at zero means work is arriving
 * and nothing is consuming it. That is the consumer-side stall: handlers
 * wedged or throwing while the process is otherwise alive.
 *
 * It does **not** detect the loss of every worker, and the reason is worth
 * spelling out because the metric looks healthy throughout. Cron is gated on
 * the same flag as the handlers — `schedule: worker` above, and pg-boss starts
 * the timekeeper only when `schedule` is true. The three scheduled jobs in
 * `register.ts` are the only producers of `doffin.sync`,
 * `notification.digest.prepare` and `share.cleanup`. So an estate with no
 * worker anywhere enqueues nothing and consumes nothing: `ready` and `active`
 * both sit at zero, now *correctly* computed rather than frozen, and a
 * depth-based alert stays quiet while the entire system is idle. `/ready` does
 * not help either — `checkQueueHealth` is `isInstalled()`, which a
 * producer-only replica passes.
 *
 * So §47 needs both signals, and they are not interchangeable: queue depth for
 * a consumer-side stall, and evidence the work itself produces for "nothing is
 * running at all". Only the second can distinguish a quiet queue from a dead
 * estate, because only the second stops when production stops.
 *
 * That second signal needs no new machinery: `IngestStatusReport` in
 * `services/admin.ts` already carries `lastSuccessfulRunAt` and `lastRun`
 * beside the `queues` field fed from here. An alert reads both off one
 * response — depth for "is anything draining", ingest recency for "is
 * anything being produced". Neither field alone separates an idle Sunday from
 * a dead estate; §12's hourly sync is what makes the pair conclusive.
 *
 * Bounded rather than left to hang: a caller rendering "unavailable" is more
 * use to an operator than a dashboard that never paints. It throws on a
 * missing queue too, which means registration did not run — worth surfacing,
 * not worth papering over by returning the other eleven.
 *
 * One trap worth leaving signposted: `QueueResult.updatedOn` is not a
 * freshness stamp for any of this. It is when the queue's *configuration*
 * changed, and it will read as recent beside counts of any age.
 */
export async function queueStatus(
  boss: PgBoss,
  timeoutMs = QUEUE_STATUS_TIMEOUT_MS,
): Promise<QueueDepth[]> {
  const names: string[] = [...ALL_JOB_NAMES, DEAD_LETTER_QUEUE];

  const reading = Promise.all(
    names.map(async (name): Promise<QueueDepth> => {
      const [stats] = await boss.getQueueStats(name, { force: true });
      if (!stats) throw new Error(`no stats returned for queue ${name}`);
      return {
        name,
        ready: stats.readyCount,
        active: stats.activeCount,
        failed: stats.failedCount,
      };
    }),
  );

  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      reading,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`queue status timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// A `queueConfiguration()` wrapper over `getQueues` was written here and then
// deleted. It returned the cached counts this module has just finished arguing
// against, under a name that implied it returned settings — the kind of helper
// somebody reaches for precisely because it looks safe. Retry settings are
// asserted straight from `boss.getQueue(name)` where they are needed, which is
// one call and no ambiguity.

/** Narrow the loose `string` from `queueStatus` back to a known job name. */
export function isJobName(value: string): value is JobName {
  return (ALL_JOB_NAMES as readonly string[]).includes(value);
}
