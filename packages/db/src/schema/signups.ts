import { index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from './columns.js';

/**
 * The search-first entry door (IDE Agent Spec v3, section 3.1).
 *
 * The original journey was register-first: type an address, get an account,
 * then discover whether the service has anything for you. Search-first inverts
 * it. An anonymous visitor picks a service template, sees real notices, and
 * only then leaves an address. By that point they have already built a profile,
 * so the address and the criteria arrive together and there is nowhere to put
 * them — the criteria belong to a user who does not exist yet, and must not
 * exist yet, because nobody has confirmed the address or accepted the terms.
 *
 * This table is that gap. It holds the whole intent — address, draft criteria,
 * which template they came from, where they were heading — from the moment the
 * form is submitted until the link in the email is clicked, and not one moment
 * longer than `expires_at`.
 *
 * ## Why there is no foreign key to `users`
 *
 * The same reason `magic_link_tokens` has none, and it is the load-bearing
 * property of the whole table. A row is written for *every* submission, known
 * address or not. If the row only existed for unknown addresses, "did an insert
 * happen" would answer "does this address have an account", and the timing
 * difference alone would leak it. The address is a plain column; resolving it
 * to a user happens at consumption, inside the transaction.
 *
 * ## Why the draft profile is `jsonb` and not the real criterion tables
 *
 * A draft is not a profile. Writing it into `alert_profiles` early would create
 * a profile row owned by nobody, visible to the matcher, which is exactly the
 * kind of half-real record the profile tables are shaped to make impossible. It
 * is validated against `alertProfileSchema` at consumption, not at write, so a
 * schema change cannot strand rows that were valid when they were created —
 * they fail on the way out, one at a time, where the failure can be handled.
 *
 * ## Deletion policy: hard delete, on a schedule
 *
 * An unconsumed row is an email address somebody typed and then abandoned. It
 * is personal data whose lawful basis — completing the signup they asked for —
 * expires with the token. `signup.cleanup` removes them (spec section 38's
 * cleanup family, mirroring `share.cleanup`). Consumed rows go the same way:
 * once the profile exists, the draft is a duplicate of live data.
 */
export const pendingSignups = pgTable(
  'pending_signups',
  {
    id: primaryId(),
    /**
     * Lowercased by the application, exactly like `users.email`. Deliberately
     * not unique: a person may submit twice, and the second attempt must not
     * fail in a way that is observably different from the first.
     */
    email: text('email').notNull(),
    /**
     * SHA-256 of the token in the confirmation link, peppered with
     * `AUTH_SECRET`. The token itself exists in the sent email and nowhere
     * else (spec section 47), same rule as magic links and sessions.
     */
    tokenHash: text('token_hash').notNull(),
    /**
     * The criteria the anonymous visitor assembled, in the `AlertProfile`
     * shape minus the fields only a real profile has (`id`, `userId`,
     * timestamps). Validated on consumption.
     */
    draftProfile: jsonb('draft_profile').notNull(),
    /**
     * Which service template the visitor entered through, as a slug rather
     * than an id: the funnel events carry the slug (IDE Agent Spec v3 section
     * 3.2), and a retired template must not break the attribution chain for a
     * signup that already happened.
     */
    serviceTemplateSlug: text('service_template_slug'),
    /**
     * The `retur` slug, carried from the search surface through the email so
     * the confirmed user lands where they were heading rather than on a
     * generic dashboard. Sanitised on the way in *and* on the way out.
     */
    returnPath: text('return_path'),
    requestedAt: timestamptz('requested_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    /** Single-use marker, claimed by a conditional update like magic links. */
    consumedAt: timestamptz('consumed_at'),
    /** Hashed, never raw (spec section 40 data minimisation). */
    requestIpHash: text('request_ip_hash'),
    userAgent: text('user_agent'),
  },
  (table) => [
    uniqueIndex('pending_signups_token_hash_key').on(table.tokenHash),
    // Per-address rate limiting reads recent submissions for one email.
    index('pending_signups_email_requested_at_idx').on(table.email, table.requestedAt),
    // The cleanup sweep.
    index('pending_signups_expires_at_idx').on(table.expiresAt),
  ],
);

export type PendingSignupRow = typeof pendingSignups.$inferSelect;
export type NewPendingSignupRow = typeof pendingSignups.$inferInsert;
