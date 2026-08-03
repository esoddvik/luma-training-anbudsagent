import type { AlertProfile, MatchReason, Tender } from '@luma/domain';
import { findKeywordMatches } from '../criteria.js';
import { roundScore } from '../util.js';
import type { MatchWeights } from '../weights.js';

/**
 * Keyword component (spec section 14, up to 25 points).
 *
 * Matching is whole-word and phrase-based via the domain helper, so "bad"
 * never matches "badevakt" and a two-word keyword must appear as a contiguous
 * run of tokens.
 *
 * Two scoring decisions:
 *
 * 1. Only distinct keywords count. Occurrences are never counted, so a buyer
 *    who writes "renhold" eleven times in a long description cannot outscore a
 *    tender that genuinely matches three different things the supplier does.
 * 2. Diminishing returns. Each additional distinct keyword closes half of the
 *    remaining gap to the budget: one keyword is worth 50% of it, two 75%,
 *    three 87.5%. The first agreement is the informative one; the tenth adds
 *    very little, and a profile with sixty keywords should not be able to buy
 *    a high score through sheer volume.
 */

/** Each further keyword closes this share of the remaining gap. */
const DECAY = 0.5;

/**
 * A keyword found only in the description keeps this share of its value; the
 * rest is released when the keyword appears in the title. A buyer puts the
 * subject of the procurement in the title, so a title hit is the stronger
 * claim, but a description hit is still a real match and is never a penalty.
 */
const DESCRIPTION_SHARE = 0.8;

export function scoreKeyword(
  tender: Tender,
  profile: AlertProfile,
  weights: MatchWeights,
): MatchReason | null {
  const matches = findKeywordMatches(tender, profile.keywordsInclude);
  if (matches.length === 0) return null;

  const saturation = 1 - Math.pow(DECAY, matches.length);
  const titleShare = matches.filter((match) => match.inTitle).length / matches.length;
  const emphasis = DESCRIPTION_SHARE + (1 - DESCRIPTION_SHARE) * titleShare;

  const contribution = roundScore(weights.keyword * saturation * emphasis);

  const first = matches[0];
  const label =
    matches.length === 1 && first !== undefined
      ? `Søkeordet «${first.keyword}» finnes i anbudet`
      : `${matches.length} søkeord fra profilen din finnes i anbudet`;

  return {
    type: 'keyword',
    label,
    contribution,
    evidence: matches.map((match) =>
      match.inTitle ? `«${match.keyword}» i tittelen` : `«${match.keyword}» i beskrivelsen`,
    ),
  };
}
