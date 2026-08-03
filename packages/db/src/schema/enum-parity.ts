import {
  alertFrequencySchema,
  attributionEventTypeSchema,
  consentSourceSchema,
  consentStatusSchema,
  consentTypeSchema,
  feedbackVerdictSchema,
  legalDocumentKindSchema,
  marketingCategorySchema,
  matchConfidenceSchema,
  matchReasonTypeSchema,
  noticeCategorySchema,
  orderStatusSchema,
  profileSuggestionSchema,
  promotionPlacementSchema,
  regionScopeSchema,
  tenderChangeKindSchema,
  tenderSourceSchema,
  tenderStatusSchema,
  utmMediumSchema,
  type AlertFrequency,
  type AttributionEventType,
  type ConsentSource,
  type ConsentStatus,
  type ConsentType,
  type FeedbackVerdict,
  type LegalDocumentKind,
  type MarketingCategory,
  type MatchConfidence,
  type MatchReasonType,
  type NoticeCategory,
  type OrderStatus,
  type PromotionPlacement,
  type RegionScope,
  type TenderChangeKind,
  type TenderSource,
  type TenderStatus,
  type UtmMedium,
} from '@luma/domain';
import {
  alertFrequencyEnum,
  attributionEventTypeEnum,
  consentSourceEnum,
  consentStatusEnum,
  consentTypeEnum,
  feedbackVerdictEnum,
  legalDocumentKindEnum,
  marketingCategoryEnum,
  matchConfidenceEnum,
  matchReasonTypeEnum,
  noticeCategoryEnum,
  orderStatusEnum,
  profileSuggestionFieldEnum,
  profileSuggestionOperationEnum,
  profileSuggestionStatusEnum,
  promotionPlacementEnum,
  regionScopeEnum,
  tenderChangeKindEnum,
  tenderSourceEnum,
  tenderStatusEnum,
  utmMediumEnum,
} from './enums.js';

/**
 * Keeps the PostgreSQL enums and the Zod enums in `@luma/domain` identical.
 *
 * The failure this exists to prevent is quiet and expensive: somebody adds
 * `'suspended'` to `tenderStatusSchema`, the API validates it happily, and the
 * insert fails at 03:00 inside an ingest job with `invalid input value for
 * enum tender_status`.
 *
 * It is checked two ways, because they fail at different moments and neither
 * subsumes the other:
 *
 * 1. The `assertEqual` calls below fail at `pnpm typecheck` and `pnpm build`,
 *    and light up in the editor while the change is being made. **This file
 *    lives in `src/` rather than in a test on purpose** — `tsconfig.json`
 *    excludes `*.test.ts`, so a type-level assertion written in a test file
 *    would never be checked by anything.
 * 2. `enums.test.ts` compares the value lists at runtime, which catches a case
 *    the types cannot: two enums that agree as unions but differ in order.
 *    Order is not cosmetic in PostgreSQL — enum comparison and `ORDER BY` use
 *    declaration order.
 *
 * Why the values are not simply derived from the Zod schemas: drizzle-kit
 * loads `schema/index.ts` to generate migrations, and making the migration
 * toolchain depend on `@luma/domain` having been built first turns every
 * schema change into a build-ordering puzzle. This file is the price of
 * keeping `enums.ts` self-contained, and it is paid at compile time.
 */

/**
 * True only when `A` and `B` are the same type.
 *
 * The two-function-signature trick gives an invariant comparison. A plain
 * `A extends B ? true : false` would accept a subset, and let a value missing
 * from one side through in one direction — which is exactly the bug.
 */
type AssertEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

function assertEqual<A, B>(_equal: AssertEqual<A, B> extends true ? true : never): void {
  // The assertion is in the type parameters; there is nothing to do at runtime.
}

type ProfileSuggestion = ReturnType<typeof profileSuggestionSchema.parse>;

assertEqual<(typeof noticeCategoryEnum.enumValues)[number], NoticeCategory>(true);
assertEqual<(typeof tenderStatusEnum.enumValues)[number], TenderStatus>(true);
assertEqual<(typeof tenderSourceEnum.enumValues)[number], TenderSource>(true);
assertEqual<(typeof tenderChangeKindEnum.enumValues)[number], TenderChangeKind>(true);
assertEqual<(typeof alertFrequencyEnum.enumValues)[number], AlertFrequency>(true);
assertEqual<(typeof matchReasonTypeEnum.enumValues)[number], MatchReasonType>(true);
assertEqual<(typeof matchConfidenceEnum.enumValues)[number], MatchConfidence>(true);
assertEqual<(typeof feedbackVerdictEnum.enumValues)[number], FeedbackVerdict>(true);
assertEqual<(typeof consentTypeEnum.enumValues)[number], ConsentType>(true);
assertEqual<(typeof consentStatusEnum.enumValues)[number], ConsentStatus>(true);
assertEqual<(typeof consentSourceEnum.enumValues)[number], ConsentSource>(true);
assertEqual<(typeof legalDocumentKindEnum.enumValues)[number], LegalDocumentKind>(true);
assertEqual<(typeof orderStatusEnum.enumValues)[number], OrderStatus>(true);
assertEqual<(typeof attributionEventTypeEnum.enumValues)[number], AttributionEventType>(true);
assertEqual<(typeof promotionPlacementEnum.enumValues)[number], PromotionPlacement>(true);
assertEqual<(typeof marketingCategoryEnum.enumValues)[number], MarketingCategory>(true);
assertEqual<(typeof regionScopeEnum.enumValues)[number], RegionScope>(true);
assertEqual<(typeof utmMediumEnum.enumValues)[number], UtmMedium>(true);
assertEqual<(typeof profileSuggestionFieldEnum.enumValues)[number], ProfileSuggestion['field']>(
  true,
);
assertEqual<
  (typeof profileSuggestionOperationEnum.enumValues)[number],
  ProfileSuggestion['operation']
>(true);
assertEqual<(typeof profileSuggestionStatusEnum.enumValues)[number], ProfileSuggestion['status']>(
  true,
);

export interface DomainEnumPair {
  /** The PostgreSQL type name. */
  name: string;
  pg: readonly string[];
  zod: readonly string[];
}

const suggestionShape = profileSuggestionSchema.shape;

/**
 * Every pgEnum that mirrors a Zod enum, paired with its counterpart.
 *
 * Exported so `enums.test.ts` iterates over the list rather than restating it,
 * which means adding a domain-backed enum in one place adds a test case.
 */
export const DOMAIN_ENUM_PAIRS: readonly DomainEnumPair[] = [
  { name: 'notice_category', pg: noticeCategoryEnum.enumValues, zod: noticeCategorySchema.options },
  { name: 'tender_status', pg: tenderStatusEnum.enumValues, zod: tenderStatusSchema.options },
  { name: 'tender_source', pg: tenderSourceEnum.enumValues, zod: tenderSourceSchema.options },
  {
    name: 'tender_change_kind',
    pg: tenderChangeKindEnum.enumValues,
    zod: tenderChangeKindSchema.options,
  },
  { name: 'alert_frequency', pg: alertFrequencyEnum.enumValues, zod: alertFrequencySchema.options },
  {
    name: 'match_reason_type',
    pg: matchReasonTypeEnum.enumValues,
    zod: matchReasonTypeSchema.options,
  },
  {
    name: 'match_confidence',
    pg: matchConfidenceEnum.enumValues,
    zod: matchConfidenceSchema.options,
  },
  {
    name: 'feedback_verdict',
    pg: feedbackVerdictEnum.enumValues,
    zod: feedbackVerdictSchema.options,
  },
  { name: 'consent_type', pg: consentTypeEnum.enumValues, zod: consentTypeSchema.options },
  { name: 'consent_status', pg: consentStatusEnum.enumValues, zod: consentStatusSchema.options },
  { name: 'consent_source', pg: consentSourceEnum.enumValues, zod: consentSourceSchema.options },
  {
    name: 'legal_document_kind',
    pg: legalDocumentKindEnum.enumValues,
    zod: legalDocumentKindSchema.options,
  },
  { name: 'order_status', pg: orderStatusEnum.enumValues, zod: orderStatusSchema.options },
  {
    name: 'attribution_event_type',
    pg: attributionEventTypeEnum.enumValues,
    zod: attributionEventTypeSchema.options,
  },
  {
    name: 'promotion_placement',
    pg: promotionPlacementEnum.enumValues,
    zod: promotionPlacementSchema.options,
  },
  {
    name: 'marketing_category',
    pg: marketingCategoryEnum.enumValues,
    zod: marketingCategorySchema.options,
  },
  { name: 'region_scope', pg: regionScopeEnum.enumValues, zod: regionScopeSchema.options },
  { name: 'utm_medium', pg: utmMediumEnum.enumValues, zod: utmMediumSchema.options },
  {
    name: 'profile_suggestion_field',
    pg: profileSuggestionFieldEnum.enumValues,
    zod: suggestionShape.field.options,
  },
  {
    name: 'profile_suggestion_operation',
    pg: profileSuggestionOperationEnum.enumValues,
    zod: suggestionShape.operation.options,
  },
  {
    name: 'profile_suggestion_status',
    pg: profileSuggestionStatusEnum.enumValues,
    zod: suggestionShape.status.options,
  },
];
