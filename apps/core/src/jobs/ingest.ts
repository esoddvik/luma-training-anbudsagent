import { eq } from 'drizzle-orm';
import type { Database } from '@luma/db';
import { ingestionCheckpoints, ingestionErrors, ingestionRuns } from '@luma/db';
import {
  DEFAULT_OVERLAP_DAYS,
  runSync,
  type SyncCheckpoint,
  type TenderSourceAdapter,
} from '@luma/doffin';
import type { Logger } from '@luma/observability';
import {
  notifiableTenderIds,
  summarizeOutcomes,
  upsertTender,
  type UpsertResult,
} from '../services/tender-repository.js';

/**
 * The Doffin ingest run (spec §12).
 *
 * The rule that shapes the whole function is step 10: **the checkpoint must
 * not advance after a partial failure.** A checkpoint that moved past notices
 * we failed to store would skip them forever, silently, and no user would ever
 * learn that a tender they wanted never arrived. So the checkpoint is written
 * exactly once, at the end, only when nothing failed, and the run row records
 * what happened either way.
 */

export interface IngestOptions {
  db: Database;
  adapter: TenderSourceAdapter;
  logger: Logger;
  now: Date;
  /** Set when an administrator triggered the run rather than the schedule. */
  triggeredByAdminId?: string;
  maxPages?: number;
  pageSize?: number;
}

export interface IngestReport {
  runId: string;
  status: 'succeeded' | 'partial' | 'failed';
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  /** Tenders whose material change should reach users who saved them. */
  changedTenderIds: string[];
  /** New or changed tenders worth running matching for. */
  matchableTenderIds: string[];
  checkpointAdvanced: boolean;
}

/** Doffin's `publicationDate` is a bare date, and the checkpoint stores it as one. */
function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function fromDateString(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export async function runIngest(options: IngestOptions): Promise<IngestReport> {
  const { db, adapter, logger, now } = options;

  const checkpointRows = await db
    .select()
    .from(ingestionCheckpoints)
    .where(eq(ingestionCheckpoints.source, 'doffin'))
    .limit(1);
  const stored = checkpointRows[0];

  const overlapDays = stored?.overlapDays ?? DEFAULT_OVERLAP_DAYS;
  const checkpoint: SyncCheckpoint | undefined = stored?.lastPublicationDate
    ? { publishedThrough: fromDateString(stored.lastPublicationDate) }
    : undefined;

  const runRows = await db
    .insert(ingestionRuns)
    .values({
      source: 'doffin',
      status: 'running',
      trigger: options.triggeredByAdminId ? 'manual' : 'schedule',
      triggeredByAdminId: options.triggeredByAdminId ?? null,
      windowFrom: checkpoint
        ? new Date(checkpoint.publishedThrough.getTime() - overlapDays * 86_400_000)
        : null,
      windowTo: now,
      startedAt: now,
    })
    .returning({ id: ingestionRuns.id });

  const runId = runRows[0]?.id;
  if (!runId) throw new Error('failed to create ingestion run');

  try {
    const sync = await runSync({
      adapter,
      now,
      overlapDays,
      ...(checkpoint ? { checkpoint } : {}),
      ...(options.maxPages ? { maxPages: options.maxPages } : {}),
      ...(options.pageSize ? { pageSize: options.pageSize } : {}),
      onWarning: (warning) => {
        logger.warn({ sourceId: warning.sourceId }, warning.message);
      },
    });

    const results: UpsertResult[] = [];
    let failed = 0;

    for (const normalized of sync.normalized) {
      try {
        results.push(await upsertTender(db, normalized, { ingestionRunId: runId }));
      } catch (error) {
        failed += 1;
        // One bad notice must not abandon the rest of the window. It is
        // recorded so the run is diagnosable, and it blocks the checkpoint.
        logger.error(
          { err: error, sourceId: normalized.tender.sourceId },
          'failed to persist tender',
        );
        await db.insert(ingestionErrors).values({
          runId,
          sourceId: normalized.tender.sourceId,
          stage: 'upsert',
          message: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }

    const counts = summarizeOutcomes(results);
    const changedTenderIds = notifiableTenderIds(results);
    const matchableTenderIds = results
      .filter((result) => result.outcome !== 'unchanged')
      .map((result) => result.tenderId);

    // Truncation is not a failure, but it does mean the window was not fully
    // covered, so the checkpoint must not move past what we actually read.
    const complete = failed === 0 && !sync.truncated;
    const status = failed > 0 ? 'partial' : 'succeeded';

    await db
      .update(ingestionRuns)
      .set({
        status,
        fetchedCount: sync.normalized.length,
        createdCount: counts.created,
        updatedCount: counts.updated,
        unchangedCount: counts.unchanged,
        failedCount: failed,
        matchJobsEnqueued: matchableTenderIds.length,
        finishedAt: new Date(),
      })
      .where(eq(ingestionRuns.id, runId));

    if (complete) {
      const publishedThrough = toDateString(sync.nextCheckpoint.publishedThrough);
      await db
        .insert(ingestionCheckpoints)
        .values({
          source: 'doffin',
          lastSuccessfulRunId: runId,
          lastPublicationDate: publishedThrough,
          overlapDays,
        })
        .onConflictDoUpdate({
          target: ingestionCheckpoints.source,
          set: {
            lastSuccessfulRunId: runId,
            lastPublicationDate: publishedThrough,
            updatedAt: new Date(),
          },
        });
    } else {
      logger.warn(
        { runId, failed, truncated: sync.truncated },
        'checkpoint held back: the window was not fully covered',
      );
    }

    return {
      runId,
      status,
      fetched: sync.normalized.length,
      ...counts,
      failed,
      changedTenderIds,
      matchableTenderIds,
      checkpointAdvanced: complete,
    };
  } catch (error) {
    logger.error({ err: error, runId }, 'ingestion run failed');
    await db
      .update(ingestionRuns)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : 'unknown error',
      })
      .where(eq(ingestionRuns.id, runId));
    throw error;
  }
}
