import { relations, sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { createdAt, primaryId, timestamptz } from './columns.js';
import { mcpOutcomeEnum, mcpScopeEnum } from './enums.js';

/**
 * MCP tokens and the MCP audit trail (spec sections 30 and 40, ADR-3).
 */

/**
 * A personal access token for the MCP server.
 *
 * Spec section 30: the full token is displayed once and only its hash is
 * stored. The hash is peppered with `MCP_TOKEN_PEPPER` before it lands here,
 * so a database dump alone does not let an attacker verify a guessed token
 * offline against a plain SHA-256.
 *
 * **Hard delete is allowed but revocation is preferred.** A revoked token that
 * stays in the table is what lets the user see that the token they killed is
 * in fact dead, and lets audit rows keep pointing at something meaningful.
 */
export const mcpTokens = pgTable(
  'mcp_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      // cascade: a token is a credential for one person. Leaving it behind
      // after account deletion would leave a working key to nothing.
      .references(() => users.id, { onDelete: 'cascade' }),
    /** User-chosen label, e.g. "Claude Desktop, laptop". */
    name: text('name').notNull(),
    /**
     * The leading characters of the token, shown in the UI so a user can tell
     * two tokens apart. Short enough to be useless on its own.
     */
    prefix: text('prefix').notNull(),
    /** Peppered hash. The plaintext exists only in the response that created it. */
    tokenHash: text('token_hash').notNull(),
    scopes: mcpScopeEnum('scopes').array().notNull().default([]),
    /** Null means no expiry; the UI nudges towards setting one. */
    expiresAt: timestamptz('expires_at'),
    lastUsedAt: timestamptz('last_used_at'),
    revokedAt: timestamptz('revoked_at'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('mcp_tokens_token_hash_key').on(table.tokenHash),
    index('mcp_tokens_user_id_idx').on(table.userId),
    index('mcp_tokens_prefix_idx').on(table.prefix),
    // A token with no scopes can do nothing and is almost certainly a bug in
    // the creation path rather than a deliberate choice.
    //
    // `cardinality`, not `array_length`: `array_length('{}', 1)` is NULL, not
    // 0, and a CHECK that evaluates to NULL *passes*. The first version of
    // this constraint was written that way and accepted every scopeless token
    // it was supposed to reject — which is why the integration test inserts
    // one rather than trusting the expression to read correctly.
    check('mcp_tokens_scopes_not_empty', sql`cardinality(${table.scopes}) >= 1`),
  ],
);

/**
 * Every MCP call, for the audit log spec section 40 requires.
 *
 * **The token never appears here.** Not the plaintext, not the hash — only the
 * token's id. Spec section 30 says the token must never be logged, and an
 * audit table is a log.
 */
export const mcpAuditEvents = pgTable(
  'mcp_audit_events',
  {
    id: primaryId(),
    tokenId: uuid('token_id').references(() => mcpTokens.id, {
      // set null: revoking and deleting a token must not erase the record of
      // what it did while it was alive.
      onDelete: 'set null',
    }),
    userId: uuid('user_id').references(() => users.id, {
      // cascade: MCP activity is the person's own usage history and has no
      // retention obligation once the account is deleted.
      onDelete: 'cascade',
    }),
    /** Tool name, e.g. `search_tenders`. */
    tool: text('tool'),
    /** Resource URI when the call read a resource rather than ran a tool. */
    resource: text('resource'),
    /** The scope that was checked on this call (spec section 40). */
    scopeChecked: text('scope_checked'),
    outcome: mcpOutcomeEnum('outcome').notNull(),
    errorCode: text('error_code'),
    durationMs: integer('duration_ms'),
    /** Hashed, never raw. */
    ipAddressHash: text('ip_address_hash'),
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('mcp_audit_events_user_occurred_idx').on(table.userId, table.occurredAt.desc()),
    index('mcp_audit_events_token_occurred_idx').on(table.tokenId, table.occurredAt.desc()),
    index('mcp_audit_events_occurred_idx').on(table.occurredAt.desc()),
  ],
);

export const mcpTokensRelations = relations(mcpTokens, ({ one, many }) => ({
  user: one(users, { fields: [mcpTokens.userId], references: [users.id] }),
  auditEvents: many(mcpAuditEvents),
}));

export const mcpAuditEventsRelations = relations(mcpAuditEvents, ({ one }) => ({
  token: one(mcpTokens, { fields: [mcpAuditEvents.tokenId], references: [mcpTokens.id] }),
  user: one(users, { fields: [mcpAuditEvents.userId], references: [users.id] }),
}));

export type McpTokenRow = typeof mcpTokens.$inferSelect;
export type NewMcpTokenRow = typeof mcpTokens.$inferInsert;
export type McpAuditEventRow = typeof mcpAuditEvents.$inferSelect;
