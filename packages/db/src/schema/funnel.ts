import { index, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, primaryId, timestamptz } from './columns.js';
import { funnelEventTypeEnum } from './enums.js';

/**
 * The search-first funnel (IDE Agent Spec v3, section 3.2).
 *
 * Seven events from "someone opened the picker" to "a profile went live",
 * every one of them carrying the service-template slug it happened under, so
 * the question the funnel exists to answer — which trades convert and which
 * bounce — is a group-by rather than an archaeology exercise.
 *
 * ## Why this is not `attribution_events`
 *
 * That table measures the *commercial* value the free service creates for
 * Luma: course seats, Påfyll subscriptions, webinars. Its shape is a load-
 * bearing guarantee, not a convenience — spec section 37 forbids it from
 * referencing the match tables, ADR-6 explains why, and
 * `attribution-isolation.integration.test.ts` reads `information_schema` and
 * fails if a forbidden column appears. Pouring onboarding telemetry into it
 * would dilute exactly the argument that makes its narrowness meaningful, and
 * every column it carries — `user_id`, `tender_id`, `share_id`,
 * `editorial_recommendation_id` — would be null for most of these events
 * anyway, because most of them happen before there is a user at all.
 *
 * ## No visitor identifier, and what that costs
 *
 * There is deliberately nothing here that links two events to one person: no
 * cookie, no session key, no address hash. What the spec asks for is a
 * comparison of the search-first funnel against the Fase A baseline, and that
 * is a question about *rates* — how many pickers viewed, how many signups
 * completed, per template, per day — which aggregate counts answer.
 *
 * Stated plainly because it is a real limitation and not a free win: this
 * cannot tell you that *this* visitor bounced at the region step. It can tell
 * you that the region step loses a third of everyone who reaches it. Adding a
 * visitor id would buy the first at the cost of tracking anonymous people
 * across a public page, on a service whose pitch is that it does not do things
 * like that. If per-visitor paths are ever genuinely needed, that is a
 * decision with a privacy notice attached, not a column someone adds quietly.
 */
export const funnelEvents = pgTable(
  'funnel_events',
  {
    id: primaryId(),
    type: funnelEventTypeEnum('type').notNull(),
    /**
     * The service template the event happened under.
     *
     * A slug, not a foreign key to `service_templates`. The funnel is a
     * historical record: retiring a template must not delete the evidence of
     * how it performed, and `set null` would erase which trade the row was
     * about — which is the only thing that makes the row worth keeping.
     * Null only for `picker_viewed`, which happens before a choice is made.
     */
    serviceTemplateSlug: text('service_template_slug'),
    /** Landsdel slug when the event happened on a regional surface. */
    landsdelSlug: text('landsdel_slug'),
    occurredAt: timestamptz('occurred_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // The funnel report: counts by type and template over a date range.
    index('funnel_events_type_occurred_idx').on(table.type, table.occurredAt.desc()),
    index('funnel_events_template_type_idx').on(table.serviceTemplateSlug, table.type),
  ],
);

export type FunnelEventRow = typeof funnelEvents.$inferSelect;
export type NewFunnelEventRow = typeof funnelEvents.$inferInsert;
