import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { createdAt, primaryId, timestamptz } from './columns.js';
import { editorialRecommendations } from './editorial.js';
import { tenderShares } from './sharing.js';
import { tenders } from './tenders.js';
import { attributionEventTypeEnum, utmMediumEnum } from './enums.js';

/**
 * Attribution measurement (spec section 44.2, ADR-6).
 *
 * ## Why this table has no foreign key into the match tables
 *
 * Spec section 37 states it as a constraint: `attribution_events` must not be
 * linkable to matching logic — no foreign keys into the match tables beyond
 * `tender_id` for reporting. ADR-6 explains why. These rows measure the
 * commercial value the free service creates for Luma: course seats, Påfyll
 * subscriptions, webinar registrations. Spec section 44.3 says those numbers
 * are reported and must never steer product logic, and section 4.1 promises
 * the user that promotion never changes which tenders they see.
 *
 * A promise like that is worth what it costs to break. Right now, breaking it
 * would take a schema change: without a path from an attribution row to a
 * `tender_matches` row, no query can rank tenders by the revenue they
 * produced, and no well-meaning "let's weight what converts" refactor can be
 * written without someone adding a column and a reviewer seeing it.
 *
 * So: `tender_id` is permitted, because reporting needs to say which tender
 * surface an event came from. `alert_profile_id`, `tender_match_id` and
 * `tender_match_reason_id` are **not**, and must not be added. The schema test
 * in `attribution-isolation.integration.test.ts` reads `information_schema`
 * and fails if one appears.
 *
 * **Deletion policy: sever, do not cascade.** The quarterly attribution report
 * is an aggregate over months. Cascading on account deletion would silently
 * restate past quarters; setting `user_id` to null keeps the count and drops
 * the person.
 */
export const attributionEvents = pgTable(
  'attribution_events',
  {
    id: primaryId(),
    type: attributionEventTypeEnum('type').notNull(),
    /** Null for an anonymous share view that has not yet registered. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * The one permitted tender-side reference, for reporting only
     * (spec section 37). Nothing downstream joins this to a match.
     */
    tenderId: uuid('tender_id').references(() => tenders.id, { onDelete: 'set null' }),
    /** Which promotion produced it, when the event came from one. */
    editorialRecommendationId: uuid('editorial_recommendation_id').references(
      () => editorialRecommendations.id,
      { onDelete: 'set null' },
    ),
    /** Set for `share_to_signup` (spec section 44.2, ADR-15). */
    shareId: uuid('share_id').references(() => tenderShares.id, { onDelete: 'set null' }),
    /** Always `anbudsvarsling` in practice; stored so the claim is checkable. */
    utmSource: text('utm_source'),
    utmMedium: utmMediumEnum('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmContent: text('utm_content'),
    occurredAt: timestamptz('occurred_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // The quarterly report groups by type over a date range.
    index('attribution_events_type_occurred_idx').on(table.type, table.occurredAt.desc()),
    index('attribution_events_occurred_idx').on(table.occurredAt.desc()),
    // "Signups per share" in the sharing-chain metric.
    index('attribution_events_share_id_idx').on(table.shareId),
    index('attribution_events_recommendation_idx').on(table.editorialRecommendationId),
  ],
);

export type AttributionEventRow = typeof attributionEvents.$inferSelect;
export type NewAttributionEventRow = typeof attributionEvents.$inferInsert;
