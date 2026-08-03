import { relations } from 'drizzle-orm';
import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { companyRoleEnum, userRoleEnum } from './enums.js';
import { createdAt, primaryId, timestamptz, updatedAt } from './columns.js';

/**
 * Accounts, sessions and magic links (spec section 10, ADR-16).
 *
 * We are not using Auth.js, so the spec's `accounts` and `verification_tokens`
 * tables have no counterpart here. What ADR-16 needs instead is `users`,
 * opaque database-backed `sessions`, and single-use `magic_link_tokens`.
 *
 * **No token is stored in cleartext anywhere in this file.** Sessions and
 * magic links both persist only a SHA-256 digest. That is not defence in
 * depth for its own sake: a database dump, a leaked backup or an over-broad
 * admin query would otherwise hand out live sessions.
 *
 * **Deletion policy for `users`: hard delete.** Spec section 40 requires
 * account deletion and section 52 item 14 makes it an acceptance criterion.
 * A soft-deleted user row is still personal data, so a `deleted_at` column
 * would be a privacy problem wearing the costume of a feature. Everything that
 * hangs off a user therefore declares an explicit `onDelete`, and the choice is
 * commented at each foreign key. The three shapes in use:
 *
 * - `cascade` — the row is the person's own activity and has no life without
 *   them (profiles, sessions, saved tenders, shares).
 * - `set null` — the row is evidence the controller must keep, or an aggregate
 *   Luma reports on, and severing the reference is what anonymises it
 *   (consent, legal acceptances, attribution, order requests, audit).
 * - `restrict` — nothing uses it; a restricted reference would make account
 *   deletion fail, which is the one outcome section 40 does not allow.
 */

export const users = pgTable(
  'users',
  {
    id: primaryId(),
    /**
     * Stored lowercased by the application. The unique index is on the stored
     * value, so the caller normalising is part of the contract; `citext` would
     * mean an extension in every environment for one column.
     */
    email: text('email').notNull(),
    name: text('name'),
    role: userRoleEnum('role').notNull().default('user'),
    /** Set the first time a magic link for this address is redeemed. */
    emailVerifiedAt: timestamptz('email_verified_at'),
    lastLoginAt: timestamptz('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('users_email_key').on(table.email)],
);

/**
 * Opaque, database-backed sessions (ADR-16). The cookie carries a random
 * value and nothing else: no claims, no user id, nothing to forge.
 *
 * Deleting the user deletes the sessions, and because validation is a live
 * row read rather than a signature check, that revocation is immediate.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      // cascade: a session is worthless without its user, and leaving orphans
      // would leave valid-looking cookies pointing at a deleted account.
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the cookie value. The plaintext never reaches this table. */
    tokenHash: text('token_hash').notNull(),
    /** Bounded absolute lifetime; the rolling refresh moves it forward. */
    expiresAt: timestamptz('expires_at').notNull(),
    lastUsedAt: timestamptz('last_used_at'),
    /** Set by "log out this device"; the cleanup job removes the row later. */
    revokedAt: timestamptz('revoked_at'),
    userAgent: text('user_agent'),
    /** Hashed, never raw: spec section 40 requires data minimisation. */
    ipAddressHash: text('ip_address_hash'),
    createdAt: createdAt(),
  },
  (table) => [
    // Every authenticated request looks a session up by this value, so it is
    // the hottest index in the schema.
    uniqueIndex('sessions_token_hash_key').on(table.tokenHash),
    index('sessions_user_id_idx').on(table.userId),
    // "Log out all sessions" and the expiry sweeper.
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

/**
 * Single-use magic links (spec section 10, ADR-16).
 *
 * `email` is a plain column and there is deliberately **no** foreign key to
 * `users`: a login request for an unknown address must behave identically to
 * one for a known address, and a foreign key would turn "row inserted or not"
 * into an account-enumeration oracle.
 */
export const magicLinkTokens = pgTable(
  'magic_link_tokens',
  {
    id: primaryId(),
    email: text('email').notNull(),
    /** Resolved at request time when the address is known. Null otherwise. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the token in the link. Compared with `timingSafeEqual`. */
    tokenHash: text('token_hash').notNull(),
    requestedAt: timestamptz('requested_at').notNull().defaultNow(),
    /** Minutes, not hours (ADR-16). */
    expiresAt: timestamptz('expires_at').notNull(),
    /**
     * The single-use marker. Redemption sets it in the same statement that
     * claims the row, so two concurrent redemptions cannot both succeed.
     */
    consumedAt: timestamptz('consumed_at'),
    requestIpHash: text('request_ip_hash'),
    userAgent: text('user_agent'),
  },
  (table) => [
    uniqueIndex('magic_link_tokens_token_hash_key').on(table.tokenHash),
    // Per-address rate limiting reads the recent requests for one email.
    index('magic_link_tokens_email_requested_at_idx').on(table.email, table.requestedAt),
    index('magic_link_tokens_expires_at_idx').on(table.expiresAt),
  ],
);

/**
 * A buying organisation. Membership exists so a future team view can share
 * profiles; nothing in the MVP requires a user to belong to one.
 *
 * **Soft delete.** A company is shared state, and removing it by accident
 * would take every membership with it. Recovery matters more than erasure
 * here, because the row holds no personal data of its own.
 */
export const companies = pgTable(
  'companies',
  {
    id: primaryId(),
    name: text('name').notNull(),
    /** Norwegian organisation number: nine digits. */
    organizationNumber: text('organization_number'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamptz('deleted_at'),
  },
  (table) => [uniqueIndex('companies_organization_number_key').on(table.organizationNumber)],
);

export const companyMemberships = pgTable(
  'company_memberships',
  {
    id: primaryId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      // cascade: the membership is a fact about the person, not about the
      // company's records, so it goes when the account does.
      .references(() => users.id, { onDelete: 'cascade' }),
    role: companyRoleEnum('role').notNull().default('member'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('company_memberships_company_user_key').on(table.companyId, table.userId),
    index('company_memberships_user_id_idx').on(table.userId),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  memberships: many(companyMemberships),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const companyMembershipsRelations = relations(companyMemberships, ({ one }) => ({
  company: one(companies, {
    fields: [companyMemberships.companyId],
    references: [companies.id],
  }),
  user: one(users, { fields: [companyMemberships.userId], references: [users.id] }),
}));

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type MagicLinkTokenRow = typeof magicLinkTokens.$inferSelect;
export type NewMagicLinkTokenRow = typeof magicLinkTokens.$inferInsert;
export type CompanyRow = typeof companies.$inferSelect;
export type CompanyMembershipRow = typeof companyMemberships.$inferSelect;
