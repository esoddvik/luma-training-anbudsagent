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

/**
 * Queue depth and failure counts per queue (spec §45 "køstatus", §47 metrics).
 *
 * The dead-letter queue is included, and its `ready` count is the number that
 * matters operationally: those are jobs that exhausted their retries and are
 * waiting for a human. `redrive` puts them back.
 *
 * **These numbers are a cache, and the thing that refreshes it is the thing
 * that can fail.** Read the chain before building an alert on them:
 * `getQueues` selects `queued_count`, `ready_count`, `active_count` and
 * `failed_count` as *columns on `pgboss.queue`*, not as an aggregate over the
 * job table. Those columns are written only by pg-boss's `cacheQueueStats`,
 * which runs from the monitor loop, which runs from the supervisor, which
 * `PgBoss.start()` starts **only when `supervise` is true** — and `supervise`
 * is `worker` here. Refresh is roughly every 60 seconds
 * (`monitorIntervalSeconds`, `superviseIntervalSeconds`).
 *
 * Three consequences, in increasing order of how much they would hurt:
 *
 * 1. A reading can be up to about a minute old. Fine for a dashboard.
 * 2. A `WORKER_ENABLED=false` replica still reports truthfully, because the
 *    cache lives in the shared database and some worker refreshes it. Queue
 *    depth is a property of the database, not of the process reading it.
 * 3. **If no instance is a worker, these numbers freeze silently.** Nothing
 *    refreshes them, every field keeps its last value, and a queue that has
 *    never been monitored reads as all-zero — indistinguishable from empty and
 *    healthy. So spec §47's "stalled queue" alert must not be built on these
 *    counts alone: the failure it needs to detect is the same failure that
 *    stops the metric updating, and the alert would sit quiet through exactly
 *    the outage it exists for. Anchor that alert on evidence produced by the
 *    work itself — `ingestion_runs` advancing, `notification_deliveries`
 *    being written — which is what the runbook already tells the operator to
 *    watch.
 *
 * `QueueResult.updatedOn` is not a freshness stamp for any of this; it is when
 * the queue's *configuration* changed. The stats timestamp is `monitor_on`,
 * which `getQueues` does not return.
 */
export async function queueStatus(boss: PgBoss): Promise<QueueDepth[]> {
  const names: string[] = [...ALL_JOB_NAMES, DEAD_LETTER_QUEUE];
  const queues = await boss.getQueues(names);
  return queues.map((queue) => ({
    name: queue.name,
    ready: queue.readyCount,
    active: queue.activeCount,
    failed: queue.failedCount,
  }));
}

/** Narrow the loose `string` from `queueStatus` back to a known job name. */
export function isJobName(value: string): value is JobName {
  return (ALL_JOB_NAMES as readonly string[]).includes(value);
}
