import { lt } from 'drizzle-orm';
import type { Database } from '@luma/db';
import { pendingSignups } from '@luma/db';
import type { Logger } from '@luma/observability';

/**
 * Removing expired pending signups (IDE Agent Spec v3, section 3.1).
 *
 * Mirrors `share.cleanup` in shape, and for a stronger reason than symmetry.
 * An unconsumed `pending_signups` row is an email address somebody typed into a
 * public form and then walked away from. Its lawful basis is completing the
 * signup they asked for, and that basis expires exactly when the token does —
 * after which the row is personal data the controller has no reason to hold
 * and, under spec section 40's data minimisation, no right to.
 *
 * A hard delete, like the share links, and the same argument applies with more
 * force: keeping the row keeps a live confirmation token in the database with
 * nothing but an `expires_at` check between it and a reader.
 *
 * **Consumed rows are deleted too, and this is where it departs from
 * `share.cleanup`.** There, a revoked-but-unexpired link is deliberately kept,
 * because the row is the evidence the user revoked it and they can see it on
 * their sharing page. Here the equivalent evidence is better held elsewhere:
 * once a signup is consumed, the account, the acceptance and the profile all
 * exist as first-class records, and the pending row is a stale copy of the
 * draft criteria carrying a dead token and an address that is now in `users`.
 * Deleting it removes a duplicate, not a fact. The row is only removed after
 * it expires, so a confirmation is never raced by the sweeper.
 */

export interface SignupCleanupReport {
  readonly deleted: number;
}

export async function runSignupCleanup(options: {
  db: Database;
  logger: Logger;
  now: Date;
}): Promise<SignupCleanupReport> {
  const { db, logger, now } = options;

  const deleted = await db
    .delete(pendingSignups)
    .where(lt(pendingSignups.expiresAt, now))
    .returning({ id: pendingSignups.id });

  // The count only. A confirmation token must never reach a log in cleartext
  // (spec section 40), and neither must the email address it was issued for —
  // which is the whole reason this job exists.
  logger.info({ deleted: deleted.length }, 'expired pending signups removed');
  return { deleted: deleted.length };
}
