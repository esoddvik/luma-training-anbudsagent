import { and, desc, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import { requireAdmin } from '@luma/auth';
import {
  ingestionCheckpoints,
  ingestionRuns,
  orderRequests,
  tenderShares,
  tenders,
  users,
} from '@luma/db';
import { z } from 'zod';
import { notFound, parseOrThrow, conflict } from '../routes/errors.js';
import { writeAuditEvent } from './audit.js';
import type { Actor, ApiContext } from './context.js';

/**
 * Administration (spec §45).
 *
 * Two rules, and they are the whole file. `requireAdmin` is the first
 * statement of every exported function — in the service, not in a route
 * decorator, so that a future caller reaching these functions from a job or a
 * script is checked too. And "alt skal logges": every function that changes
 * something writes an `admin_audit_events` row in the same request.
 */

export interface IngestStatusReport {
  readonly lastRun: {
    id: string;
    status: string;
    trigger: string;
    fetched: number;
    created: number;
    updated: number;
    unchanged: number;
    failed: number;
    startedAt: Date;
    finishedAt: Date | null;
  } | null;
  readonly lastSuccessfulRunAt: Date | null;
  readonly checkpoint: { lastPublicationDate: string | null; overlapDays: number } | null;
  /**
   * Queue depth per job (spec §45 "køstatus", §38).
   *
   * `null` — not `[]` — when no reader is wired or the read threw, so the
   * dashboard can say "unavailable" instead of drawing an all-zero chart that
   * looks like a healthy idle system.
   *
   * **Bounded staleness, not live counts.** `queueStatus` reads through
   * `getQueueStats(name, { force: true })`, which recomputes from the job
   * table whenever the cached row is older than 60 s — and always when it has
   * never been computed, because `monitor_on` is then NULL. So the numbers are
   * never more than about a minute behind, with or without a worker running.
   * Label them "oppdatert minst hvert minutt" if the surface says anything;
   * "live" would be wrong.
   *
   * Do **not** switch this to `boss.getQueues()`, which is the obvious-looking
   * cheaper call. That reads `ready_count` / `active_count` / `failed_count` as
   * cached columns on `pgboss.queue`, written only by pg-boss's monitor, which
   * runs only where `supervise` is true. With no worker anywhere those freeze
   * at their last value, and a queue that has never been monitored reads as
   * all-zero — indistinguishable from empty and healthy. There is a test in the
   * queue package asserting the divergence: same instant, `getQueues` says
   * `ready: 0` where `getQueueStats` says `ready: 1`.
   *
   * Consequences:
   *
   * - Spec §47's stalled-queue alert needs **two** signals off this report, and
   *   they are not interchangeable. Queue depth detects a *consumer-side*
   *   stall: work arriving with nothing draining it, a rising `ready` while
   *   `active` sits at zero. It keeps updating during that outage precisely
   *   because the read recomputes rather than waiting on a stopped monitor.
   *
   *   It cannot detect a dead estate. `schedule` is gated on the same
   *   `WORKER_ENABLED` flag as the handlers (`queue/boss.ts`), and the cron
   *   entries in `queue/register.ts` are the only producers of `doffin.sync`,
   *   `notification.digest.prepare` and `share.cleanup`. With no worker
   *   anywhere, nothing enqueues *and* nothing consumes, so depth reads a
   *   serene `0/0` — correctly computed, and indistinguishable from an idle
   *   Sunday. `/ready` does not cover the gap either: its queue probe is
   *   `boss.isInstalled()`, which a producer-only replica passes.
   *
   *   The discriminator is evidence the work itself leaves behind, and this
   *   report already carries it: `lastSuccessfulRunAt` and `lastRun`. If
   *   ingest has not advanced in hours, the estate is dead however calm the
   *   queue looks. Alert on both; neither alone is sufficient.
   *
   *   Ingest recency is only a stall signal against a known cadence, and that
   *   cadence is `CRON.doffinSync` in `jobs/names.ts` — currently `0 * * * *`.
   *   Note it is an engineering decision ("hourly is well inside the rate
   *   limit"), **not** a spec requirement: §38 pins the digest scheduler at 15
   *   minutes and says nothing about sync frequency. So a future change to
   *   `CRON.doffinSync` is entirely legitimate, breaks no stated requirement,
   *   and would silently invalidate whatever threshold the alert is tuned to.
   *   Nothing enforces that link; if the cron moves, move the threshold.
   *
   *   (Two earlier versions of this comment were each half right — one said
   *   the depth metric was unusable, which was true of `getQueues` and false
   *   here; the next said depth alone was the signal, which misses the
   *   worker-less estate entirely. Both are recorded because the next person
   *   will otherwise re-derive one of them.)
   * - A queue missing from the registry throws rather than returning the other
   *   eleven, and the handler below downgrades that to `null`. "Unavailable" is
   *   the honest answer when queue registration never ran.
   * - The read is bounded at 5 s and throws rather than hanging, so a wedged
   *   queue cannot hold an admin request open.
   * - No "as of" timestamp is rendered. If one is ever wanted, the honest
   *   source is `monitor_on`; `QueueResult.updatedOn` is when the queue's
   *   *configuration* last changed and would show a plausible recent time next
   *   to older numbers.
   */
  readonly queues:
    readonly { name: string; ready: number; active: number; failed: number }[] | null;
  readonly counts: {
    tenders: number;
    suppressedTenders: number;
    users: number;
    activeShares: number;
    ordersAwaitingHandling: number;
  };
}

/** The dashboard's headline numbers (spec §45, §47). */
export async function getIngestStatus(ctx: ApiContext, actor: Actor): Promise<IngestStatusReport> {
  requireAdmin(actor.role);
  const now = ctx.now();

  const [
    runs,
    successful,
    checkpoints,
    tenderCount,
    suppressedCount,
    userCount,
    activeShares,
    openOrders,
  ] = await Promise.all([
    ctx.db.select().from(ingestionRuns).orderBy(desc(ingestionRuns.startedAt)).limit(1),
    ctx.db
      .select({ finishedAt: ingestionRuns.finishedAt })
      .from(ingestionRuns)
      .where(eq(ingestionRuns.status, 'succeeded'))
      .orderBy(desc(ingestionRuns.startedAt))
      .limit(1),
    ctx.db.select().from(ingestionCheckpoints).limit(1),
    ctx.db.$count(tenders),
    ctx.db.$count(tenders, isNotNull(tenders.suppressedAt)),
    ctx.db.$count(users),
    ctx.db.$count(
      tenderShares,
      and(isNull(tenderShares.revokedAt), gt(tenderShares.expiresAt, now)),
    ),
    ctx.db.$count(orderRequests, inArray(orderRequests.status, ['received', 'in_progress'])),
  ]);

  const lastRun = runs[0];
  const checkpoint = checkpoints[0];

  // A queue read failure must not take the whole dashboard down with it: the
  // ingest figures next to it are what an operator opens this page for during
  // an incident, and those come from the database, which is evidently up.
  let queues: IngestStatusReport['queues'] = null;
  if (ctx.queue) {
    try {
      queues = await ctx.queue.status();
    } catch (error) {
      ctx.logger.error({ err: error }, 'kunne ikke lese køstatus');
      queues = null;
    }
  }

  return {
    lastRun: lastRun
      ? {
          id: lastRun.id,
          status: lastRun.status,
          trigger: lastRun.trigger,
          fetched: lastRun.fetchedCount,
          created: lastRun.createdCount,
          updated: lastRun.updatedCount,
          unchanged: lastRun.unchangedCount,
          failed: lastRun.failedCount,
          startedAt: lastRun.startedAt,
          finishedAt: lastRun.finishedAt,
        }
      : null,
    lastSuccessfulRunAt: successful[0]?.finishedAt ?? null,
    checkpoint: checkpoint
      ? {
          lastPublicationDate: checkpoint.lastPublicationDate,
          overlapDays: checkpoint.overlapDays,
        }
      : null,
    queues,
    counts: {
      tenders: tenderCount,
      suppressedTenders: suppressedCount,
      users: userCount,
      activeShares,
      ordersAwaitingHandling: openOrders,
    },
  };
}

export async function rerunIngest(ctx: ApiContext, actor: Actor) {
  requireAdmin(actor.role);
  const report = await ctx.jobs.runIngest({ adminUserId: actor.userId });

  await writeAuditEvent(ctx, {
    actor,
    action: 'ingest.rerun',
    entityType: 'ingestion_run',
    entityId: report.runId,
    after: {
      status: report.status,
      fetched: report.fetched,
      created: report.created,
      updated: report.updated,
    },
  });

  return report;
}

/**
 * How far back a backfill may be asked to reach, in days.
 *
 * A cap rather than a free parameter. Each fortnight window is its own set of
 * requests against a source this system is deliberately gentle with, so "reach
 * back five years" is a mistyped number away from a very long run nobody
 * intended. A year is more than the two the product needs — the density
 * measurement wants 90 days — and small enough that the worst typo is bounded.
 */
const MAX_BACKFILL_DAYS = 365;

export const backfillSchema = z.object({
  /**
   * Issue dates this many days back. Defaults to the 90 the density
   * measurement is specified over (IDE Agent Spec v3, section 3.2).
   */
  days: z.number().int().min(1).max(MAX_BACKFILL_DAYS).default(90),
});

/**
 * Filling in history the hourly sync cannot reach (`jobs/backfill.ts`).
 *
 * Admin-triggered and never scheduled, which is the point. A backfill re-walks
 * months of issue-date windows; on a cron it would do that every time, for a
 * corpus it already holds, against an API with a request budget. It is a thing
 * an operator does when the corpus is known to be short — after a fresh
 * environment, or before re-measuring the search-surface density — not a thing
 * that should happen quietly on a timer.
 *
 * Rate limited hard at the route, and it runs inline rather than being
 * enqueued: the operator who pressed the button is the one who should see the
 * report, and a backfill that vanishes into a queue is one nobody knows the
 * outcome of. That makes it a long request, which is why the route's limit is
 * one per five minutes.
 */
export async function runBackfillForAdmin(ctx: ApiContext, actor: Actor, body: unknown) {
  requireAdmin(actor.role);
  const input = parseOrThrow(backfillSchema, body ?? {});
  const report = await ctx.jobs.runBackfill({ days: input.days, adminUserId: actor.userId });

  await writeAuditEvent(ctx, {
    actor,
    action: 'ingest.backfill',
    entityType: 'ingestion_run',
    after: {
      days: input.days,
      windows: report.windows,
      fetched: report.fetched,
      created: report.created,
      // Recorded because a truncated window is a known gap in the corpus, and
      // the audit log is where someone looks when the numbers seem short.
      truncatedWindows: [...report.truncatedWindows],
    },
  });

  return report;
}

export const rerunMatchingSchema = z.object({
  tenderIds: z.array(z.uuid()).max(1000).optional(),
  alertProfileId: z.uuid().optional(),
});

export async function rerunMatching(ctx: ApiContext, actor: Actor, body: unknown) {
  requireAdmin(actor.role);
  const input = parseOrThrow(rerunMatchingSchema, body ?? {});
  const report = await ctx.jobs.runMatching({
    ...(input.tenderIds ? { tenderIds: input.tenderIds } : {}),
    ...(input.alertProfileId ? { alertProfileId: input.alertProfileId } : {}),
  });

  await writeAuditEvent(ctx, {
    actor,
    action: 'matching.rerun',
    entityType: 'tender_match',
    after: {
      tendersConsidered: report.tendersConsidered,
      profilesConsidered: report.profilesConsidered,
      matchesWritten: report.matchesWritten,
    },
  });

  return report;
}

export const suppressTenderSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

/**
 * Suppresses an invalid tender (spec §45).
 *
 * Not a delete. The row stays, marked, because matching and the shared view
 * both filter on `suppressed_at` and because an administrator needs to be able
 * to see what was suppressed and why. `reason` is mandatory: an unexplained
 * suppression is indistinguishable from a mistake six months later.
 */
export async function suppressTender(
  ctx: ApiContext,
  actor: Actor,
  tenderId: string,
  body: unknown,
) {
  requireAdmin(actor.role);
  const input = parseOrThrow(suppressTenderSchema, body);

  const rows = await ctx.db.select().from(tenders).where(eq(tenders.id, tenderId)).limit(1);
  const tender = rows[0];
  if (!tender) throw notFound('Anbudet finnes ikke.');
  if (tender.suppressedAt) {
    throw conflict('tender_already_suppressed', 'Anbudet er allerede undertrykt.');
  }

  const now = ctx.now();
  await ctx.db
    .update(tenders)
    .set({ suppressedAt: now, suppressedReason: input.reason, updatedAt: now })
    .where(eq(tenders.id, tenderId));

  await writeAuditEvent(ctx, {
    actor,
    action: 'tender.suppressed',
    entityType: 'tender',
    entityId: tenderId,
    before: { suppressedAt: null },
    after: { suppressedAt: now.toISOString() },
    reason: input.reason,
  });

  return { id: tenderId, suppressedAt: now, reason: input.reason };
}
