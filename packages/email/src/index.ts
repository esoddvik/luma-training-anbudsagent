/**
 * `@luma/email` renders and sends. It does nothing else.
 *
 * No database, no HTTP server, no queue. It turns domain objects into email
 * and hands them to Postmark, and it turns Postmark webhooks into typed events
 * and side-effect *intents* that somebody else carries out. That boundary is
 * what keeps the trust rules in spec sections 3, 23 and 27 testable: the whole
 * package is a pure function of its input plus one network call.
 *
 * The three things worth knowing before using it:
 *
 * - You name a template, never a stream. The mapping is in `postmark/streams`
 *   and the send methods' types enforce it (ADR-0005).
 * - The marketing stream needs a `MarketingConsentProof`, which only
 *   `verifyMarketingConsent` can produce.
 * - Promotion is selected before rendering and placed after every tender, and
 *   `assertPromotionOrder` will tell you if that ever stops being true.
 */

// Copy. Every customer-facing string in the package.
export * from './copy.js';

// Types and templates.
export * from './types.js';
export {
  renderAccountDeleted,
  renderAlertConfirmation,
  renderDailyDigest,
  renderDigest,
  renderImmediateAlert,
  renderMagicLink,
  renderMaterialChange,
  renderOrderReceived,
  renderPaidAccessActivated,
  renderWeeklyDigest,
  type DigestEmail,
  type DigestVariant,
} from './render/templates/index.js';
export { MARKERS, type Part } from './render/parts.js';
export { MAX_REASONS, renderTenderCard, type TenderCardOptions } from './render/tender-card.js';
export { renderPromotion } from './render/promotion.js';
export { escapeHtml, MAX_WIDTH_PX, PALETTE } from './render/html.js';

// Formatting and links.
export {
  DISPLAY_TIME_ZONE,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatInteger,
  formatValueRange,
} from './format.js';
export { buildLinks, extractUrls, externalSourceLink, lumaLink, type EmailLinks } from './links.js';

// Promotion selection (spec section 23).
export {
  headingForCategory,
  inspectRecommendationCopy,
  LADDER_AGE_THRESHOLDS_DAYS,
  ladderStateForAccount,
  selectPromotion,
  selectPromotionDetailed,
  toPromotionBlock,
  type LadderState,
  type PromotionBlock,
  type PromotionCopyIssue,
  type PromotionSelection,
  type SelectPromotionInput,
} from './promotion.js';
export {
  containsProhibitedPhrase,
  findProhibitedPhrases,
  PROHIBITED_PHRASE_RULES,
  type ProhibitedCategory,
  type ProhibitedPhraseMatch,
  type ProhibitedPhraseRule,
} from './prohibited.js';

// Postmark.
export {
  PostmarkEmailClient,
  type EmailClient,
  type MarketingCampaign,
  type PostmarkOutboundMessage,
  type PostmarkSendResponse,
  type PostmarkTransport,
  type PostmarkEmailClientOptions,
  type SendOptions,
  type SendOutcome,
  type TenderSendOptions,
} from './postmark/client.js';
export {
  assertMarketingConsent,
  isIssuedProof,
  MarketingConsentProof,
  MarketingConsentRequiredError,
  verifyMarketingConsent,
  type MarketingConsentVerification,
} from './postmark/consent.js';
export { FakePostmarkClient, type RecordedEmail } from './postmark/fake.js';
export {
  streamForTemplate,
  streamId,
  streamIdsFromEnv,
  STREAM_KINDS,
  TEMPLATE_STREAM,
  templatesForStream,
  type MarketingTemplate,
  type StreamIds,
  type StreamKind,
  type TemplatesForStream,
  type TemplateStreamMap,
  type TenderNotificationTemplate,
  type TransactionalTemplate,
} from './postmark/streams.js';
export { createEmailClientFromEnv, createPostmarkTransport } from './postmark/transport.js';

// Webhooks.
export {
  authenticateWebhook,
  basicAuthHeader,
  type WebhookAuthResult,
  type WebhookCredentials,
} from './webhooks/auth.js';
export {
  assertNoCrossStreamEffect,
  deriveIntents,
  type SuppressionCause,
  type WebhookIntent,
} from './webhooks/intents.js';
export {
  InMemoryWebhookIdempotencyStore,
  processPostmarkWebhook,
  type ProcessWebhookInput,
  type WebhookIdempotencyStore,
  type WebhookOutcome,
} from './webhooks/process.js';
export {
  idempotencyKey,
  occurredAtOf,
  parseWebhookEvent,
  postmarkWebhookEventSchema,
  recipientOf,
  type ParseWebhookResult,
  type PostmarkRecordType,
  type PostmarkWebhookEvent,
} from './webhooks/schema.js';

// Verification helpers, usable from other packages' tests.
export {
  assertPromotionOrder,
  checkPromotionOrder,
  promotionBlockRange,
  stripPromotionBlock,
  type PromotionOrderViolation,
  type PromotionOrderViolationCode,
} from './testing/promotion-order.js';
export * as fixtures from './testing/fixtures.js';
export {
  digestContext,
  renderAllTemplates,
  type RenderAllOptions,
} from './testing/all-templates.js';
