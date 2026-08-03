import {
  confidenceLabel,
  SCORE_DISCLAIMER_NB,
  type MatchConfidence,
  type MatchReasonType,
} from '@luma/domain';

/**
 * Turning stored match reasons into something a person can read
 * (spec section 4.2).
 *
 * The rows in `tender_match_reasons` already carry a Norwegian label and the
 * concrete evidence behind each component, so nothing here invents text. Two
 * rules are enforced by the shape of the types rather than by discipline:
 *
 * 1. A score is never presented as a probability of winning (spec 4.3). The
 *    only wording available is `confidenceLabel`, and `SCORE_DISCLAIMER_NB`
 *    travels with it in the same object so a surface cannot render one without
 *    having the other to hand.
 * 2. The public shared view gets `SimplifiedExplanation`, which carries reason
 *    *types* and nothing else. It is a different type, not a filtered version
 *    of the full one, so widening the full explanation cannot widen the public
 *    page (the same argument as `SharedTenderView` in `@luma/domain`).
 */

export interface ExplanationEntry {
  readonly type: string;
  readonly label: string;
  /** Concrete values from the profile and the notice: codes, keywords, places. */
  readonly evidence: readonly string[];
}

export interface FullMatchExplanation {
  readonly confidence: MatchConfidence;
  /** Approved wording: "Høy relevans", "Verdt å undersøke", "Treff med lav sikkerhet". */
  readonly confidenceText: string;
  readonly reasons: readonly ExplanationEntry[];
  readonly exclusions: readonly ExplanationEntry[];
  readonly disclaimer: string;
  readonly method: string;
  readonly matchingVersion: string;
}

/**
 * The rule-based / AI distinction spec section 4.2 requires. There is no AI in
 * the MVP (spec section 41), so this says so plainly rather than hedging about
 * a model that does not exist.
 */
export const METHOD_NOTE_NB =
  'Vurderingen er regelbasert. Den bygger bare på varslingsprofilen din og på opplysningene i kunngjøringen. Ingen AI-modell har tolket dette anbudet.';

export interface StoredReasonRow {
  readonly entryType: 'reason' | 'exclusion';
  readonly typeKey: string;
  readonly label: string;
  readonly evidence: readonly string[];
}

export function buildMatchExplanation(input: {
  confidence: MatchConfidence;
  matchingVersion: string;
  rows: readonly StoredReasonRow[];
}): FullMatchExplanation {
  const reasons: ExplanationEntry[] = [];
  const exclusions: ExplanationEntry[] = [];

  for (const row of input.rows) {
    const entry: ExplanationEntry = {
      type: row.typeKey,
      label: row.label,
      evidence: row.evidence,
    };
    if (row.entryType === 'exclusion') exclusions.push(entry);
    else reasons.push(entry);
  }

  return {
    confidence: input.confidence,
    confidenceText: confidenceLabel(input.confidence),
    reasons,
    exclusions,
    disclaimer: SCORE_DISCLAIMER_NB,
    method: METHOD_NOTE_NB,
    matchingVersion: input.matchingVersion,
  };
}

/**
 * Norwegian names for the reason *types*, for the shared view.
 *
 * Spec section 17 allows the recipient of a share link to see which kinds of
 * criterion matched, never the values behind them. "Søkeord" is safe; "søkeord:
 * asfaltering" would tell a stranger what the sharer's company sells.
 */
export const REASON_TYPE_LABEL_NB: Readonly<Record<MatchReasonType, string>> = {
  cpv: 'CPV-koder',
  keyword: 'Søkeord',
  geography: 'Geografisk område',
  buyer: 'Oppdragsgiver',
  value: 'Verdiintervall',
  notice_type: 'Konkurransetype',
  procedure: 'Anskaffelsesprosedyre',
  deadline: 'Tid til frist',
};

export interface SimplifiedExplanation {
  /** Reason kinds only. No evidence, no score, no profile name. */
  readonly reasonTypes: readonly MatchReasonType[];
  readonly labels: readonly string[];
}

/**
 * The explanation the shared view is allowed to show.
 *
 * Takes only the reason types, so there is no evidence array in scope to leak
 * by accident, and drops anything that is not a known reason type rather than
 * passing an unrecognised string through to the page.
 */
export function simplifyForSharing(reasonTypes: readonly MatchReasonType[]): SimplifiedExplanation {
  const seen = new Set<MatchReasonType>();
  const ordered: MatchReasonType[] = [];
  for (const type of reasonTypes) {
    if (!(type in REASON_TYPE_LABEL_NB)) continue;
    if (seen.has(type)) continue;
    seen.add(type);
    ordered.push(type);
  }
  return {
    reasonTypes: ordered,
    labels: ordered.map((type) => REASON_TYPE_LABEL_NB[type]),
  };
}

/** The line the shared view uses to introduce the simplified explanation. */
export const SHARED_EXPLANATION_INTRO_NB =
  'Anbudet ble plukket ut av Luma Anbudsvarsling fordi det traff på disse typene kriterier:';

export const SHARED_EXPLANATION_EMPTY_NB =
  'Vi viser ikke hvilke kriterier anbudet traff på i denne visningen.';
