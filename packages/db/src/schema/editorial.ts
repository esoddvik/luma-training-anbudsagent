import { relations, sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { createdAt, primaryId, timestamptz, updatedAt } from './columns.js';
import { notificationDeliveries } from './notifications.js';
import { tenders } from './tenders.js';
import {
  marketingCategoryEnum,
  promotionPlacementEnum,
  regionScopeEnum,
  utmMediumEnum,
} from './enums.js';

/**
 * Editorial recommendations: Luma's own promotion (spec sections 23 and 24).
 *
 * This is a separate, inspectable layer on purpose. Nothing here may reach a
 * ranking decision (ADR-6, ADR-14), and there is no foreign key from any table
 * in this file into `tender_matches` or `alert_profiles`. Regional routing
 * uses the region codes on the user's alert profiles, resolved at render time,
 * never a stored link and never an IP address (spec section 23.2).
 */
export const editorialRecommendations = pgTable(
  'editorial_recommendations',
  {
    id: primaryId(),
    /** Norwegian. Shown to the user. */
    title: text('title').notNull(),
    description: text('description').notNull(),
    url: text('url').notNull(),
    placement: promotionPlacementEnum('placement').notNull(),
    /** Free-text tags matched against theme and industry at selection time. */
    relevanceTags: text('relevance_tags').array().notNull().default([]),
    /** The promotion ladder from spec section 23.1: 1 lowest threshold, 4 highest. */
    ladderLevel: smallint('ladder_level').notNull(),
    regionScope: regionScopeEnum('region_scope').notNull().default('national'),
    marketingCategory: marketingCategoryEnum('marketing_category').notNull(),
    /** True when the offer costs money, which must be labelled (spec 23.4). */
    isPaid: boolean('is_paid').notNull().default(false),
    /** Used for campaign attribution; usually the slug. */
    campaign: text('campaign'),
    activeFrom: timestamptz('active_from'),
    activeUntil: timestamptz('active_until'),
    active: boolean('active').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /**
     * **Soft delete.** Impressions and clicks reference the recommendation and
     * the attribution report reads back over months. Hard-deleting a retired
     * campaign would silently drop rows out of the quarterly numbers in spec
     * section 44.3.
     */
    deletedAt: timestamptz('deleted_at'),
  },
  (table) => [
    // Selection: active recommendations for one placement, by ladder level.
    index('editorial_recommendations_selection_idx').on(
      table.active,
      table.placement,
      table.ladderLevel,
    ),
    index('editorial_recommendations_window_idx').on(table.activeFrom, table.activeUntil),
    check('editorial_recommendations_ladder_range', sql`${table.ladderLevel} BETWEEN 1 AND 4`),
    check(
      'editorial_recommendations_window_ordered',
      sql`${table.activeFrom} IS NULL
          OR ${table.activeUntil} IS NULL
          OR ${table.activeFrom} < ${table.activeUntil}`,
    ),
  ],
);

/**
 * A promotion block that was rendered.
 *
 * `tenderId` records which tender page it appeared on. That is a reporting
 * reference in the same sense as the one on `attribution_events`, and it is
 * the only tender-side link this table has: no match id, no profile id, so a
 * query cannot ask "which promotions did high-scoring matches produce", which
 * is the question ADR-6 exists to make unaskable.
 */
export const editorialImpressions = pgTable(
  'editorial_impressions',
  {
    id: primaryId(),
    recommendationId: uuid('recommendation_id')
      .notNull()
      // restrict: pairs with the soft delete above. A hard delete that took
      // the reporting history with it should fail loudly.
      .references(() => editorialRecommendations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id, {
      // cascade: an impression is the person's own view history.
      onDelete: 'cascade',
    }),
    placement: promotionPlacementEnum('placement').notNull(),
    /** Set for a digest-footer impression. */
    deliveryId: uuid('delivery_id').references(() => notificationDeliveries.id, {
      onDelete: 'set null',
    }),
    /** Set for a tender-detail impression. Reporting only. */
    tenderId: uuid('tender_id').references(() => tenders.id, { onDelete: 'set null' }),
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('editorial_impressions_recommendation_occurred_idx').on(
      table.recommendationId,
      table.occurredAt.desc(),
    ),
    index('editorial_impressions_user_id_idx').on(table.userId),
  ],
);

export const editorialClicks = pgTable(
  'editorial_clicks',
  {
    id: primaryId(),
    recommendationId: uuid('recommendation_id')
      .notNull()
      .references(() => editorialRecommendations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    placement: promotionPlacementEnum('placement').notNull(),
    deliveryId: uuid('delivery_id').references(() => notificationDeliveries.id, {
      onDelete: 'set null',
    }),
    tenderId: uuid('tender_id').references(() => tenders.id, { onDelete: 'set null' }),
    /** Always `anbudsvarsling` (spec section 44.2), stored so it is checkable. */
    utmSource: text('utm_source'),
    utmMedium: utmMediumEnum('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmContent: text('utm_content'),
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('editorial_clicks_recommendation_occurred_idx').on(
      table.recommendationId,
      table.occurredAt.desc(),
    ),
    index('editorial_clicks_user_id_idx').on(table.userId),
    index('editorial_clicks_campaign_idx').on(table.utmCampaign),
  ],
);

export const editorialRecommendationsRelations = relations(
  editorialRecommendations,
  ({ many }) => ({
    impressions: many(editorialImpressions),
    clicks: many(editorialClicks),
  }),
);

export const editorialImpressionsRelations = relations(editorialImpressions, ({ one }) => ({
  recommendation: one(editorialRecommendations, {
    fields: [editorialImpressions.recommendationId],
    references: [editorialRecommendations.id],
  }),
}));

export const editorialClicksRelations = relations(editorialClicks, ({ one }) => ({
  recommendation: one(editorialRecommendations, {
    fields: [editorialClicks.recommendationId],
    references: [editorialRecommendations.id],
  }),
}));

export type EditorialRecommendationRow = typeof editorialRecommendations.$inferSelect;
export type NewEditorialRecommendationRow = typeof editorialRecommendations.$inferInsert;
export type EditorialImpressionRow = typeof editorialImpressions.$inferSelect;
export type EditorialClickRow = typeof editorialClicks.$inferSelect;
