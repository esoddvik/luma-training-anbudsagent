import type { AlertProfile, MatchReason, Tender } from '@luma/domain';
import { decideGeography } from '../criteria.js';
import { roundScore } from '../util.js';
import type { MatchWeights } from '../weights.js';

/**
 * Geography component (spec section 14, up to 15 points).
 *
 * A profile's geography is a filter as well as a scorer (see `exclusions.ts`),
 * so by the time this scorer awards points the tender is somewhere the user
 * works. What is left to score is precision: a named municipality is a sharper
 * statement than the county it sits in.
 *
 * Two realities from the source shape the rest of it:
 *
 * - **Nationwide notices.** Doffin's `anyw` covers the whole country and is
 *   its most common geography value. It matches every profile, and its
 *   evidence says "Gjelder hele landet" rather than naming a region the notice
 *   does not have. It scores at region level, not municipality level: it does
 *   cover the user's area, but it says nothing about local focus.
 * - **No municipality data.** Doffin exposes NUTS-3 at finest, so precision is
 *   judged by what the tender actually stated. A profile municipality that
 *   matched a tender region is a region-level match and is scored as one.
 *
 * A profile with no geography returns `null`, not zero. The user said they do
 * not care where the work is; charging them 15 points for that would make an
 * unconstrained profile permanently incapable of reaching "Høy relevans".
 */

/** A county-level or nationwide match keeps this share of the budget. */
const REGION_SHARE = 0.7;

/** Norwegian evidence for a notice that covers the whole country. */
export const NATIONWIDE_LABEL_NB = 'Gjelder hele landet';

export function scoreGeography(
  tender: Tender,
  profile: AlertProfile,
  weights: MatchWeights,
): MatchReason | null {
  const { verdict, match } = decideGeography(tender, profile);

  if (verdict === 'nationwide') {
    return {
      type: 'geography',
      label: 'Anbudet gjelder hele landet, og dekker området i profilen din',
      contribution: roundScore(weights.geography * REGION_SHARE),
      evidence: [NATIONWIDE_LABEL_NB],
    };
  }

  if (verdict !== 'match') return null;

  const matchCount = match.municipalities.length + match.regions.length;
  const share = match.municipalities.length > 0 ? 1 : REGION_SHARE;
  const contribution = roundScore(weights.geography * share);

  const evidence = [
    ...match.municipalities.map((place) => `Kommune: ${place}`),
    ...match.regions.map((place) => `Område: ${place}`),
  ];
  if (match.profileEntries.length > 0) {
    evidence.push(`Område i profilen: ${match.profileEntries.join(', ')}`);
  }

  const primary = match.municipalities[0] ?? match.regions[0];
  const label =
    matchCount === 1 && primary !== undefined
      ? `Anbudet gjelder ${primary}, som ligger i profilen din`
      : `Anbudet gjelder ${matchCount} områder fra profilen din`;

  return { type: 'geography', label, contribution, evidence };
}
