import { inArray } from 'drizzle-orm';
import { tenders, type Database } from '@luma/db';
import type { Tender } from '@luma/domain';
import { hydrateTenders } from './tender-projection.js';

/**
 * Loading full domain tenders by id.
 *
 * A named entry point for the callers that already know which tenders they
 * want — the digest sender, the immediate alert, the change notification —
 * as opposed to `loadTendersForMatching`, which selects them. Both go through
 * the same projection in `tender-projection.ts`, so an email and a preview can
 * never disagree about what a tender looks like.
 *
 * Unlike the list endpoints, this does not filter out suppressed tenders: the
 * caller has already decided what it is sending, and silently dropping a row
 * here would produce a digest whose item count disagrees with its contents.
 */
export async function loadTendersByIds(db: Database, ids: readonly string[]): Promise<Tender[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(tenders)
    .where(inArray(tenders.id, [...ids]));
  return hydrateTenders(db, rows);
}
