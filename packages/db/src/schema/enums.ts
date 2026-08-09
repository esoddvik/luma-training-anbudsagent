import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Every PostgreSQL enum in the schema.
 *
 * The values are written out as literals rather than read from `@luma/domain`
 * at runtime, for one practical reason: drizzle-kit loads this module to
 * generate migrations, and making the migration toolchain depend on another
 * workspace package having been built first turns a schema change into a build
 * ordering puzzle.
 *
 * The cost of that choice is drift, so it is paid for twice: `enum-parity.ts`
 * asserts at compile time that each enum's value union is *identical* to the
 * Zod-inferred type in `@luma/domain`, and `enums.test.ts` asserts at run time
 * that the value lists match element for element and in order. Adding a value
 * to a Zod enum without adding it here fails both `typecheck` and `test`.
 *
 * Enums that exist only in the database (delivery status, run status, and so
 * on) are grouped at the bottom and have no domain counterpart to check.
 */

// --- Mirrors of `@luma/domain` -------------------------------------------

/** `noticeCategorySchema` */
export const noticeCategoryEnum = pgEnum('notice_category', [
  'planned',
  'competition',
  'award',
  'other',
]);

/** `tenderStatusSchema` */
export const tenderStatusEnum = pgEnum('tender_status', [
  'open',
  'closed',
  'cancelled',
  'awarded',
  'unknown',
]);

/** `tenderSourceSchema`. A second value here is what an adapter for TED costs (ADR-7). */
export const tenderSourceEnum = pgEnum('tender_source', ['doffin']);

/** `tenderChangeKindSchema` */
export const tenderChangeKindEnum = pgEnum('tender_change_kind', [
  'deadline_changed',
  'cancelled',
  'title_changed',
  'description_changed',
  'cpv_changed',
  'attachment_or_revision_changed',
  'buyer_changed',
  'value_changed',
  'procedure_changed',
  'status_changed',
  'planned_became_competition',
]);

/** `alertFrequencySchema` */
export const alertFrequencyEnum = pgEnum('alert_frequency', ['immediate', 'daily', 'weekly']);

/**
 * `supplierFormSchema`
 *
 * How a supplier's demand is shaped (ADR-17). It weights onboarding and groups
 * analysis, and it must never reach the matching engine — a column, not a
 * signal.
 */
export const supplierFormEnum = pgEnum('supplier_form', ['sector_bound', 'cross_sector']);

/** `matchReasonTypeSchema` */
export const matchReasonTypeEnum = pgEnum('match_reason_type', [
  'cpv',
  'keyword',
  'geography',
  'buyer',
  'value',
  'notice_type',
  'procedure',
  'deadline',
]);

/** `matchConfidenceSchema` */
export const matchConfidenceEnum = pgEnum('match_confidence', ['high', 'medium', 'low']);

/** `feedbackVerdictSchema` */
export const feedbackVerdictEnum = pgEnum('feedback_verdict', [
  'relevant',
  'not_relevant',
  'already_known',
  'wrong_geography',
  'wrong_service',
  'wrong_size',
  'wrong_buyer',
  'wrong_cpv',
  'other',
]);

/** `consentTypeSchema` */
export const consentTypeEnum = pgEnum('consent_type', [
  'marketing_email',
  'privacy_acknowledgement',
  'terms_acceptance',
]);

/** `consentStatusSchema` */
export const consentStatusEnum = pgEnum('consent_status', [
  'granted',
  'withdrawn',
  'accepted',
  'superseded',
]);

/** `consentSourceSchema` */
export const consentSourceEnum = pgEnum('consent_source', [
  'signup',
  'account_settings',
  'checkout',
  'invoice_request',
  'course_registration',
  'newsletter_registration',
  'admin_recorded',
  'imported',
  'api',
]);

/** `legalDocumentKindSchema` */
export const legalDocumentKindEnum = pgEnum('legal_document_kind', ['terms', 'privacy']);

/** `orderStatusSchema` */
export const orderStatusEnum = pgEnum('order_status', [
  'received',
  'in_progress',
  'activated',
  'declined',
  'cancelled',
]);

/**
 * `attributionEventTypeSchema`
 *
 * `share_created` and `share_viewed` are appended rather than inserted next to
 * `share_to_signup`, because PostgreSQL enums are ordered and adding a value in
 * the middle of an existing type means rewriting it. Appending is what
 * `ALTER TYPE … ADD VALUE` does, which is what the migration emits.
 */
export const attributionEventTypeEnum = pgEnum('attribution_event_type', [
  'tool_to_paafyll',
  'tool_to_webinar',
  'tool_to_course_seat',
  'share_to_signup',
  'share_created',
  'share_viewed',
]);

/**
 * The search-first funnel, in the order a visitor moves through it
 * (IDE Agent Spec v3, section 3.2).
 *
 * Ordered deliberately, because PostgreSQL enums are ordered and the funnel
 * report reads better sorted by the enum than by an arbitrary alphabetisation.
 * A new step inserted in the middle means rewriting the type, so a later
 * addition should be appended and sorted explicitly in the query instead.
 */
export const funnelEventTypeEnum = pgEnum('funnel_event_type', [
  'picker_viewed',
  'trade_selected',
  'region_selected',
  'results_viewed',
  'signup_started',
  'signup_completed',
  'profile_activated',
]);

/** `promotionPlacementSchema` */
export const promotionPlacementEnum = pgEnum('promotion_placement', [
  'digest_footer',
  'tender_detail',
  'empty_state',
  'mcp_resource',
]);

/** `marketingCategorySchema` */
export const marketingCategoryEnum = pgEnum('marketing_category', [
  'free_guide',
  'course',
  'nho_course',
  'paid_newsletter',
  'webinar',
  'article',
  'tool',
]);

/** `regionScopeSchema` */
export const regionScopeEnum = pgEnum('region_scope', ['national', 'oslo_region']);

/** `utmMediumSchema` */
export const utmMediumEnum = pgEnum('utm_medium', [
  'digest',
  'immediate',
  'tender_detail',
  'empty_state',
  'shared_view',
  'mcp',
  'landing',
]);

/** `profileSuggestionSchema.shape.field` */
export const profileSuggestionFieldEnum = pgEnum('profile_suggestion_field', [
  'cpvInclude',
  'cpvExclude',
  'keywordsInclude',
  'keywordsExclude',
  'buyerExclude',
  'regionsInclude',
  'estimatedValueMinNok',
  'estimatedValueMaxNok',
]);

/** `profileSuggestionSchema.shape.operation` */
export const profileSuggestionOperationEnum = pgEnum('profile_suggestion_operation', [
  'add',
  'remove',
  'set',
]);

/** `profileSuggestionSchema.shape.status` */
export const profileSuggestionStatusEnum = pgEnum('profile_suggestion_status', [
  'pending',
  'accepted',
  'rejected',
]);

// --- Database-only enums --------------------------------------------------

/**
 * Admin is a column on the user, provisioned from `ADMIN_EMAIL_ALLOWLIST` and
 * enforced in the service layer rather than in routing alone (ADR-16).
 */
export const userRoleEnum = pgEnum('user_role', ['user', 'admin']);

export const companyRoleEnum = pgEnum('company_role', ['owner', 'admin', 'member']);

/** Include and exclude criteria share one table per criterion kind (spec section 37). */
export const criterionModeEnum = pgEnum('criterion_mode', ['include', 'exclude']);

/** `alert_profile_geographies` holds both levels; the domain keeps them apart. */
export const geographyKindEnum = pgEnum('geography_kind', ['region', 'municipality']);

/** A match row carries both its positive reasons and its hard exclusions. */
export const matchEntryTypeEnum = pgEnum('match_entry_type', ['reason', 'exclusion']);

/** What the user has done with a tender (spec section 16: saved, dismissed). */
export const userTenderStateEnum = pgEnum('user_tender_state', [
  'new',
  'opened',
  'saved',
  'dismissed',
]);

export const notificationKindEnum = pgEnum('notification_kind', [
  'immediate',
  'daily_digest',
  'weekly_digest',
  'tender_change',
]);

export const deliveryStatusEnum = pgEnum('delivery_status', [
  'pending',
  'scheduled',
  'sending',
  'sent',
  'failed',
  'cancelled',
  /** Prepared, then found to have nothing worth sending. Recorded, not sent. */
  'skipped',
]);

/** The three Postmark message streams from spec section 27 (ADR-5). */
export const messageStreamEnum = pgEnum('message_stream', [
  'transactional',
  'tender_notifications',
  'luma_marketing',
]);

/** Postmark webhook record types the system handles (spec section 27). */
export const emailEventTypeEnum = pgEnum('email_event_type', [
  'delivery',
  'bounce',
  'spam_complaint',
  'subscription_change',
  'open',
  'click',
]);

export const suppressionReasonEnum = pgEnum('suppression_reason', [
  'hard_bounce',
  'spam_complaint',
  'manual',
  'unsubscribe',
]);

/**
 * A category a user can unsubscribe from independently. Spec section 21 is
 * explicit that these do not cascade: leaving `marketing` must not stop
 * `tender_alerts`, and leaving `tender_alerts` must not withdraw consent.
 */
export const notificationCategoryEnum = pgEnum('notification_category', [
  'tender_alerts',
  'daily_digest',
  'weekly_digest',
  'immediate_alerts',
  'tender_changes',
  'marketing',
]);

export const ingestionRunStatusEnum = pgEnum('ingestion_run_status', [
  'running',
  'succeeded',
  'failed',
  /** Some pages succeeded and some failed. The checkpoint must not advance. */
  'partial',
]);

export const ingestionTriggerEnum = pgEnum('ingestion_trigger', ['schedule', 'manual', 'backfill']);

/** MCP scopes from spec section 30. */
export const mcpScopeEnum = pgEnum('mcp_scope', [
  'tenders:read',
  'profiles:read',
  'profiles:write',
  'saved:read',
  'saved:write',
  'feedback:write',
  /**
   * The one paid scope (IDE Agent Spec v3, section 7.2).
   *
   * Appended, not inserted: PostgreSQL enums are ordered and adding a value in
   * the middle rewrites the type.
   *
   * **Holding this scope on a token is not sufficient to use it.** The scope
   * says the token is *allowed* to ask; the live `user_entitlements` row is
   * what decides whether the answer is data or an upgrade refusal. Two gates,
   * because a token outlives a subscription — a scope granted in January must
   * not still be serving documents in December after the entitlement lapsed,
   * and revoking access must not require hunting down every token a user made.
   */
  'documents:read',
]);

export const mcpOutcomeEnum = pgEnum('mcp_outcome', ['ok', 'denied', 'error']);
