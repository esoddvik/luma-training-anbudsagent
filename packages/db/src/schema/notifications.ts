import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { JsonValue } from '@luma/domain';
import { users } from './auth.js';
import { createdAt, primaryId, timestamptz, updatedAt } from './columns.js';
import { alertProfiles } from './profiles.js';
import { tenderMatches } from './matching.js';
import { tenderChangeEvents, tenders } from './tenders.js';
import {
  deliveryStatusEnum,
  emailEventTypeEnum,
  messageStreamEnum,
  notificationCategoryEnum,
  notificationKindEnum,
  suppressionReasonEnum,
} from './enums.js';

/**
 * Notification preferences, outbound deliveries and Postmark feedback
 * (spec sections 22, 26 and 27).
 */

/**
 * Per-user notification settings (spec section 22).
 *
 * **`marketingEmailConsent` from the domain type is deliberately absent.**
 * The `NotificationPreferences` shape in `@luma/domain` includes it because
 * that is what the settings *screen* shows, but storing it here would make a
 * boolean the source of truth for consent, which ADR-9 rejects outright: it
 * cannot demonstrate what wording the user agreed to, and it overwrites the
 * previous answer. The read model assembles that field from the latest
 * `consent_events` row. Anything that writes it here is a bug.
 *
 * `includeLumaPromotionsInTenderEmails` *is* stored here, because it is a
 * content setting for the tender emails rather than consent (spec section 22).
 */
export const notificationPreferences = pgTable('notification_preferences', {
  /** One row per user; the user id is the key. */
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  tenderAlertsEnabled: boolean('tender_alerts_enabled').notNull().default(true),
  immediateAlertsEnabled: boolean('immediate_alerts_enabled').notNull().default(false),
  digestEnabled: boolean('digest_enabled').notNull().default(true),
  includeLumaPromotionsInTenderEmails: boolean('include_luma_promotions_in_tender_emails')
    .notNull()
    .default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * One outbound notification email.
 *
 * `idempotency_key` is the mechanism behind spec section 38's "ingen doble
 * e-poster" under at-least-once job delivery: the preparer computes a key from
 * the user, the kind and the window, and the unique index turns a replayed job
 * into a conflict rather than a second email.
 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      // cascade: send history is personal data with no retention obligation of
      // its own. Aggregate deliverability lives in email_events.
      .references(() => users.id, { onDelete: 'cascade' }),
    alertProfileId: uuid('alert_profile_id').references(() => alertProfiles.id, {
      // set null: a deleted profile must not erase the record of what was sent.
      onDelete: 'set null',
    }),
    kind: notificationKindEnum('kind').notNull(),
    status: deliveryStatusEnum('status').notNull().default('pending'),
    /** Tender emails go on `tender_notifications`, never on `luma_marketing`. */
    messageStream: messageStreamEnum('message_stream').notNull(),
    templateAlias: text('template_alias'),
    /** Resolved from the profile's local digest hour and timezone. */
    scheduledFor: timestamptz('scheduled_for').notNull(),
    sentAt: timestamptz('sent_at'),
    itemCount: integer('item_count').notNull().default(0),
    /** Stored so a Postmark webhook can be joined back to what was sent. */
    postmarkMessageId: text('postmark_message_id'),
    failureReason: text('failure_reason'),
    attemptCount: integer('attempt_count').notNull().default(0),
    /** Deterministic per (user, kind, window). See the note above. */
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('notification_deliveries_idempotency_key').on(table.idempotencyKey),
    uniqueIndex('notification_deliveries_postmark_message_id_key').on(table.postmarkMessageId),
    // Spec: deliveries by user and scheduled time.
    index('notification_deliveries_user_scheduled_idx').on(table.userId, table.scheduledFor),
    // The sender picks up due work across all users.
    index('notification_deliveries_status_scheduled_idx').on(table.status, table.scheduledFor),
  ],
);

/**
 * One tender inside one notification.
 *
 * The unique index is spec section 37's "unik delivery item" and it is the
 * thing that makes spec section 52 item 5 true: a tender that was ingested
 * twice, or matched by two of the user's profiles in the same window, still
 * appears exactly once in the email.
 */
export const notificationDeliveryItems = pgTable(
  'notification_delivery_items',
  {
    id: primaryId(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => notificationDeliveries.id, { onDelete: 'cascade' }),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id, { onDelete: 'cascade' }),
    /** Null for a change notification, which has no score behind it. */
    tenderMatchId: uuid('tender_match_id').references(() => tenderMatches.id, {
      onDelete: 'set null',
    }),
    /** Set when the item is a change to a saved tender (email section 6). */
    tenderChangeEventId: uuid('tender_change_event_id').references(() => tenderChangeEvents.id, {
      onDelete: 'set null',
    }),
    /** Which section of the email it belongs in (spec section 26). */
    section: notificationKindEnum('section').notNull().default('daily_digest'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    uniqueIndex('notification_delivery_items_delivery_tender_key').on(
      table.deliveryId,
      table.tenderId,
    ),
    index('notification_delivery_items_tender_id_idx').on(table.tenderId),
  ],
);

/**
 * A category the user has unsubscribed from (spec section 21).
 *
 * Separate from `consent_events` on purpose: unsubscribing from tender alerts
 * must not withdraw marketing consent, and withdrawing marketing consent must
 * not stop the tender alerts. Two switches, two tables, no shared column that
 * could accidentally couple them.
 */
export const notificationCategoryUnsubscribes = pgTable(
  'notification_category_unsubscribes',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: notificationCategoryEnum('category').notNull(),
    unsubscribedAt: timestamptz('unsubscribed_at').notNull().defaultNow(),
    /** How it happened: a one-click header, the settings page, a webhook. */
    source: text('source'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('notification_category_unsubscribes_user_category_key').on(
      table.userId,
      table.category,
    ),
  ],
);

/**
 * Postmark webhook events (spec section 27).
 *
 * Processing must be idempotent, so the unique index below is the guard: the
 * same webhook replayed produces a conflict rather than a second bounce count.
 */
export const emailEvents = pgTable(
  'email_events',
  {
    id: primaryId(),
    postmarkMessageId: text('postmark_message_id').notNull(),
    eventType: emailEventTypeEnum('event_type').notNull(),
    messageStream: messageStreamEnum('message_stream'),
    /** Kept so a bounce can be reconciled before the user row is resolved. */
    recipientEmail: text('recipient_email').notNull(),
    userId: uuid('user_id').references(() => users.id, {
      // set null: deliverability history for a domain outlives one account and
      // is not personal data once the reference is severed.
      onDelete: 'set null',
    }),
    deliveryId: uuid('delivery_id').references(() => notificationDeliveries.id, {
      onDelete: 'set null',
    }),
    /** The raw webhook body, kept for diagnosis. Postmark data only. */
    payload: jsonb('payload').$type<JsonValue>(),
    occurredAt: timestamptz('occurred_at').notNull(),
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
  },
  (table) => [
    // The idempotency key from spec section 27 and ADR-5, made a property of
    // the database: Postmark `MessageID` plus the event type, exactly what
    // `idempotencyKey()` in `@luma/email` computes.
    //
    // `occurred_at` used to be part of this key and was removed deliberately.
    // It comes out of the webhook payload, so including it made the constraint
    // *look* like deduplication while depending on Postmark sending a
    // byte-identical timestamp on every retry. A redelivery whose timestamp
    // differed by a second would have produced a second bounce row and a
    // second suppression write. Two columns, and the handler can insert
    // blindly and read the conflict instead of reading first and racing.
    uniqueIndex('email_events_message_id_event_type_key').on(
      table.postmarkMessageId,
      table.eventType,
    ),
    index('email_events_message_id_idx').on(table.postmarkMessageId),
    index('email_events_user_occurred_idx').on(table.userId, table.occurredAt.desc()),
    index('email_events_type_occurred_idx').on(table.eventType, table.occurredAt.desc()),
  ],
);

/**
 * Addresses Postmark will not accept mail for, per stream (spec section 27).
 *
 * Per stream, because a marketing suppression must not silence account-critical
 * mail on the transactional stream (spec section 27, ADR-5).
 */
export const emailSuppressions = pgTable(
  'email_suppressions',
  {
    id: primaryId(),
    email: text('email').notNull(),
    messageStream: messageStreamEnum('message_stream').notNull(),
    reason: suppressionReasonEnum('reason').notNull(),
    suppressedAt: timestamptz('suppressed_at').notNull().defaultNow(),
    /** Set when the address is reactivated; the row is kept as history. */
    reactivatedAt: timestamptz('reactivated_at'),
    detail: text('detail'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('email_suppressions_email_stream_key').on(table.email, table.messageStream),
    index('email_suppressions_email_idx').on(table.email),
  ],
);

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(users, { fields: [notificationPreferences.userId], references: [users.id] }),
}));

export const notificationDeliveriesRelations = relations(
  notificationDeliveries,
  ({ one, many }) => ({
    user: one(users, { fields: [notificationDeliveries.userId], references: [users.id] }),
    profile: one(alertProfiles, {
      fields: [notificationDeliveries.alertProfileId],
      references: [alertProfiles.id],
    }),
    items: many(notificationDeliveryItems),
  }),
);

export const notificationDeliveryItemsRelations = relations(
  notificationDeliveryItems,
  ({ one }) => ({
    delivery: one(notificationDeliveries, {
      fields: [notificationDeliveryItems.deliveryId],
      references: [notificationDeliveries.id],
    }),
    tender: one(tenders, {
      fields: [notificationDeliveryItems.tenderId],
      references: [tenders.id],
    }),
  }),
);

export type NotificationPreferencesRow = typeof notificationPreferences.$inferSelect;
export type NotificationDeliveryRow = typeof notificationDeliveries.$inferSelect;
export type NewNotificationDeliveryRow = typeof notificationDeliveries.$inferInsert;
export type NotificationDeliveryItemRow = typeof notificationDeliveryItems.$inferSelect;
export type EmailEventRow = typeof emailEvents.$inferSelect;
export type EmailSuppressionRow = typeof emailSuppressions.$inferSelect;
