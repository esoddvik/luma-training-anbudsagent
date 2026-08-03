import { z } from 'zod';

/**
 * Editorial recommendations: Luma's own promotion (spec sections 23 and 24).
 *
 * This module exists so that promotion is a separate, inspectable layer. It
 * must never be imported by the matching package, and nothing here may reach
 * a ranking decision (ADR-6, ADR-14). An automated import test enforces that.
 */

export const promotionPlacementSchema = z.enum([
  'digest_footer',
  'tender_detail',
  'empty_state',
  'mcp_resource',
]);
export type PromotionPlacement = z.infer<typeof promotionPlacementSchema>;

export const marketingCategorySchema = z.enum([
  'free_guide',
  'course',
  'nho_course',
  'paid_newsletter',
  'webinar',
  'article',
  'tool',
]);
export type MarketingCategory = z.infer<typeof marketingCategorySchema>;

/**
 * The promotion ladder (spec section 23.1), lowest threshold first.
 *
 * 1 free professional content, the default for new users
 * 2 Påfyll, the paid newsletter and the main digest promotion
 * 3 NHO course (national, hybrid) and webinars
 * 4 the full-day course in Oslo, subject to regional routing
 *
 * The ladder orders editorial choice. It is explicitly not an aggressiveness
 * scale: every level obeys the same placement and labelling rules.
 */
export const ladderLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type LadderLevel = z.infer<typeof ladderLevelSchema>;

export const regionScopeSchema = z.enum(['national', 'oslo_region']);
export type RegionScope = z.infer<typeof regionScopeSchema>;

export const editorialRecommendationSchema = z.object({
  id: z.uuid(),
  /** Norwegian. Shown to the user. */
  title: z.string().min(1),
  description: z.string().min(1),
  url: z.url(),
  placement: promotionPlacementSchema,
  relevanceTags: z.array(z.string()),
  ladderLevel: ladderLevelSchema,
  regionScope: regionScopeSchema,
  marketingCategory: marketingCategorySchema,
  /** True when the offer costs money, which must be labelled (spec 23.4). */
  isPaid: z.boolean(),
  activeFrom: z.date().optional(),
  activeUntil: z.date().optional(),
  active: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type EditorialRecommendation = z.infer<typeof editorialRecommendationSchema>;

/** Approved Norwegian headings for a promotion block (spec section 23.4). */
export const PROMOTION_HEADINGS_NB = {
  generic: 'Fra Luma Training',
  paafyll: 'Faglig påfyll fra Luma Training',
  skill: 'Vil du bli bedre i tilbudsarbeidet?',
} as const;

/** The disclosure that accompanies every promotion block (spec section 43). */
export const PROMOTION_DISCLOSURE_NB =
  'Dette er informasjon om kurs eller faglig innhold fra Luma Training. Det påvirker ikke hvilke anbud du får se.';

/** Shown next to a promotion for something that costs money. */
export const PAID_OFFER_LABEL_NB = 'Betalt tilbud';

/**
 * Whether a recommendation may be shown to a user, given the moment, the
 * user's profile geography, and the Oslo region list from configuration.
 *
 * Routing is based on the alert profile's stated geography, never on IP
 * address or tracking (spec section 23.2).
 */
export function isRecommendationEligible(input: {
  recommendation: EditorialRecommendation;
  now: Date;
  /** Region codes from the user's alert profiles. */
  userRegionCodes: readonly string[];
  /** Configured codes that count as the Oslo region. */
  osloRegionCodes: readonly string[];
}): boolean {
  const { recommendation, now, userRegionCodes, osloRegionCodes } = input;

  if (!recommendation.active) return false;
  if (recommendation.activeFrom && now < recommendation.activeFrom) return false;
  if (recommendation.activeUntil && now > recommendation.activeUntil) return false;
  if (recommendation.regionScope === 'national') return true;

  const oslo = new Set(osloRegionCodes.map((code) => code.toUpperCase()));
  return userRegionCodes.some((code) => oslo.has(code.toUpperCase()));
}
