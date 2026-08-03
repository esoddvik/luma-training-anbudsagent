import type {
  AlertProfile,
  MatchConfidence,
  MatchReason,
  MatchReasonType,
  MatchResult,
  Tender,
} from '@luma/domain';
import {
  scoreBuyer,
  scoreCpv,
  scoreDeadline,
  scoreGeography,
  scoreKeyword,
  scoreNoticeType,
  scoreProcedure,
  scoreValue,
} from './components/index.js';
import { evaluateExclusions } from './exclusions.js';
import { clamp, roundScore } from './util.js';
import {
  DEFAULT_MATCH_WEIGHTS,
  MATCHING_VERSION,
  MAX_SCORE,
  type ConfidenceThresholds,
  type MatchWeights,
} from './weights.js';

/**
 * The matching engine (spec section 14, ADR-0004).
 *
 * `matchTender` is a pure function: no I/O, no randomness, no database, and no
 * clock read. `now` is an argument because the deadline component needs one,
 * and a function that reaches for `new Date()` cannot be tested for
 * determinism — which is the one property this engine has to be able to prove.
 *
 * Nothing commercial is reachable from here. This package depends on
 * `@luma/domain` and nothing else, and a test walks the source to keep it that
 * way (ADR-0006).
 */

export interface MatchOptions {
  /**
   * The instant the match is evaluated at.
   *
   * Required, deliberately. Defaulting it to `new Date()` would put a clock
   * read inside a function whose contract is that identical inputs produce
   * identical output, and callers would lose the ability to reproduce a
   * historical match.
   */
  readonly now: Date;
  /** Defaults to `DEFAULT_MATCH_WEIGHTS`. */
  readonly weights?: MatchWeights;
  /**
   * Defaults to `MATCHING_VERSION`. Overridable so that a shadow run of a new
   * weighting can be stored alongside the live one before switching.
   */
  readonly matchingVersion?: string;
}

/**
 * Tie-break order for reasons that contribute the same number of points.
 *
 * Without it, two components on equal contributions would be ordered by
 * whichever scorer happened to run first, and a refactor that reorders the
 * scorer list would silently change stored output.
 */
const REASON_ORDER: readonly MatchReasonType[] = [
  'cpv',
  'keyword',
  'geography',
  'buyer',
  'value',
  'notice_type',
  'procedure',
  'deadline',
];

/**
 * Derives the customer-facing confidence band from the score.
 *
 * Thresholds are part of the versioned scoring configuration, so changing one
 * requires bumping `MATCHING_VERSION` like any weight change would.
 */
export function confidenceFor(
  score: number,
  thresholds: ConfidenceThresholds = DEFAULT_MATCH_WEIGHTS.confidence,
): MatchConfidence {
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.medium) return 'medium';
  return 'low';
}

export function matchTender(
  tender: Tender,
  profile: AlertProfile,
  options: MatchOptions,
): MatchResult {
  const weights = options.weights ?? DEFAULT_MATCH_WEIGHTS;
  const now = options.now;

  const exclusions = evaluateExclusions(tender, profile, { now });

  /**
   * Components run even when the tender is excluded.
   *
   * The score is still computed and stored so that support (and the user) can
   * see "this would have been a strong match, but the buyer is on your exclude
   * list". Inclusion is decided separately, below; the score never overrides
   * an exclusion.
   */
  const reasons = collectReasons(tender, profile, weights, now);

  const rawScore = reasons.reduce((total, reason) => total + reason.contribution, 0);
  const score = roundScore(clamp(rawScore, 0, MAX_SCORE));

  return {
    tenderId: tender.id,
    alertProfileId: profile.id,
    score,
    confidence: confidenceFor(score, weights.confidence),
    included: exclusions.length === 0 && score >= profile.minimumMatchScore,
    reasons,
    exclusions,
    matchingVersion: options.matchingVersion ?? MATCHING_VERSION,
  };
}

/** Matches one profile against many tenders, preserving the input order. */
export function matchTenders(
  tenders: readonly Tender[],
  profile: AlertProfile,
  options: MatchOptions,
): MatchResult[] {
  return tenders.map((tender) => matchTender(tender, profile, options));
}

function collectReasons(
  tender: Tender,
  profile: AlertProfile,
  weights: MatchWeights,
  now: Date,
): MatchReason[] {
  const candidates: Array<MatchReason | null> = [
    scoreCpv(tender, profile, weights),
    scoreKeyword(tender, profile, weights),
    scoreGeography(tender, profile, weights),
    scoreBuyer(tender, profile, weights),
    scoreValue(tender, profile, weights),
    scoreNoticeType(tender, profile, weights),
    scoreProcedure(tender, profile, weights),
    scoreDeadline(tender, profile, weights, now),
  ];

  return candidates
    .filter((reason): reason is MatchReason => reason !== null)
    .sort(
      (a, b) =>
        b.contribution - a.contribution ||
        REASON_ORDER.indexOf(a.type) - REASON_ORDER.indexOf(b.type),
    );
}
