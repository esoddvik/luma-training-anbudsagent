import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { orderRequests } from './orders.js';
import { createdAt, primaryId, timestamptz } from './columns.js';

/**
 * Paid access, without a billing system (IDE Agent Spec v3, section 4.2).
 *
 * Anbudsvarsling Pluss is sold on a manual invoice: the customer submits an
 * `order_requests` row, an administrator raises the invoice by hand, and when
 * it is paid they grant the entitlement here. That is ADR-0010's decision —
 * no Stripe dependency until order volume proves the need — carried forward
 * rather than quietly revisited because a second paid product appeared.
 *
 * **There is no price in this table and none anywhere in the code.** Spec v3
 * section 4.2 says the implementation hardcodes no price; the figure lives on
 * the invoice the administrator raises, which is also the only place that can
 * be right about VAT, discounts and the year it was agreed.
 *
 * ## Why an entitlement is a row and not a boolean on `users`
 *
 * Three reasons, in order of how much they would hurt:
 *
 * 1. A boolean cannot expire. This is an annual product with a renewal, and a
 *    flag with no `expires_at` becomes permanent access nobody decided to
 *    grant — discovered a year later, if at all.
 * 2. A boolean cannot say *who* granted it or *which* order paid for it, and
 *    that is the whole audit trail for a manual billing flow.
 * 3. A boolean is one product. Spec v3 section 4.2 already anticipates a
 *    course purchase granting access through the same mechanism, and Påfyll is
 *    a separate stream that must never be conflated with this one — a shared
 *    boolean is exactly how "customer of one thing" silently becomes
 *    "customer of the other".
 *
 * ## Deletion policy
 *
 * `user_id` cascades: an entitlement is the person's own access and has no
 * meaning without them. `order_request_id` severs, because the order row
 * itself severs rather than cascading — it is an accounting record Luma keeps.
 */
export const userEntitlements = pgTable(
  'user_entitlements',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      // cascade: access is personal and worthless without the account.
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Machine key for the product, e.g. `pluss`.
     *
     * Plain text rather than an enum: spec v3 section 4.1 gives Pluss its own
     * product code and anticipates more, and an enum would make adding a
     * product a migration. What needs protecting is the stability of existing
     * codes, which a test pins rather than the column type.
     */
    productCode: text('product_code').notNull(),
    grantedAt: timestamptz('granted_at').notNull().defaultNow(),
    /**
     * Null means no expiry.
     *
     * Used rather than forbidden: a course purchase that grants permanent
     * access is a real case. The renewal report reads `expires_at IS NOT NULL
     * AND expires_at < now() + 60 days`, so a null simply never appears in it.
     */
    expiresAt: timestamptz('expires_at'),
    /**
     * Which administrator granted it. Severs on their account deletion; the
     * grant itself is evidence Luma keeps.
     */
    grantedByAdminId: uuid('granted_by_admin_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** The order this was granted against, when there was one. */
    orderRequestId: uuid('order_request_id').references(() => orderRequests.id, {
      onDelete: 'set null',
    }),
    /** Set when access is withdrawn early — a refund, a chargeback, a mistake. */
    revokedAt: timestamptz('revoked_at'),
    /** Why it was revoked. Norwegian, read by an administrator. */
    revokedReason: text('revoked_reason'),
    createdAt: createdAt(),
  },
  (table) => [
    // One live grant per product per user. A second row for the same product
    // is a renewal, which extends `expires_at` rather than stacking — two
    // overlapping grants make "when does this lapse" unanswerable.
    uniqueIndex('user_entitlements_user_product_key').on(table.userId, table.productCode),
    // The renewal report: what lapses in the next sixty days.
    index('user_entitlements_expires_idx').on(table.expiresAt),
    index('user_entitlements_product_idx').on(table.productCode),
  ],
);

export type UserEntitlementRow = typeof userEntitlements.$inferSelect;
export type NewUserEntitlementRow = typeof userEntitlements.$inferInsert;
