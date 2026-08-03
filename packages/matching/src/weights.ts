/**
 * Scoring configuration for the deterministic matching engine (spec section 14).
 *
 * Spec section 14 requires that weights be configurable, so nothing in this
 * package reads these constants directly: every scorer takes a `MatchWeights`
 * object as an argument and `DEFAULT_MATCH_WEIGHTS` is only the default.
 *
 * IMPORTANT: changing any number in this file REQUIRES bumping
 * `MATCHING_VERSION`. Match reasons are persisted per
 * `(tender_id, alert_profile_id, matching_version)` (spec section 37), and a
 * stored explanation must stay readable as the explanation the user actually
 * received. Silently re-tuning a weight would make historical reasons lie.
 */

/**
 * The version of the scoring rules. Bump on ANY behavioural change: weights,
 * curves, thresholds, label wording or evidence format.
 *
 * Format: `YYYY.MM.n`, where `n` counts releases within that month.
 */
export const MATCHING_VERSION = '2026.08.1';

/**
 * Score boundaries for the customer-facing confidence bands
 * (`CONFIDENCE_LABEL_NB` in `@luma/domain`). Inclusive lower bounds.
 */
export interface ConfidenceThresholds {
  /** Scores at or above this are "Høy relevans". */
  readonly high: number;
  /** Scores at or above this (and below `high`) are "Verdt å undersøke". */
  readonly medium: number;
}

/**
 * Maximum points each component may contribute.
 *
 * Spec section 14 gives a single 5-point budget for "type og prosedyre"; the
 * `MatchResult` type has separate `notice_type` and `procedure` reason types,
 * so that budget is split 3/2 here. `NOTICE_AND_PROCEDURE_BUDGET` documents
 * the spec-level figure the split has to add up to.
 */
export interface MatchWeights {
  /** Spec section 14: up to 35 points. */
  readonly cpv: number;
  /** Spec section 14: up to 25 points. */
  readonly keyword: number;
  /** Spec section 14: up to 15 points. */
  readonly geography: number;
  /** Spec section 14: up to 10 points. */
  readonly buyer: number;
  /** Spec section 14: up to 5 points. */
  readonly value: number;
  /** Part of the spec's combined 5-point "type og prosedyre" budget. */
  readonly noticeType: number;
  /** Part of the spec's combined 5-point "type og prosedyre" budget. */
  readonly procedure: number;
  /** Spec section 14: up to 5 points. */
  readonly deadline: number;
  readonly confidence: ConfidenceThresholds;
}

/** The spec's combined budget for notice type plus procedure. */
export const NOTICE_AND_PROCEDURE_BUDGET = 5;

/** The highest score a `MatchResult` may report, before and after clamping. */
export const MAX_SCORE = 100;

/**
 * The recommended first weighting from spec section 14.
 *
 * The component budgets sum to exactly 100, so a tender that maxes every
 * component lands on 100 without the clamp doing any work. That is a
 * deliberate property and is asserted in the tests: it keeps the score
 * readable as "percent of profile satisfied".
 *
 * Confidence thresholds:
 * - `high` at 70. Reaching 70 is not possible from CPV plus keywords alone
 *   (35 + 25 = 60), so "Høy relevans" always requires agreement from at least
 *   one independent axis: geography, buyer or a comfortable deadline.
 * - `medium` at 40. A full CPV hierarchy match on its own (35) is below it, so
 *   a lone code overlap is presented as "Treff med lav sikkerhet" rather than
 *   as something worth acting on.
 */
export const DEFAULT_MATCH_WEIGHTS: MatchWeights = Object.freeze({
  cpv: 35,
  keyword: 25,
  geography: 15,
  buyer: 10,
  value: 5,
  noticeType: 3,
  procedure: 2,
  deadline: 5,
  confidence: Object.freeze({ high: 70, medium: 40 }),
});

/** Sum of every component budget. 100 for the default weighting. */
export function totalWeight(weights: MatchWeights): number {
  return (
    weights.cpv +
    weights.keyword +
    weights.geography +
    weights.buyer +
    weights.value +
    weights.noticeType +
    weights.procedure +
    weights.deadline
  );
}
