import {
  isRecommendationEligible,
  PAID_OFFER_LABEL_NB,
  PROMOTION_DISCLOSURE_NB,
  PROMOTION_HEADINGS_NB,
  type EditorialRecommendation,
  type LadderLevel,
  type MarketingCategory,
  type NotificationPreferences,
  type PromotionPlacement,
  type UtmMedium,
} from '@luma/domain';
import { lumaLink } from './links.js';
import { findProhibitedPhrases, type ProhibitedPhraseMatch } from './prohibited.js';

/**
 * Selection of the Luma promotion block.
 *
 * This is the most constrained module in the package. Spec section 23 is a
 * list of things the promotion must be and a longer list of things it may not
 * be, and ADR-0006 and ADR-0014 turn both lists into structural properties
 * rather than review checklists. The parts that live here:
 *
 * - Selection is a pure function of placement, geography, ladder state and
 *   time. It receives no match list, no score and no attribution history, so
 *   it cannot influence ranking even in principle (ADR-0006, point 4).
 * - Regional routing is delegated to `isRecommendationEligible` in
 *   `@luma/domain`. This module does not re-derive it.
 * - `includeLumaPromotionsInTenderEmails === false` returns null. It changes
 *   nothing else: the caller has already assembled the tenders, and no code
 *   path from this function reaches them.
 * - Recommendation copy is validated against the section 23.5 prohibitions
 *   before it is offered for rendering, because recommendations are
 *   admin-editable data.
 *
 * Placement itself - after the tender content, visually separated - is a
 * property of the renderer, not of this module. See `render/promotion.ts`.
 */

/** A recommendation, resolved into everything the renderer needs. */
export interface PromotionBlock {
  /** One of the approved headings from `PROMOTION_HEADINGS_NB`. */
  readonly heading: string;
  readonly title: string;
  readonly description: string;
  /** Already carries UTM parameters (spec section 44.2). */
  readonly url: string;
  /** Spec section 23.4: a paid offer is labelled as paid. */
  readonly isPaid: boolean;
  readonly paidLabel: string;
  /** Spec section 43. Always rendered with the block. */
  readonly disclosure: string;
  readonly recommendationId: string;
  readonly ladderLevel: LadderLevel;
  readonly marketingCategory: MarketingCategory;
}

/**
 * How far up the ladder this user may be shown (spec section 23.1).
 *
 * `rotationIndex` is supplied by the caller - typically a per-user counter of
 * digests sent - and makes the choice deterministic without any behavioural
 * signal.
 */
export interface LadderState {
  readonly highestAllowedLevel: LadderLevel;
  readonly rotationIndex: number;
}

/**
 * Default ladder progression by account age.
 *
 * The specification fixes the ladder's order but not its pacing, so these
 * thresholds are a product decision made here and worth revisiting with data.
 * What matters for section 23.1 is the shape: a new user sees free
 * professional content, and the highest-commitment offer is not the opening
 * move.
 */
export const LADDER_AGE_THRESHOLDS_DAYS = {
  level2: 14,
  level3: 30,
  level4: 60,
} as const;

export function ladderStateForAccount(input: {
  accountCreatedAt: Date;
  now: Date;
  rotationIndex: number;
}): LadderState {
  const ageDays = Math.floor(
    (input.now.getTime() - input.accountCreatedAt.getTime()) / (24 * 60 * 60 * 1000),
  );
  let highestAllowedLevel: LadderLevel = 1;
  if (ageDays >= LADDER_AGE_THRESHOLDS_DAYS.level4) highestAllowedLevel = 4;
  else if (ageDays >= LADDER_AGE_THRESHOLDS_DAYS.level3) highestAllowedLevel = 3;
  else if (ageDays >= LADDER_AGE_THRESHOLDS_DAYS.level2) highestAllowedLevel = 2;
  return { highestAllowedLevel, rotationIndex: Math.max(0, Math.trunc(input.rotationIndex)) };
}

/** Categories that always cost money, whatever the record says. */
const ALWAYS_PAID: ReadonlySet<MarketingCategory> = new Set<MarketingCategory>([
  'course',
  'nho_course',
  'paid_newsletter',
]);

/** The approved heading for a category (spec sections 23.4 and 43). */
export function headingForCategory(category: MarketingCategory): string {
  switch (category) {
    case 'paid_newsletter':
      return PROMOTION_HEADINGS_NB.paafyll;
    case 'course':
    case 'nho_course':
      return PROMOTION_HEADINGS_NB.skill;
    case 'webinar':
    case 'free_guide':
    case 'article':
    case 'tool':
      return PROMOTION_HEADINGS_NB.generic;
    default: {
      // A new marketing category must not silently fall back to a heading
      // that misdescribes it; the generic heading is safe, but say so loudly.
      const unknown: never = category;
      console.warn(`[luma/email] ukjent marketingCategory: ${String(unknown)}`);
      return PROMOTION_HEADINGS_NB.generic;
    }
  }
}

export interface PromotionCopyIssue {
  readonly recommendationId: string;
  readonly matches: readonly ProhibitedPhraseMatch[];
}

/** Runs the section 23.5 prohibitions over a recommendation's own copy. */
export function inspectRecommendationCopy(
  recommendation: EditorialRecommendation,
): PromotionCopyIssue | null {
  const matches = findProhibitedPhrases(`${recommendation.title}\n${recommendation.description}`);
  return matches.length === 0 ? null : { recommendationId: recommendation.id, matches };
}

export interface SelectPromotionInput {
  readonly recommendations: readonly EditorialRecommendation[];
  readonly placement: PromotionPlacement;
  /** The surface, for `utm_medium`. */
  readonly medium: UtmMedium;
  readonly preferences: NotificationPreferences;
  /** Region codes taken from the user's alert profiles, never from an IP. */
  readonly userRegionCodes: readonly string[];
  /** `OSLO_REGION_CODES` from configuration (spec section 23.2). */
  readonly osloRegionCodes: readonly string[];
  readonly ladder: LadderState;
  readonly now: Date;
}

export interface PromotionSelection {
  readonly block: PromotionBlock | null;
  /** Recommendations dropped because their copy breaks section 23.5. */
  readonly copyIssues: readonly PromotionCopyIssue[];
  /** Why nothing was selected, when nothing was. */
  readonly reason:
    | 'selected'
    | 'promotion_disabled_by_user'
    | 'no_eligible_recommendation'
    | 'all_candidates_rejected';
}

/**
 * Chooses at most one recommendation.
 *
 * Deterministic: the same input always yields the same output. Candidates are
 * ordered by ladder level and then by id, and the rotation index picks among
 * them, so rotation never depends on array order from a database query.
 */
export function selectPromotionDetailed(input: SelectPromotionInput): PromotionSelection {
  if (!input.preferences.includeLumaPromotionsInTenderEmails) {
    return { block: null, copyIssues: [], reason: 'promotion_disabled_by_user' };
  }

  const eligible = input.recommendations.filter(
    (recommendation) =>
      recommendation.placement === input.placement &&
      recommendation.ladderLevel <= input.ladder.highestAllowedLevel &&
      isRecommendationEligible({
        recommendation,
        now: input.now,
        userRegionCodes: input.userRegionCodes,
        osloRegionCodes: input.osloRegionCodes,
      }),
  );

  if (eligible.length === 0) {
    return { block: null, copyIssues: [], reason: 'no_eligible_recommendation' };
  }

  const copyIssues: PromotionCopyIssue[] = [];
  const clean = eligible.filter((recommendation) => {
    const issue = inspectRecommendationCopy(recommendation);
    if (issue) {
      copyIssues.push(issue);
      return false;
    }
    return true;
  });

  if (clean.length === 0) {
    return { block: null, copyIssues, reason: 'all_candidates_rejected' };
  }

  const ordered = [...clean].sort(
    (a, b) => a.ladderLevel - b.ladderLevel || a.id.localeCompare(b.id),
  );
  const chosen = ordered[input.ladder.rotationIndex % ordered.length];
  /* c8 ignore next -- unreachable: the modulo of a non-empty array is in range */
  if (!chosen) return { block: null, copyIssues, reason: 'no_eligible_recommendation' };

  return { block: toPromotionBlock(chosen, input.medium), copyIssues, reason: 'selected' };
}

/** The common case: the block, or null. */
export function selectPromotion(input: SelectPromotionInput): PromotionBlock | null {
  return selectPromotionDetailed(input).block;
}

/** Resolves a recommendation into a renderable block. */
export function toPromotionBlock(
  recommendation: EditorialRecommendation,
  medium: UtmMedium,
): PromotionBlock {
  const isPaid = recommendation.isPaid || ALWAYS_PAID.has(recommendation.marketingCategory);
  return {
    heading: headingForCategory(recommendation.marketingCategory),
    title: recommendation.title,
    description: recommendation.description,
    url: lumaLink(recommendation.url, medium, { campaign: recommendation.id }),
    isPaid,
    paidLabel: PAID_OFFER_LABEL_NB,
    disclosure: PROMOTION_DISCLOSURE_NB,
    recommendationId: recommendation.id,
    ladderLevel: recommendation.ladderLevel,
    marketingCategory: recommendation.marketingCategory,
  };
}
