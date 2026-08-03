import { containsPhrase, normalizeSearchText } from '@luma/domain';

/**
 * Small deterministic helpers shared by the scorers.
 *
 * Everything here is pure and free of locale APIs. `Intl` is deliberately not
 * used: its output depends on the ICU version bundled with the runtime, which
 * would make the golden-file test fail on a different Node build for reasons
 * that have nothing to do with matching.
 */

/** Two decimals. Enough to keep contributions readable and sums exact-ish. */
const SCORE_FACTOR = 100;

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Rounds a contribution or a score to two decimals.
 *
 * `-0` is normalised to `0` so that a snapshot never records a negative zero
 * for a component that simply scored nothing.
 */
export function roundScore(value: number): number {
  const rounded = Math.round(value * SCORE_FACTOR) / SCORE_FACTOR;
  return rounded === 0 ? 0 : rounded;
}

/** Milliseconds in a day, for deadline arithmetic. */
const MS_PER_DAY = 86_400_000;

/** Fractional days from `now` until `deadline`. Negative once the date passed. */
export function daysUntil(deadline: Date, now: Date): number {
  return (deadline.getTime() - now.getTime()) / MS_PER_DAY;
}

/**
 * `dd.MM.yyyy` from the UTC parts of a date.
 *
 * Rendering in the user's timezone is the presentation layer's job; doing it
 * here would make evidence strings depend on the server's `TZ`, and evidence
 * is stored and compared.
 */
export function formatDateNb(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${day}.${month}.${year}`;
}

/** `21,88` — Norwegian decimal comma, and no trailing zeros on whole points. */
export function formatPoints(value: number): string {
  const rounded = roundScore(value);
  if (Number.isInteger(rounded)) return `${rounded}`;
  return rounded.toFixed(2).replace('.', ',');
}

/** `1 500 000 kr`, grouped with plain spaces so the string is byte-stable. */
export function formatNok(amount: number): string {
  const rounded = Math.round(amount);
  const digits = Math.abs(rounded).toString();
  let grouped = '';
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) grouped += ' ';
    grouped += digits.charAt(index);
  }
  return `${rounded < 0 ? '-' : ''}${grouped} kr`;
}

/**
 * Orders strings by their normalised form, falling back to the raw string.
 *
 * Every evidence array is sorted with this, which is what makes the engine
 * insensitive to the order of `cpvInclude`, `keywordsInclude` and friends.
 * `localeCompare` is avoided for the same reason `Intl` is: it is ICU-dependent.
 */
export function compareNormalized(a: string, b: string): number {
  const normalizedA = normalizeSearchText(a);
  const normalizedB = normalizeSearchText(b);
  if (normalizedA < normalizedB) return -1;
  if (normalizedA > normalizedB) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Deduplicates by normalised form (keeping the smallest raw spelling) and
 * returns the survivors in a stable order.
 */
export function sortedUnique(values: readonly string[]): string[] {
  const bySignature = new Map<string, string>();
  for (const value of values) {
    const signature = normalizeSearchText(value);
    if (signature.length === 0) continue;
    const existing = bySignature.get(signature);
    if (existing === undefined || value < existing) bySignature.set(signature, value);
  }
  return [...bySignature.values()].sort(compareNormalized);
}

/**
 * Whole-word containment of `needle` inside `candidate`.
 *
 * Delegates to the domain helper so that Norwegian folding and the
 * "bad" / "badevakt" rule are defined in exactly one place.
 */
export function nameContains(candidate: string, needle: string): boolean {
  return containsPhrase(candidate, needle);
}

/**
 * Place-name matching, deliberately bidirectional.
 *
 * A region and a municipality are two labels for the same hierarchy, and the
 * source and the user rarely spell them the same way: Doffin may say "Oslo"
 * where the profile says "Oslo kommune", or the reverse. Both directions are
 * the same claim about geography, so both count.
 *
 * Buyer names get the one-directional rule instead (see `buyerMatches`),
 * because there the loose direction would let a short profile entry swallow
 * unrelated organisations.
 */
export function placeMatches(tenderPlace: string, profilePlace: string): boolean {
  return nameContains(tenderPlace, profilePlace) || nameContains(profilePlace, tenderPlace);
}

/** Digits only, so an organisation number compares regardless of spacing. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}
