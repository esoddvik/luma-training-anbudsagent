import { CPV_VOCABULARY, type CpvEntry } from './cpv-vocabulary.js';
import { normalizeSearchText, tokenize } from './text.js';

/**
 * Ranked plain-word search over the CPV vocabulary (IDE Agent Spec, R7).
 *
 * ## Why this is a second search rather than an edit to the first
 *
 * `searchCpv` in `cpv-vocabulary.ts` sorts by a *tier*: the best rule any one
 * entry satisfies decides its place, and everything else about the entry is
 * discarded. That is enough for «vinduspuss», where one rule fires and one
 * entry wins. It is not enough for a phrase.
 *
 * «vask av vinduer» is the case that forced this file. Under tiers, 90910000
 * («Renholdstjenester», synonym «vask») and 90911300 («Vinduspuss», synonym
 * «vask av vinduer») can land on the same rung, and the tie then falls to
 * whichever code sorts first — which is the wrong one. A supplier who washes
 * windows is told to file under general cleaning.
 *
 * So this ranking **accumulates**. An entry's score is the strongest rule the
 * whole query satisfies, *plus* a bonus for every query word that also lands
 * somewhere in its synonyms. Matching the whole phrase and both of its words
 * beats matching one word, which is the property a phrase search needs and the
 * property a tier cannot express. Nothing here changes `searchCpv`; the two
 * coexist and callers pick.
 *
 * ## The weights
 *
 * Fixed by the spec, and written as named constants because their *ordering*
 * is the contract:
 *
 * | Rule | Points |
 * | --- | --- |
 * | The query's digits prefix the code | 100 |
 * | The category name contains the query | 90 |
 * | A synonym is exactly the query | 80 |
 * | A synonym starts with the query | 70 |
 * | The CPV division name contains the query | 60 |
 * | *per word ≥ 4 letters:* a synonym starts with it | 50 |
 * | *per word ≥ 4 letters:* a synonym contains it | 30 |
 *
 * Words shorter than four letters earn nothing. «av», «og», «i» are in half the
 * synonyms in the table, and a bonus for them would rank on grammar.
 *
 * Pure, no I/O, no clock. `cpv-search.test.ts` holds the acceptance queries.
 */

/** The query's digits are a prefix of the code. The most literal hit there is. */
const POINTS_CODE_PREFIX = 100;
/** The Norwegian category name contains the query. */
const POINTS_NAME_CONTAINS = 90;
/** A synonym is the query, exactly. */
const POINTS_SYNONYM_EXACT = 80;
/** A synonym begins with the query. */
const POINTS_SYNONYM_PREFIX = 70;
/** The CPV division heading contains the query. Weakest whole-query rule. */
const POINTS_GROUP_CONTAINS = 60;
/** One query word begins a synonym. */
const POINTS_TOKEN_SYNONYM_PREFIX = 50;
/** One query word appears inside a synonym without beginning it. */
const POINTS_TOKEN_SYNONYM_CONTAINS = 30;

/** Below this a word is grammar rather than meaning, and scores nothing. */
const MIN_TOKEN_LENGTH = 4;

/** Six. A picker is a shortlist; a seventh row is a wall (design A3). */
export const CPV_SEARCH_LIMIT = 6;

export interface CpvSearchHit {
  readonly entry: CpvEntry;
  /**
   * The accumulated score. Exposed for tests and for debugging a ranking, and
   * for nothing else — **it must never be rendered.** Spec 4.3 forbids a
   * number anywhere near a relevance claim, and this is one.
   */
  readonly score: number;
}

/**
 * What to say when nothing matched.
 *
 * Points at keywords rather than apologising: a supplier whose trade has no CPV
 * category of its own has not made a mistake, and the product has a second
 * mechanism — free-text keywords search the notice itself — that does cover
 * them. A dead end here would hide a working alternative.
 */
export function cpvSearchEmptyMessage(query: string): string {
  return (
    `Ingen kategori matcher «${query.trim()}». Prøv et bredere ord — «renhold» framfor ` +
    '«gulvbelegg». Du kan også bruke søkeord i stedet, de leter i selve teksten.'
  );
}

function wholeQueryScore(entry: CpvEntry, query: string, digits: string): number {
  if (digits.length > 0 && entry.code.startsWith(digits)) return POINTS_CODE_PREFIX;
  if (normalizeSearchText(entry.name).includes(query)) return POINTS_NAME_CONTAINS;

  let best = 0;
  for (const synonym of entry.synonyms) {
    const value = normalizeSearchText(synonym);
    if (value === query) return POINTS_SYNONYM_EXACT;
    if (value.startsWith(query)) best = Math.max(best, POINTS_SYNONYM_PREFIX);
  }
  if (best > 0) return best;

  return normalizeSearchText(entry.group).includes(query) ? POINTS_GROUP_CONTAINS : 0;
}

/** The best a single word can earn against one entry's synonyms. */
function tokenScore(entry: CpvEntry, token: string): number {
  let best = 0;
  for (const synonym of entry.synonyms) {
    const value = normalizeSearchText(synonym);
    if (value.startsWith(token)) return POINTS_TOKEN_SYNONYM_PREFIX;
    if (value.includes(token)) best = POINTS_TOKEN_SYNONYM_CONTAINS;
  }
  return best;
}

/**
 * Rank the vocabulary against a plain-language query, best first.
 *
 * An empty or whitespace-only query returns nothing rather than everything —
 * see `searchCpv`'s note on the same decision. Entries scoring zero are
 * dropped, so an empty array means «say so», not «show fewer».
 *
 * Ties break on the code, ascending, so the order is stable across runs and a
 * test can assert a whole list rather than only its head.
 */
export function searchCpvRanked(
  query: string,
  limit: number = CPV_SEARCH_LIMIT,
): readonly CpvSearchHit[] {
  const normalized = normalizeSearchText(query);
  if (normalized.length === 0 || limit <= 0) return [];

  const digits = normalized.replace(/\D/g, '');
  const tokens = [...new Set(tokenize(normalized))].filter(
    (token) => token.length >= MIN_TOKEN_LENGTH,
  );

  const hits: CpvSearchHit[] = [];
  for (const entry of CPV_VOCABULARY) {
    let score = wholeQueryScore(entry, normalized, digits);
    for (const token of tokens) score += tokenScore(entry, token);
    if (score > 0) hits.push({ entry, score });
  }

  hits.sort((a, b) => b.score - a.score || a.entry.code.localeCompare(b.entry.code));
  return hits.slice(0, limit);
}

/** The entries alone, for a caller that only renders them. */
export function searchCpvEntries(
  query: string,
  limit: number = CPV_SEARCH_LIMIT,
): readonly CpvEntry[] {
  return searchCpvRanked(query, limit).map((hit) => hit.entry);
}
