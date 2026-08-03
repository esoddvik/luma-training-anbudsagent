import type { TenderSourceAdapter } from './adapter.js';
import { normalizeSearchHit, type NormalizedTender } from './normalize.js';
import { doffinSearchHitSchema } from './source-notice.js';

/**
 * The incremental sync run (spec §12).
 *
 * The spec assumed a "modified after" watermark. Doffin has no modification
 * timestamp, filter or sort of any kind, so the watermark is publication-based
 * instead. See `docs/doffin-api-findings.md` §6 for the evidence.
 *
 * Three properties this run must have, each for a concrete reason:
 *
 * - **An overlapping window.** A notice can be published up to seven days
 *   after it was issued, so a tight watermark misses late-published notices
 *   permanently. Ten days is the observed maximum plus margin, and at roughly
 *   32 notices a day it costs about 320 records, well inside the 1000-hit
 *   ceiling even at the observed 99-a-day peak.
 * - **Deduplication by source id.** Page boundaries shift between page sizes
 *   because `publicationDate` has only day granularity and the intra-day tie
 *   break is undocumented. Two identical calls agree, but a boundary is never
 *   a clean cut.
 * - **The watermark advances only on full success.** A partial failure that
 *   moved the watermark would skip everything it did not reach, silently and
 *   permanently.
 */

/** Covers the observed seven-day issue-to-publication lag, with margin. */
export const DEFAULT_OVERLAP_DAYS = 10;

export interface SyncCheckpoint {
  /** Highest publication date fully processed by a previous successful run. */
  publishedThrough: Date;
}

export interface SyncOptions {
  adapter: TenderSourceAdapter;
  checkpoint?: SyncCheckpoint;
  now: Date;
  overlapDays?: number;
  pageSize?: number;
  /** Bounds a first run, which would otherwise walk the whole database. */
  maxPages?: number;
  onWarning?: (warning: { sourceId: string; message: string }) => void;
}

export interface SyncResult {
  normalized: NormalizedTender[];
  pagesFetched: number;
  /** Notices seen more than once across page boundaries, and skipped. */
  duplicatesSkipped: number;
  /** True when the run stopped at maxPages rather than reaching the window edge. */
  truncated: boolean;
  /** The checkpoint to store, but only if persistence succeeds. */
  nextCheckpoint: SyncCheckpoint;
  warnings: Array<{ sourceId: string; message: string }>;
}

export function windowStart(
  checkpoint: SyncCheckpoint | undefined,
  overlapDays: number,
): Date | undefined {
  if (!checkpoint) return undefined;
  return new Date(checkpoint.publishedThrough.getTime() - overlapDays * 86_400_000);
}

export async function runSync(options: SyncOptions): Promise<SyncResult> {
  const overlapDays = options.overlapDays ?? DEFAULT_OVERLAP_DAYS;
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 10;
  const from = windowStart(options.checkpoint, overlapDays);

  const seen = new Set<string>();
  const normalized: NormalizedTender[] = [];
  const warnings: Array<{ sourceId: string; message: string }> = [];
  let duplicatesSkipped = 0;
  let pagesFetched = 0;
  let reachedWindowEdge = false;
  let highestPublished = options.checkpoint?.publishedThrough;

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await options.adapter.fetchNotices({
      page,
      pageSize,
      ...(from ? { publishedFrom: from } : {}),
    });
    pagesFetched += 1;

    for (const notice of result.notices) {
      if (seen.has(notice.sourceId)) {
        duplicatesSkipped += 1;
        continue;
      }
      seen.add(notice.sourceId);

      const hit = doffinSearchHitSchema.parse(notice.payload);
      const entry = normalizeSearchHit(hit, { now: options.now });

      for (const warning of entry.warnings) {
        const record = { sourceId: notice.sourceId, message: warning.message };
        warnings.push(record);
        options.onWarning?.(record);
      }

      normalized.push(entry);
      if (!highestPublished || notice.publishedAt > highestPublished) {
        highestPublished = notice.publishedAt;
      }
    }

    // Sorted publication-date descending, so once the oldest notice on a page
    // predates the window there is nothing newer further back.
    const oldest = result.notices.at(-1);
    if (from && oldest && oldest.publishedAt < from) {
      reachedWindowEdge = true;
      break;
    }
    if (!result.hasMore) {
      reachedWindowEdge = true;
      break;
    }
  }

  return {
    normalized,
    pagesFetched,
    duplicatesSkipped,
    truncated: !reachedWindowEdge,
    // Falls back to the previous checkpoint when a run returned nothing, so an
    // empty result cannot rewind the watermark to the epoch.
    nextCheckpoint: {
      publishedThrough: highestPublished ?? options.checkpoint?.publishedThrough ?? options.now,
    },
    warnings,
  };
}
