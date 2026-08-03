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
