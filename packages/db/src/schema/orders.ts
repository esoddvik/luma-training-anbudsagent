import { relations, sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { createdAt, primaryId, timestamptz, updatedAt } from './columns.js';
import { orderStatusEnum } from './enums.js';

/**
 * Order requests (spec section 28.2, ADR-10).
 *
 * The MVP has no order or subscription engine. A row here is a structured
 * enquiry; the invoice is produced in Luma's existing process outside this
 * system. Phase 7 adds `orders`, `subscriptions`, `invoice_records` and
 * `billing_audit_events` alongside this table rather than replacing it.
 *
 * Status transitions are validated by `canTransitionOrder()` in
 * `@luma/domain` and every change is written to `admin_audit_events`
 * (spec section 28.2 step 6), which is what makes the flow auditable.
 */
export const orderRequests = pgTable(
  'order_requests',
  {
    id: primaryId(),
    /**
     * Nullable, and severed rather than cascaded on account deletion.
     *
     * An order request is the basis for an invoice Luma has already issued.
     * Norwegian bookkeeping rules require that documentation to be retained
     * for years, and "the customer closed their account" is not an exception
     * to it. Severing the reference keeps the accounting record while removing
     * the link to the person; the billing details below are company details,
     * which is what an invoice is addressed to anyway.
     */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

    /** Stable product key, for example `paafyll` or `heldagskurs`. */
    productCode: text('product_code').notNull(),
    /** Captured at order time so a later rename does not rewrite history. */
    productName: text('product_name').notNull(),

    billingCompanyName: text('billing_company_name').notNull(),
    organizationNumber: varchar('organization_number', { length: 9 }),
    billingAddress: text('billing_address').notNull(),
    billingPostalCode: text('billing_postal_code').notNull(),
    billingCity: text('billing_city').notNull(),
    billingCountry: text('billing_country').notNull().default('Norge'),
    invoiceEmail: text('invoice_email').notNull(),
    contactPerson: text('contact_person').notNull(),
    customerReference: text('customer_reference'),
    purchaseOrderNumber: text('purchase_order_number'),

    status: orderStatusEnum('status').notNull().default('received'),
    adminNote: text('admin_note'),
    handledByAdminId: uuid('handled_by_admin_id').references(() => users.id, {
      // set null: an admin leaving must not erase who handled what. The name
      // is recoverable from admin_audit_events.
      onDelete: 'set null',
    }),
    /** Set when the status reaches `activated` (spec section 28.2 step 4). */
    activatedAt: timestamptz('activated_at'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // The admin queue: oldest unhandled first.
    index('order_requests_status_created_idx').on(table.status, table.createdAt.desc()),
    index('order_requests_user_id_idx').on(table.userId),
    index('order_requests_product_code_idx').on(table.productCode),
    check(
      'order_requests_organization_number_format',
      sql`${table.organizationNumber} IS NULL OR ${table.organizationNumber} ~ '^[0-9]{9}$'`,
    ),
  ],
);

export const orderRequestsRelations = relations(orderRequests, ({ one }) => ({
  user: one(users, { fields: [orderRequests.userId], references: [users.id] }),
}));

export type OrderRequestRow = typeof orderRequests.$inferSelect;
export type NewOrderRequestRow = typeof orderRequests.$inferInsert;
