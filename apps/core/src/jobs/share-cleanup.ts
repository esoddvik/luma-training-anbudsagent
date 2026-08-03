import { lt } from 'drizzle-orm';
import type { Database } from '@luma/db';
import { tenderShares } from '@luma/db';
import type { Logger } from '@luma/observability';

/**
 * Removing expired share links (spec §17, §38 `share.cleanup`).
 *
 * A hard delete, which the schema comment on `tender_shares` already commits
 * to and which is the right call: an expired link is meant to stop working,
 * and keeping the row keeps a live token sitting in the database with nothing
 * but an `expires_at` check between it and a reader.
 *
 * Revoked-but-unexpired links are deliberately left alone. Revocation is a
 * user action they can see on `/anbudsvarsling/delinger`, and deleting the row
 * would erase the evidence that they revoked it. It expires on schedule like
 * everything else, and the public route already returns 410 for it.
 */

export interface ShareCleanupReport {
  readonly deleted: number;
}

export async function runShareCleanup(options: {
  db: Database;
  logger: Logger;
  now: Date;
}): Promise<ShareCleanupReport> {
  const { db, logger, now } = options;

  const deleted = await db
    .delete(tenderShares)
    .where(lt(tenderShares.expiresAt, now))
    .returning({ id: tenderShares.id });

  // The count only. A share token must never reach a log in cleartext
  // (spec §40), and neither must the id of the tender it pointed at.
  logger.info({ deleted: deleted.length }, 'expired share links removed');
  return { deleted: deleted.length };
}
