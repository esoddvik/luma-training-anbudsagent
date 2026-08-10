import { desc, eq, sql } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { getWebDb } from './db';

/**
 * What the Doffin-innhenting admin page reads.
 *
 * Straight from PostgreSQL, like every other read in this app — the API seam in
 * `core-api.ts` exists only for the *actions*, which need a Doffin adapter the
 * web app is not allowed to hold (spec section 36).
 */

export interface IngestRunSummary {
  readonly id: string;
  readonly status: 'running' | 'succeeded' | 'partial' | 'failed';
  readonly trigger: 'schedule' | 'manual' | 'backfill';
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly fetched: number;
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly failed: number;
}

export interface IngestOverview {
  readonly runs: readonly IngestRunSummary[];
  /**
   * Null when no run has ever completed fully.
   *
   * `lastPublicationDate` is itself nullable in the row — a checkpoint can
   * exist with no date on it — and the two cases mean the same thing to a
   * reader, so they are collapsed here rather than surfaced separately.
   */
  readonly checkpoint: { lastPublicationDate: string; overlapDays: number } | null;
  readonly corpus: {
    readonly tenders: number;
    readonly oldest: Date | null;
    readonly newest: Date | null;
    /** Days between oldest and newest, which is what the density query needs. */
    readonly spanDays: number;
  };
  /** Consecutive `partial` or `failed` runs at the head of the history. */
  readonly consecutiveUnhealthyRuns: number;
}

export async function loadIngestOverview(): Promise<IngestOverview> {
  const db = getWebDb();

  const [runs, checkpointRows, corpusRows] = await Promise.all([
    db
      .select({
        id: schema.ingestionRuns.id,
        status: schema.ingestionRuns.status,
        trigger: schema.ingestionRuns.trigger,
        startedAt: schema.ingestionRuns.startedAt,
        finishedAt: schema.ingestionRuns.finishedAt,
        fetched: schema.ingestionRuns.fetchedCount,
        created: schema.ingestionRuns.createdCount,
        updated: schema.ingestionRuns.updatedCount,
        unchanged: schema.ingestionRuns.unchangedCount,
        failed: schema.ingestionRuns.failedCount,
      })
      .from(schema.ingestionRuns)
      .orderBy(desc(schema.ingestionRuns.startedAt))
      .limit(20),
    db
      .select({
        lastPublicationDate: schema.ingestionCheckpoints.lastPublicationDate,
        overlapDays: schema.ingestionCheckpoints.overlapDays,
      })
      .from(schema.ingestionCheckpoints)
      .where(eq(schema.ingestionCheckpoints.source, 'doffin'))
      .limit(1),
    db
      .select({
        tenders: sql<number>`count(*)::int`,
        oldest: sql<Date | null>`min(${schema.tenders.publishedAt})`,
        newest: sql<Date | null>`max(${schema.tenders.publishedAt})`,
      })
      .from(schema.tenders),
  ]);

  const corpus = corpusRows[0];
  const oldest = corpus?.oldest ? new Date(corpus.oldest) : null;
  const newest = corpus?.newest ? new Date(corpus.newest) : null;

  /*
   * Consecutive unhealthy runs at the head, not a total.
   *
   * A count of failures over all time says nothing — one bad afternoon last
   * month leaves it permanently non-zero. A *run* of them is the shape the
   * 2026-08-07 stall actually had: seventy consecutive `partial` runs while
   * every individual one looked like it had done some work, and the checkpoint
   * frozen behind them. That is the number worth putting on a screen.
   */
  let consecutive = 0;
  for (const run of runs) {
    if (run.status === 'partial' || run.status === 'failed') consecutive += 1;
    else break;
  }

  const checkpointRow = checkpointRows[0];

  return {
    runs,
    checkpoint:
      checkpointRow?.lastPublicationDate !== null &&
      checkpointRow?.lastPublicationDate !== undefined
        ? {
            lastPublicationDate: checkpointRow.lastPublicationDate,
            overlapDays: checkpointRow.overlapDays,
          }
        : null,
    corpus: {
      tenders: corpus?.tenders ?? 0,
      oldest,
      newest,
      spanDays:
        oldest && newest ? Math.round((newest.getTime() - oldest.getTime()) / 86_400_000) : 0,
    },
    consecutiveUnhealthyRuns: consecutive,
  };
}
