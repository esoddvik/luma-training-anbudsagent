/**
 * The complete database schema for Luma Anbudsvarsling.
 *
 * `packages/db` is the single owner of the schema (docs/architecture.md), and
 * this file is what drizzle-kit reads to generate migrations. A table that is
 * not re-exported here does not exist as far as the migration tool is
 * concerned, which is a quiet way to lose a table — so every schema module is
 * listed below.
 *
 * Table map (spec section 37):
 *
 * | File              | Tables                                                                                                                   |
 * | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
 * | `auth.ts`         | users, sessions, magic_link_tokens, companies, company_memberships                                                        |
 * | `signups.ts`      | pending_signups                                                                                                           |
 * | `tenders.ts`      | tenders, tender_cpv_codes, tender_regions, tender_municipalities, tender_revisions, tender_change_events                  |
 * | `profiles.ts`     | service_templates, alert_profiles, alert_profile_cpv_codes, alert_profile_keywords, alert_profile_geographies, alert_profile_buyers, alert_profile_template_remaps |
 * | `matching.ts`     | tender_matches, tender_match_reasons, user_tender_states, relevance_feedback, profile_suggestions                         |
 * | `sharing.ts`      | tender_shares                                                                                                             |
 * | `notifications.ts`| notification_preferences, notification_deliveries, notification_delivery_items, notification_category_unsubscribes, email_events, email_suppressions |
 * | `consent.ts`      | consent_text_versions, consent_events, legal_documents, legal_document_versions, user_legal_acceptances                   |
 * | `mcp.ts`          | mcp_tokens, mcp_audit_events                                                                                              |
 * | `orders.ts`       | order_requests                                                                                                            |
 * | `entitlements.ts` | user_entitlements                                                                                                         |
 * | `editorial.ts`    | editorial_recommendations, editorial_impressions, editorial_clicks                                                        |
 * | `attribution.ts`  | attribution_events                                                                                                        |
 * | `funnel.ts`       | funnel_events                                                                                                             |
 * | `ingestion.ts`    | ingestion_runs, ingestion_checkpoints, ingestion_errors                                                                   |
 * | `admin.ts`        | admin_audit_events                                                                                                        |
 */

export * from './enums.js';
export * from './auth.js';
export * from './signups.js';
export * from './tenders.js';
export * from './profiles.js';
export * from './matching.js';
export * from './sharing.js';
export * from './notifications.js';
export * from './consent.js';
export * from './mcp.js';
export * from './orders.js';
export * from './entitlements.js';
export * from './editorial.js';
export * from './attribution.js';
export * from './funnel.js';
export * from './ingestion.js';
export * from './admin.js';
