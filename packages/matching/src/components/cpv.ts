import type { AlertProfile, MatchReason, Tender } from '@luma/domain';
import { findCpvMatches, normalizedCpvCodes } from '../criteria.js';
import { roundScore } from '../util.js';
import type { MatchWeights } from '../weights.js';

/**
 * CPV component (spec section 14, up to 35 points).
 *
 * The rule that matters is specificity. A profile that asks for 45213316
 * ("bygging av forretningsbygg") and gets 45213316 has said something precise
 * about what the supplier does. A profile that asks for 45000000
 * ("bygge- og anleggsarbeid") and gets 45213316 has said almost nothing: that
 * branch covers most of the construction sector. Both are matches, but they
 * are not the same match, and scoring them alike would flood a broad profile
 * with noise it cannot distinguish from real hits.
 *
 * The score has three parts:
 *
 * - a base share, because any hierarchy hit is genuine evidence;
 * - a precision share, driven by how specific the covering profile code is;
 * - a coverage share, driven by how much of the tender's CPV list is covered,
 *   which separates "this tender is about your field" from "this tender
 *   mentions your field among five others".
 */

/** Any hierarchy hit is worth this share of the CPV budget. */
const BASE_SHARE = 0.5;
/** Driven by the specificity of the covering profile code. */
const PRECISION_SHARE = 0.35;
/** Driven by how many of the tender's codes the profile covers. */
const COVERAGE_SHARE = 0.15;

/** A CPV code has eight significant digits at most. */
const MAX_DEPTH = 8;

export function scoreCpv(
  tender: Tender,
  profile: AlertProfile,
  weights: MatchWeights,
): MatchReason | null {
  const matches = findCpvMatches(tender.cpvCodes, profile.cpvInclude);
  const best = matches[0];
  if (best === undefined) return null;

  const tenderCodeCount = normalizedCpvCodes(tender.cpvCodes).length;

  /**
   * An exact code match is perfect precision regardless of how deep the code
   * sits. If the buyer filed the notice under 45000000 and the user asked for
   * 45000000, the user matched exactly what was published; penalising them for
   * the buyer's coarse filing would be wrong.
   */
  const precision = best.exact ? 1 : best.specificity / MAX_DEPTH;
  const coverage = tenderCodeCount > 0 ? matches.length / tenderCodeCount : 0;

  const contribution = roundScore(
    weights.cpv * (BASE_SHARE + PRECISION_SHARE * precision + COVERAGE_SHARE * coverage),
  );

  return {
    type: 'cpv',
    label: buildLabel(
      matches.length,
      tenderCodeCount,
      best.tenderCode,
      best.profileCode,
      best.exact,
    ),
    contribution,
    evidence: matches.map((match) =>
      match.exact
        ? `CPV ${match.tenderCode} står i profilen din`
        : `CPV ${match.tenderCode} ligger under profilkoden ${match.profileCode}`,
    ),
  };
}

function buildLabel(
  matchCount: number,
  tenderCodeCount: number,
  tenderCode: string,
  profileCode: string,
  exact: boolean,
): string {
  if (matchCount > 1) {
    return `Treff på ${matchCount} av ${tenderCodeCount} CPV-koder i anbudet`;
  }
  return exact
    ? `Nøyaktig treff på CPV-koden ${tenderCode}`
    : `CPV-koden ${tenderCode} ligger under profilkoden ${profileCode}`;
}
