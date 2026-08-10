/**
 * The two-letter mark on each trade card in the picker.
 *
 * Derived rather than authored, so a template added in admin gets a mark
 * without anyone remembering to pick one — but derived from the words that
 * carry the name, not from the first two words in it.
 *
 * The naive version (first letter of each of the first two words) rendered
 * «Bygg og anlegg, utførende» and «Bemanning og rekruttering» as the same
 * **BO**, because six of the eight seeded names have «og» in second position
 * and the mark was therefore reading the conjunction rather than the trade.
 * Dropping the joining words is what makes the letters mean something: BA and
 * BR say bygg/anlegg and bemanning/rekruttering.
 *
 * This is a heuristic and it can still collide — nothing here can promise
 * uniqueness for names nobody has written yet. `trade-monogram.test.ts` runs
 * it across the real seeds, so a ninth template that collides with one of the
 * eight fails the suite rather than shipping two identical cards.
 */

/**
 * Norwegian joining words, which are never what a trade is called.
 *
 * Deliberately short: only words that would be skipped in speech when reading
 * the name aloud. Anything nominal — «drift», «vakthold» — stays.
 */
const JOINING_WORDS = new Set(['og', 'av', 'for', 'i', 'med', 'til', 'på', 'eller', 'samt']);

/**
 * A word's leading letter, or `null` if it has none.
 *
 * Punctuation is stripped from the edges so «anlegg,» and «(bygg)» both give
 * their first letter rather than a comma or a bracket.
 */
function leadingLetter(word: string): string | null {
  const letters = word.replace(/[^\p{L}\p{N}]+/gu, '');
  if (letters.length === 0) return null;
  return letters.charAt(0).toLocaleUpperCase('nb-NO');
}

/**
 * Up to two letters for `name`. One letter for a one-word name, which is the
 * correct answer rather than a padded one; the empty string only for a name
 * with no letters in it at all, which the seed schema already forbids.
 */
export function tradeMonogram(name: string): string {
  const words = name.split(/\s+/).filter((word) => word.length > 0);

  const significant = words.filter((word) => {
    const bare = word.replace(/[^\p{L}\p{N}]+/gu, '').toLocaleLowerCase('nb-NO');
    return bare.length > 0 && !JOINING_WORDS.has(bare);
  });

  // A name made entirely of joining words is not a name anyone would write,
  // but falling back to the raw words beats returning nothing for it.
  const source = significant.length > 0 ? significant : words;

  return source
    .map(leadingLetter)
    .filter((letter): letter is string => letter !== null)
    .slice(0, 2)
    .join('');
}
