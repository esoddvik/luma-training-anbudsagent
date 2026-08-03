import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { JsonValue } from '@luma/domain';
import { users } from './auth.js';
import { primaryId, timestamptz } from './columns.js';

/**
 * The administrative audit trail (spec sections 21, 28.2 and 40).
 *
 * Every privileged action lands here: order status changes, consent recorded
 * on a user's behalf, a suppressed tender, a revoked MCP token or share link,
 * an edited industry template. Spec section 28.2 step 6 and ADR-9 rule 4 both
 * name this table specifically.
 *
 * **Insert only, by convention rather than by trigger.** `consent_events` gets
 * a database-level guard because it is legal evidence about the *user*, and
 * because ADR-9 asks for one. This table is Luma's own operational record;
 * locking it against `UPDATE` would also block a retention sweep, and the
 * threat model differs — an attacker able to rewrite this table already has
 * the credentials that make the rest of the schema moot.
 *
 * **Deletion policy: retain, sever the admin reference.** An audit entry that
 * disappears when the administrator's account is deleted is not an audit
 * entry.
 */
export const adminAuditEvents = pgTable(
  'admin_audit_events',
  {
    id: primaryId(),
    adminUserId: uuid('admin_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Stable verb, e.g. `order_request.activate`, `tender.suppress`. */
    action: text('action').notNull(),
    /** Table or aggregate the action touched, e.g. `order_requests`. */
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    /**
     * State before and after, for the diff view.
     *
     * These must be redacted by the caller: no tokens, no magic links, no raw
     * email in a context where `@luma/observability`'s `scrubSecrets` would
     * have removed it (spec section 40). A JSON blob is exactly where such a
     * value hides from a later audit.
     */
    beforeState: jsonb('before_state').$type<JsonValue>(),
    afterState: jsonb('after_state').$type<JsonValue>(),
    /** Free text. Required by ADR-9 rule 4 for admin-recorded consent. */
    reason: text('reason'),
    ipAddressHash: text('ip_address_hash'),
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('admin_audit_events_occurred_idx').on(table.occurredAt.desc()),
    // "What happened to this order?" — the entity timeline.
    index('admin_audit_events_entity_idx').on(
      table.entityType,
      table.entityId,
      table.occurredAt.desc(),
    ),
    index('admin_audit_events_admin_occurred_idx').on(table.adminUserId, table.occurredAt.desc()),
    index('admin_audit_events_action_idx').on(table.action),
  ],
);

export type AdminAuditEventRow = typeof adminAuditEvents.$inferSelect;
export type NewAdminAuditEventRow = typeof adminAuditEvents.$inferInsert;
