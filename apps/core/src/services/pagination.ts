import { z } from 'zod';
import { badRequest } from '../routes/errors.js';

/**
 * Cursor pagination for every list endpoint (spec §39).
 *
 * Keyset rather than offset. An offset over a table that is being written to
 * by the ingest job silently skips and repeats rows between pages, and the
 * tender list is exactly that table. The cursor carries the sort key and the
 * row id, so the next page starts at a row rather than at a position.
 *
 * The limit is capped rather than trusted. An uncapped `limit` on a joined
 * query is a denial-of-service parameter with a friendly name.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const paginationQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Cursor {
  /** The sort value of the last row on the previous page, as ISO or text. */
  readonly key: string;
  /** Tie-break, so rows sharing a sort value are never skipped. */
  readonly id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.key, cursor.id]), 'utf8').toString('base64url');
}

/**
 * Decodes a cursor, or rejects it.
 *
 * A malformed cursor is the caller's mistake, not a server error, and it must
 * not reach the query builder: an unvalidated value would end up in a
 * comparison against a timestamp column and surface as a database error.
 */
export function decodeCursor(raw: string | undefined): Cursor | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw badRequest('invalid_cursor', 'Sidemarkøren er ugyldig. Hent listen på nytt.');
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    throw badRequest('invalid_cursor', 'Sidemarkøren er ugyldig. Hent listen på nytt.');
  }
  const [key, id] = parsed;
  if (typeof key !== 'string' || typeof id !== 'string') {
    throw badRequest('invalid_cursor', 'Sidemarkøren er ugyldig. Hent listen på nytt.');
  }
  return { key, id };
}

export interface Page<T> {
  readonly items: readonly T[];
  /** Absent when this is the last page. */
  readonly nextCursor?: string;
}

/**
 * Builds a page from `limit + 1` rows.
 *
 * Fetching one extra row is how "is there more" is answered without a second
 * count query, which over a joined, filtered set would cost as much as the
 * page itself.
 */
export function toPage<T>(
  rows: readonly T[],
  limit: number,
  cursorOf: (row: T) => Cursor,
): Page<T> {
  if (rows.length <= limit) return { items: rows };
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  if (!last) return { items };
  return { items, nextCursor: encodeCursor(cursorOf(last)) };
}
