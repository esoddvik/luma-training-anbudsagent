import { invalidInput } from './errors.js';

/**
 * Cursor pagination with a hard cap.
 *
 * The caller is a language model, and a model asked to "get everything" will
 * cheerfully pass `limit: 10000`. Spec section 29 also makes this the live
 * demo surface, so a single call must never turn into a table scan on stage.
 *
 * Two numbers therefore govern every listing tool:
 *
 * - `DEFAULT_PAGE_LIMIT` (20) when the caller says nothing. Enough for a
 *   useful answer, small enough that a model can read it back in full.
 * - `MAX_PAGE_LIMIT` (50) as the ceiling. A larger request is **clamped, not
 *   rejected**: refusing would send the model into a retry loop, while
 *   clamping gives it a usable page plus a cursor for the rest.
 *
 * `MAX_MATCH_CANDIDATES` is the separate bound on `find_matching_tenders`,
 * which has to score a candidate set before it can rank and page it.
 */

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 50;

/**
 * The most tenders `find_matching_tenders` will score in one call.
 *
 * Ranking needs the whole candidate set, so this is the real cost ceiling of
 * that tool: at most 500 pure, in-process `matchTender` calls. When the
 * database layer starts persisting matches, the bound moves into the query and
 * this constant only guards the fallback path.
 */
export const MAX_MATCH_CANDIDATES = 500;

/** Norwegian note appended when a caller's `limit` was clamped. */
export function limitNoteNb(requested: number | undefined): string | null {
  if (requested === undefined || requested <= MAX_PAGE_LIMIT) return null;
  return `Du ba om ${requested} treff. Maks per side er ${MAX_PAGE_LIMIT}. Bruk nesteCursor for å hente flere.`;
}

/** Clamps a requested page size into `[1, MAX_PAGE_LIMIT]`. */
export function resolveLimit(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_LIMIT);
}

/**
 * Cursors are opaque to the caller.
 *
 * Base64url of a tiny JSON object rather than a bare number, so that the wire
 * format can gain a keyset key later without any client learning to parse it.
 * There is no signature: the payload is an offset, it carries no authority,
 * and every request re-authenticates and re-scopes independently.
 */
interface CursorPayload {
  readonly o: number;
}

export function encodeCursor(offset: number): string {
  const payload: CursorPayload = { o: offset };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

const CURSOR_ERROR_NB =
  'Ugyldig cursor. Bruk verdien fra nesteCursor i forrige svar, eller utelat feltet for å starte fra begynnelsen.';

export function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor.length === 0) return 0;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalidInput(CURSOR_ERROR_NB);
  }

  if (typeof parsed !== 'object' || parsed === null) throw invalidInput(CURSOR_ERROR_NB);
  const offset = (parsed as { o?: unknown }).o;
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    throw invalidInput(CURSOR_ERROR_NB);
  }
  return offset;
}

/** The cursor for the next page, or null when this page was the last one. */
export function nextCursor(offset: number, pageSize: number, hasMore: boolean): string | null {
  return hasMore ? encodeCursor(offset + pageSize) : null;
}

/** Pages an already-ordered in-memory list, the way the match tool needs. */
export function slicePage<T>(
  items: readonly T[],
  offset: number,
  limit: number,
): { readonly items: readonly T[]; readonly hasMore: boolean } {
  const page = items.slice(offset, offset + limit);
  return { items: page, hasMore: offset + page.length < items.length };
}
