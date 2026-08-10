import { eq } from 'drizzle-orm';
import { normalizeSearchHit, type TenderSourceAdapter } from '@luma/doffin';
import type { Database } from '@luma/db';
import { ingestionRuns } from '@luma/db';
import type { Logger } from '@luma/observability';
import { upsertTender } from '../services/tender-repository.js';

/**
 * Reaching further back than the forward sync can (spec §12, `docs/doffin-api-findings.md`).
 *
 * ## Why the ordinary ingest cannot do this
 *
 * `runIngest` walks *forward* from a publication-date watermark, and Doffin
 * serves at most 1000 hits per query however you page it. So the corpus the
 * hourly sync can ever hold is "the most recent ~1000 notices" — which is
 * about five weeks — and advancing the checkpoint does not change that. It
 * moves the window's leading edge; it never fills in what is behind it.
 *
 * The only lever the API offers is `issueDateFrom`/`issueDateTo`, filterable
 * at day granularity. A month window returned 939 hits when measured, so this
 * partitions into windows and walks them backwards, each one its own query
 * against its own 1000-hit budget.
 *
 * ## Why the window is a fortnight and not a month
 *
 * 939 of 1000 is not headroom. A month with an unusually busy fortnight would
 * silently truncate, and truncation here is invisible: the run reports what it
 * fetched, and what it never saw leaves no trace. Halving the window buys a
 * factor of two against a corpus that grows, and the cost is more requests
 * against an API this is deliberately gentle with.
 *
 * **Truncation is still reported rather than assumed away.** If a window comes
 * back at its accessible ceiling, that window is logged as incomplete: better
 * a known gap than a silent one.
 *
 * ## What this deliberately does not do
 *
 * It does not touch `ingestion_checkpoints`. The checkpoint is the forward
 * sync's watermark and means "everything published through here has been
 * seen"; a backfill filling in history says nothing about that, and moving it
 * would make the next hourly run skip whatever arrived meanwhile.
 *
 * It also enqueues no matching. Backfilled notices are historical — most are
 * long closed — and running them through matching would put months of expired
 * competitions into people's digests. `runIngest` enqueues matching because
 * its notices are new; this one is filling in the past.
 */

export interface BackfillOptions {
  db: Database;
  adapter: TenderSourceAdapter;
  logger: Logger;
  /** Oldest issue date to reach. */
  from: Date;
  /** Newest issue date to reach. Defaults to now. */
  to?: Date;
  /** Days per query window. */
  windowDays?: number;
  pageSize?: number;
  /** Bounds one window, as a guard against a runaway page loop. */
  maxPagesPerWindow?: number;
}

export interface BackfillReport {
  windows: number;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  /** Windows that hit the accessible ceiling and may be missing notices. */
  truncatedWindows: string[];
}

const DEFAULT_WINDOW_DAYS = 14;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 10;

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function runBackfill(options: BackfillOptions): Promise<BackfillReport> {
  const {
    db,
    adapter,
    logger,
    from,
    to = new Date(),
    windowDays = DEFAULT_WINDOW_DAYS,
    pageSize = DEFAULT_PAGE_SIZE,
    maxPagesPerWindow = DEFAULT_MAX_PAGES,
  } = options;

  const [run] = await db
    .insert(ingestionRuns)
    .values({
      source: 'doffin',
      status: 'running',
      trigger: 'backfill',
      windowFrom: from,
      windowTo: to,
    })
    .returning({ id: ingestionRuns.id });

  const report: BackfillReport = {
    windows: 0,
    fetched: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    truncatedWindows: [],
  };

  // Backwards, newest window first: if the run is interrupted, what it did
  // finish is contiguous with the corpus the forward sync already holds rather
  // than an island of old notices with a hole in front of it.
  let windowEnd = to;
  while (windowEnd > from) {
    const windowStart = new Date(
      Math.max(addDays(windowEnd, -windowDays).getTime(), from.getTime()),
    );
    report.windows += 1;

    for (let page = 1; page <= maxPagesPerWindow; page += 1) {
      const result = await adapter.fetchNotices({
        issuedFrom: windowStart,
        issuedTo: windowEnd,
        page,
        pageSize,
      });

      if (page === 1 && result.accessibleMatches >= 1000) {
        // The ceiling. Narrower windows would be needed to see the rest, and
        // saying so is the whole point — a truncated window that reported
        // success would be a gap nobody could find later.
        report.truncatedWindows.push(`${day(windowStart)}..${day(windowEnd)}`);
        logger.warn(
          { from: day(windowStart), to: day(windowEnd), accessible: result.accessibleMatches },
          'backfill window hit the accessible ceiling; it may be missing notices',
        );
      }

      for (const notice of result.notices) {
        report.fetched += 1;
        try {
          const normalized = normalizeSearchHit(notice.payload as never, { now: new Date() });
          const outcome = await upsertTender(db, normalized, { ingestionRunId: run?.id });
          if (outcome.outcome === 'created') report.created += 1;
          else if (outcome.outcome === 'updated') report.updated += 1;
          else report.unchanged += 1;
        } catch (error) {
          report.failed += 1;
          logger.warn(
            { sourceId: notice.sourceId, reason: error instanceof Error ? error.name : 'unknown' },
            'backfill could not persist a notice',
          );
        }
      }

      if (!result.hasMore) break;
    }

    logger.info({ from: day(windowStart), to: day(windowEnd), ...report }, 'backfill window done');
    windowEnd = addDays(windowStart, -1);
  }

  await db
    .update(ingestionRuns)
    .set({
      status: report.failed > 0 ? 'partial' : 'succeeded',
      finishedAt: new Date(),
      fetchedCount: report.fetched,
      createdCount: report.created,
      updatedCount: report.updated,
      unchangedCount: report.unchanged,
      failedCount: report.failed,
    })
    .where(eq(ingestionRuns.id, run!.id));

  return report;
}
