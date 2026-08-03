import type { AlertProfile, MatchReason, Tender } from '@luma/domain';
import { findBuyerMatches } from '../criteria.js';
import { roundScore } from '../util.js';
import type { MatchWeights } from '../weights.js';

/**
 * Buyer component (spec section 14, up to 10 points).
 *
 * Naming a buyer is a binary statement: either this is an organisation the
 * supplier already works with and wants to hear from, or the profile says
 * nothing about it. There is no meaningful gradient, so the component pays the
 * full budget on a match and returns `null` otherwise.
 */
export function scoreBuyer(
  tender: Tender,
  profile: AlertProfile,
  weights: MatchWeights,
): MatchReason | null {
  const matches = findBuyerMatches(tender, profile.buyerInclude);
  if (matches.length === 0) return null;

  return {
    type: 'buyer',
    label: `Oppdragsgiveren ${tender.buyerName} står i profilen din`,
    contribution: roundScore(weights.buyer),
    evidence: matches.map((entry) => `Oppdragsgiver i profilen: ${entry}`),
  };
}
