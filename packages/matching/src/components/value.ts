import type { AlertProfile, MatchReason, Tender } from '@luma/domain';
import { profileValueRange, rangeContains, rangesOverlap, tenderValueRange } from '../criteria.js';
import { formatNok, roundScore } from '../util.js';
import type { MatchWeights } from '../weights.js';

/**
 * Value component (spec section 14, up to 5 points).
 *
 * This component only speaks when both sides have stated a comparable value.
 * Doffin omits the estimate on 53% of notices — absence is the majority case,
 * not an edge case — and a profile need not set a window at all; treating
 * either silence as a mismatch would punish most real tenders for a
 * data-quality problem the user cannot fix. Absence is therefore `null`
 * (component does not apply), never a deduction.
 *
 * A value stated in another currency is treated the same way. Doffin returns
 * PLN amounts among the NOK ones and supplies no exchange rate, so the amount
 * is not comparable with a NOK profile window; see `valueIsComparable`.
 *
 * A tender whose stated value lies entirely outside the profile's window is a
 * hard exclusion, handled in `exclusions.ts`. What is left here is the
 * distinction between "fits inside the window" and "straddles its edge".
 */

/** A partial overlap keeps this share of the value budget. */
const PARTIAL_SHARE = 0.6;

export function scoreValue(
  tender: Tender,
  profile: AlertProfile,
  weights: MatchWeights,
): MatchReason | null {
  const tenderRange = tenderValueRange(tender);
  const profileRange = profileValueRange(profile);
  if (tenderRange === null || profileRange === null) return null;
  if (!rangesOverlap(tenderRange, profileRange)) return null;

  const contained = rangeContains(profileRange, tenderRange);
  const contribution = roundScore(weights.value * (contained ? 1 : PARTIAL_SHARE));

  const stated =
    tenderRange.min === tenderRange.max
      ? formatNok(tenderRange.min)
      : `${formatNok(tenderRange.min)}–${formatNok(tenderRange.max)}`;

  const evidence = [
    `Anslått verdi i anbudet: ${stated}`,
    `Verdiintervall i profilen: ${describeProfileRange(profileRange.min, profileRange.max)}`,
  ];

  return {
    type: 'value',
    label: contained
      ? `Anslått verdi ${stated} ligger innenfor verdiintervallet i profilen din`
      : `Anslått verdi ${stated} overlapper delvis med verdiintervallet i profilen din`,
    contribution,
    evidence,
  };
}

function describeProfileRange(min: number, max: number): string {
  if (!Number.isFinite(max)) return `fra ${formatNok(min)}`;
  if (min === 0) return `opptil ${formatNok(max)}`;
  return `${formatNok(min)}–${formatNok(max)}`;
}
