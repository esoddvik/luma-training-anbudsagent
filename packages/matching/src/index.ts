/**
 * `@luma/matching` — the deterministic tender matching engine.
 *
 * This package decides which public tenders a supplier is told about. Three
 * properties define it (ADR-0004, ADR-0006):
 *
 * 1. **Deterministic.** The same tender, profile, weights, version and `now`
 *    always produce a byte-identical `MatchResult`, down to array order.
 * 2. **Explainable.** Every point produces a reason with a Norwegian label and
 *    the concrete evidence behind it. A score without reasons is a bug.
 * 3. **Commercially blind.** It depends on `@luma/domain` and nothing else.
 *    Course clicks, promotion state and attribution data are not inputs and
 *    cannot become inputs; a test walks this package's source and manifest to
 *    keep the import edge from ever existing.
 */

export {
  DEFAULT_MATCH_WEIGHTS,
  MATCHING_VERSION,
  MAX_SCORE,
  NOTICE_AND_PROCEDURE_BUDGET,
  totalWeight,
  type ConfidenceThresholds,
  type MatchWeights,
} from './weights.js';

export {
  EXCLUSION_TYPES,
  evaluateExclusions,
  type ExclusionInput,
  type ExclusionType,
} from './exclusions.js';

export {
  decideGeography,
  isNationwide,
  valueIsComparable,
  NATIONWIDE_GEOGRAPHY_MARKERS,
  type GeographyVerdict,
} from './criteria.js';

export {
  COMFORTABLE_DAYS,
  NATIONWIDE_LABEL_NB,
  PLANNED_NOTICE_TEXT_NB,
  scoreBuyer,
  scoreCpv,
  scoreDeadline,
  scoreGeography,
  scoreKeyword,
  scoreNoticeType,
  scoreProcedure,
  scoreValue,
} from './components/index.js';

export { confidenceFor, matchTender, matchTenders, type MatchOptions } from './engine.js';

export {
  explainMatch,
  findForbiddenScorePhrasing,
  mainReasons,
  FORBIDDEN_SCORE_PHRASES_NB,
  MAIN_REASON_COUNT,
  METHOD_NOTE_NB,
  type ExplainOptions,
  type MatchExplanation,
} from './explain.js';
