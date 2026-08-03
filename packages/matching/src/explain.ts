import {
  confidenceLabel,
  containsPhrase,
  SCORE_DISCLAIMER_NB,
  type MatchResult,
} from '@luma/domain';
import { formatPoints } from './util.js';
import { MAX_SCORE } from './weights.js';

/**
 * Human-readable Norwegian explanation of a match (spec section 4.2).
 *
 * Spec section 4.2 forbids showing an unexplained score as if it were the
 * answer, and requires that the surface can show the matching CPV codes,
 * keywords, geography, buyer, value range and competition type, any exclusion
 * rule that fired, a human-readable explanation, and the line between
 * rule-based matching and AI interpretation.
 *
 * All of that is already in the `MatchResult`: reasons carry Norwegian labels
 * and concrete evidence, exclusions carry the rule that fired. This module
 * assembles them into prose and adds the two things the result cannot carry —
 * the method note and the disclaimer.
 *
 * On the AI line: there is no AI in the MVP (spec section 41). The method note
 * therefore states plainly that the assessment is rule-based rather than
 * hedging about a model that does not exist. When an interpretation layer is
 * added later it gets its own clearly labelled section; it does not edit this
 * text.
 */

/** Spec section 25: a tender card shows the two or three main reasons. */
export const MAIN_REASON_COUNT = 3;

/**
 * The rule-based / AI distinction spec section 4.2 requires, in the MVP form.
 */
export const METHOD_NOTE_NB =
  'Vurderingen er regelbasert. Den bygger bare på varslingsprofilen din og på opplysningene i kunngjøringen. Ingen AI-modell har tolket dette anbudet.';

export interface MatchExplanation {
  /** Approved confidence wording from the domain, e.g. "Høy relevans". */
  readonly headline: string;
  readonly summary: string;
  /** One line per scoring reason, most important first. */
  readonly reasons: readonly string[];
  /** One line per hard exclusion, empty when nothing was excluded. */
  readonly exclusions: readonly string[];
  readonly method: string;
  readonly disclaimer: string;
  /** Everything above, joined with newlines, ready to render as plain text. */
  readonly text: string;
}

export interface ExplainOptions {
  /** Cap the reason lines, for a compact surface such as an email card. */
  readonly maxReasons?: number;
}

export function explainMatch(result: MatchResult, options: ExplainOptions = {}): MatchExplanation {
  const headline = confidenceLabel(result.confidence);
  const limit = options.maxReasons ?? result.reasons.length;

  const reasons = result.reasons
    .slice(0, Math.max(0, limit))
    .map(
      (reason) =>
        `${reason.label} (+${formatPoints(reason.contribution)} poeng)` +
        (reason.evidence.length > 0 ? `: ${reason.evidence.join('; ')}` : ''),
    );

  const exclusions = result.exclusions.map((exclusion) =>
    exclusion.evidence.length > 0
      ? `${exclusion.label}: ${exclusion.evidence.join('; ')}`
      : exclusion.label,
  );

  const summary = buildSummary(result, headline);

  const text = [
    summary,
    ...(reasons.length > 0 ? ['', 'Dette er grunnlaget for treffet:', ...reasons] : []),
    ...(exclusions.length > 0 ? ['', 'Dette holdt anbudet utenfor:', ...exclusions] : []),
    '',
    METHOD_NOTE_NB,
    SCORE_DISCLAIMER_NB,
    `Regelversjon: ${result.matchingVersion}`,
  ].join('\n');

  return {
    headline,
    summary,
    reasons,
    exclusions,
    method: METHOD_NOTE_NB,
    disclaimer: SCORE_DISCLAIMER_NB,
    text,
  };
}

/** The two or three main reasons for a tender card (spec section 25). */
export function mainReasons(result: MatchResult, count: number = MAIN_REASON_COUNT): string[] {
  return result.reasons.slice(0, count).map((reason) => reason.label);
}

function buildSummary(result: MatchResult, headline: string): string {
  const score = `${formatPoints(result.score)} av ${MAX_SCORE}`;

  if (result.exclusions.length > 0) {
    return `Anbudet er holdt utenfor varslene dine. Treffscoren ville vært ${score}.`;
  }
  if (!result.included) {
    return `${headline}. Treffscoren ${score} er lavere enn minstekravet i varslingsprofilen din, så anbudet er ikke tatt med i varslene.`;
  }
  return `${headline}. Anbudet fikk treffscore ${score} mot varslingsprofilen din.`;
}

/**
 * Phrasings spec section 4.3 forbids: invented win probability, guarantees and
 * bid/no-bid instructions. A relevance score describes fit with a profile; the
 * bid decision belongs to the user.
 *
 * Kept here rather than in a test file so that any surface which renders match
 * text can check itself against the same list.
 */
export const FORBIDDEN_SCORE_PHRASES_NB: readonly string[] = [
  'sannsynlighet for å vinne',
  'sannsynligheten for å vinne',
  'vinnersannsynlighet',
  'prosent sannsynlighet',
  'sjanse for å vinne',
  'garantert',
  'garanti for treff',
  'bør definitivt levere',
  'vil dere vinne',
  'sikker vinner',
  'du vil vinne',
];

/**
 * Returns every forbidden phrase present in `text`.
 *
 * The score disclaimer is stripped first, and that is not a loophole: the
 * disclaimer's own wording is "Den sier ingenting om sannsynligheten for å
 * vinne", which contains a forbidden phrase precisely because its job is to
 * deny it. Checking the disclaimer against the list would make the required
 * text fail the required check.
 *
 * Matching is whole-word and phrase-based through the domain helper, which
 * folds Norwegian characters on both sides. That is why the list above can be
 * written in ordinary Norwegian: a surface that writes "sannsynlighet for aa
 * vinne" is caught by the same entry as one that writes it with the å.
 */
export function findForbiddenScorePhrasing(text: string): string[] {
  const withoutDisclaimer = text.split(SCORE_DISCLAIMER_NB).join(' ');
  return FORBIDDEN_SCORE_PHRASES_NB.filter((phrase) => containsPhrase(withoutDisclaimer, phrase));
}
