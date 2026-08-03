/**
 * Text normalisation shared by matching and search (spec section 11.1:
 * case-insensitive matching and normalisation of Norwegian characters).
 *
 * The rule that matters: æ, ø and å are folded to ae, oe and aa rather than
 * stripped of their diacritics by Unicode decomposition. NFD would turn "å"
 * into "a", which collapses "mål" and "mal" onto the same token and produces
 * wrong matches in Norwegian. Both the profile keyword and the tender text
 * pass through this function, so the folding only has to be consistent.
 */

/**
 * Unicode combining marks, matched by general category so that the source
 * stays ASCII: the literal characters are invisible in an editor.
 */
const COMBINING_MARKS = /\p{M}/gu;

const NORWEGIAN_FOLDINGS: ReadonlyArray<readonly [RegExp, string]> = [
  [/æ/g, 'ae'],
  [/ø/g, 'oe'],
  [/å/g, 'aa'],
];

/**
 * Lowercases, folds Norwegian letters, strips remaining diacritics from
 * imported words, and collapses whitespace.
 */
export function normalizeSearchText(input: string): string {
  let text = input.toLowerCase();
  for (const [pattern, replacement] of NORWEGIAN_FOLDINGS) {
    text = text.replace(pattern, replacement);
  }
  // Applies to loanwords such as "resumé"; the Norwegian letters are already
  // folded above and so are unaffected here.
  text = text.normalize('NFD').replace(COMBINING_MARKS, '');
  return text.replace(/\s+/g, ' ').trim();
}

/** Non-word characters that separate tokens. Keeps digits and hyphens joined. */
const TOKEN_SPLIT = /[^\p{L}\p{N}-]+/u;

/** A token must carry at least one letter or digit; a run of hyphens is not one. */
const HAS_WORD_CHARACTER = /[\p{L}\p{N}]/u;

/** Splits normalised text into comparable tokens. */
export function tokenize(input: string): string[] {
  return normalizeSearchText(input)
    .split(TOKEN_SPLIT)
    .filter((token) => HAS_WORD_CHARACTER.test(token));
}

/**
 * Whole-word containment test.
 *
 * Substring matching is wrong here: the keyword "bad" would match "badevakt"
 * and, worse, an exclusion keyword would silently suppress unrelated tenders.
 * A multi-word needle is treated as a phrase and must appear as a contiguous
 * token run, which is what spec section 11.1 means by phrase search.
 */
export function containsPhrase(haystack: string, needle: string): boolean {
  const needleTokens = tokenize(needle);
  if (needleTokens.length === 0) return false;

  const haystackTokens = tokenize(haystack);
  if (needleTokens.length > haystackTokens.length) return false;

  for (let start = 0; start <= haystackTokens.length - needleTokens.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needleTokens.length; offset += 1) {
      if (haystackTokens[start + offset] !== needleTokens[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/**
 * Returns the phrases from `needles` that occur in `haystack`, preserving the
 * caller's original spelling so it can be shown back as match evidence.
 */
export function findMatchingPhrases(
  haystack: string,
  needles: readonly string[],
): string[] {
  return needles.filter((needle) => containsPhrase(haystack, needle));
}
