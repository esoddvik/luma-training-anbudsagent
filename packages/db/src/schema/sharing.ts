import { relations, sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { createdAt, primaryId, timestamptz } from './columns.js';
import { tenders } from './tenders.js';

/**
 * Share links (spec section 17, ADR-15).
 *
 * The shared view is public and unauthenticated, which makes this the table
 * where a privacy mistake would be most visible. The row records who created
 * the share so the user can manage and revoke their own links — and that
 * column must never reach the public projection. `FORBIDDEN_SHARE_FIELDS` in
 * `@luma/domain` names it explicitly, and the shared view is built from
 * `SharedTenderView` rather than from a filtered row, so widening this table
 * cannot widen the public page.
 *
 * **Hard delete.** The `share.cleanup` job (spec section 38) removes rows past
 * `expires_at`. There is nothing to recover: an expired link is meant to stop
 * working, and keeping the row would keep a live token hanging around.
 */
export const tenderShares = pgTable(
  'tender_shares',
  {
    id: primaryId(),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      // cascade: the link is the user's, and leaving live share URLs behind
      // after an account deletion would keep serving on a deleted person's
      // behalf. Attribution keeps its own nullable reference for reporting.
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Cryptographically random, generated with `crypto.randomBytes`.
     *
     * Spec section 40: the token must not contain a user id or a tender id in
     * cleartext, and must not be derived from either. A derived token would be
     * guessable from data the recipient already has, and the shared view is
     * exactly the surface an attacker would enumerate. The length check below
     * is a floor against a future caller shortening it "for nicer URLs".
     */
    token: text('token').notNull(),
    /** Default 30 days, from `SHARE_DEFAULT_TTL_DAYS`. */
    expiresAt: timestamptz('expires_at').notNull(),
    /** Set by the user from /anbudsvarsling/delinger. Yields 410, not 404. */
    revokedAt: timestamptz('revoked_at'),
    /**
     * Approximate: bots, link previewers and email scanners inflate it
     * (ADR-15). Reported as directional, never as a conversion denominator
     * anyone should trust to two decimal places.
     */
    viewCount: integer('view_count').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    // Spec section 37: unique, non-guessable share token. The lookup on the
    // public page is by this index and nothing else.
    uniqueIndex('tender_shares_token_key').on(table.token),
    // The user's own /delinger page.
    index('tender_shares_created_by_idx').on(table.createdByUserId, table.createdAt.desc()),
    // The share.cleanup sweeper.
    index('tender_shares_expires_at_idx').on(table.expiresAt),
    index('tender_shares_tender_id_idx').on(table.tenderId),
    check('tender_shares_token_length', sql`length(${table.token}) >= 32`),
  ],
);

export const tenderSharesRelations = relations(tenderShares, ({ one }) => ({
  tender: one(tenders, { fields: [tenderShares.tenderId], references: [tenders.id] }),
  createdBy: one(users, { fields: [tenderShares.createdByUserId], references: [users.id] }),
}));

export type TenderShareRow = typeof tenderShares.$inferSelect;
export type NewTenderShareRow = typeof tenderShares.$inferInsert;
