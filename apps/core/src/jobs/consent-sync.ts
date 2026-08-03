import { and, eq, isNotNull } from 'drizzle-orm';
import type { Database } from '@luma/db';
import { consentEvents, emailSuppressions, users } from '@luma/db';
import { latestConsentEvent, type ConsentEvent } from '@luma/domain';
import type { EmailClient } from '@luma/email';
import type { Logger } from '@luma/observability';

/**
 * Reconciling marketing-consent withdrawals with Postmark suppression
 * (spec §21, §27, §38 `consent.sync`).
 *
 * One tick does three things per withdrawal:
 *
 * 1. Derives current marketing consent from the append-only log (ADR-0009).
 * 2. Records an `email_suppressions` row on the marketing stream. §27 requires
 *    respecting suppression but defines no schema; the table itself is
 *    `packages/db`'s, and it is the one admin reads.
 * 3. Pushes the suppression to Postmark with `suppressAddress`.
 *
 * **Marketing stream only, and that is not a detail.** A global suppression
 * would also stop magic links and order confirmations, so unsubscribing from a
 * newsletter would present to the user as losing access to their account.
 * Spec §27 forbids it and `packages/email` has tests asserting a marketing
 * suppression leaves the transactional and tender-notification streams alone.
 * Nothing here may widen the stream argument.
 *
 * **The push is required, not merely prudent.** §21 states it outright:
 * «Tilbaketrekking skal påvirke Postmark» — a withdrawal shall affect
 * Postmark. This comment previously argued the case on engineering grounds
 * alone, which understated it: someone weighing the cost of the extra API call
 * could reasonably have dropped it, not knowing a requirement was behind it.
 *
 * The engineering reasons still hold and are worth keeping, because they say
 * *why* the requirement is not redundant. This system cannot mail a withdrawn
 * user regardless: a marketing send needs a `MarketingConsentProof`, only
 * `verifyMarketingConsent` mints one, and it mints one only from a log whose
 * latest marketing event is active. So the push earns its place on the two
 * cases that guard cannot reach — a campaign sent from Postmark's own
 * interface, and being able to show a regulator that the withdrawal reached
 * the processor rather than living only in our database.
 *
 * §21 also fixes the two rules this job must not break, in the same list:
 * «Tilbaketrekking skal ikke deaktivere anbudsvarsling» and «Avmelding fra
 * anbudsvarsler skal ikke automatisk fjerne markedsføringssamtykke». Both are
 * why the stream below is a constant.
 *
 * **Re-asserted every tick, deliberately.** Postmark treats a repeat
 * suppression as a no-op, so there is no read-before-write and no "have I done
 * this already" flag to fall out of step with reality. The `postmarkMissing`
 * counter is read *before* the push, which is what makes it a reconciliation
 * signal rather than a tautology: it counts withdrawals Postmark did not have
 * suppressed when this run looked — drift this job did not cause, and has now
 * corrected.
 *
 * **A transport failure fails the job.** It is not caught here. The handler in
 * `queue/register.ts` rethrows, pg-boss retries with backoff, and an exhausted
 * job lands in the dead-letter queue where an operator can see it. A consent
 * withdrawal that silently failed to propagate while the run reported success
 * is precisely the failure this job exists to prevent.
 */

/** Postmark's stream id for marketing; the database enum spells it with an underscore. */
const MARKETING_STREAM = 'luma-marketing' as const;
const MARKETING_STREAM_COLUMN = 'luma_marketing' as const;

export interface ConsentSyncReport {
  /** Users whose latest marketing consent event is a withdrawal. */
  readonly withdrawalsConsidered: number;
  /** Local suppression rows created by this run. */
  readonly suppressionsRecorded: number;
  readonly alreadyRecorded: number;
  /** Suppressions asserted against Postmark. One per withdrawal, every tick. */
  readonly pushedToPostmark: number;
  /**
   * How many withdrawals this run sampled for drift.
   *
   * A sample, not a census: the read is capped by `maxPostmarkChecks` so the
   * run stays bounded as the withdrawal list grows. The push below is not
   * capped — every withdrawal is asserted.
   */
  readonly postmarkChecked: number;
  /** Of those checked, how many Postmark did not already have suppressed. */
  readonly postmarkMissing: number;
  readonly postmarkCheckFailed: number;
}

interface WithdrawnUser {
  readonly userId: string;
  readonly email: string;
  readonly withdrawnAt: Date;
}

/**
 * Users whose latest `marketing_email` event is a withdrawal.
 *
 * The decision runs through `latestConsentEvent` rather than a `SELECT ...
 * ORDER BY occurred_at DESC LIMIT 1`, because the domain function also applies
 * the `createdAt` tie-break for two events recorded at the same instant, and a
 * second implementation of that rule would eventually disagree with the first.
 *
 * Only `withdrawn` counts. `superseded` means the wording changed underneath a
 * still-willing user and is a re-consent prompt, not an unsubscribe; treating
 * it as one would suppress people who never asked to be.
 */
async function loadWithdrawnUsers(db: Database): Promise<WithdrawnUser[]> {
  const rows = await db
    .select({
      id: consentEvents.id,
      userId: consentEvents.userId,
      email: users.email,
      consentType: consentEvents.consentType,
      status: consentEvents.status,
      source: consentEvents.source,
      consentTextVersion: consentEvents.consentTextVersion,
      occurredAt: consentEvents.occurredAt,
      createdAt: consentEvents.createdAt,
    })
    .from(consentEvents)
    .innerJoin(users, eq(users.id, consentEvents.userId))
    .where(
      and(
        eq(consentEvents.consentType, 'marketing_email'),
        // A severed reference is a deleted account. There is no address left
        // to suppress and no user to reconcile.
        isNotNull(consentEvents.userId),
      ),
    );

  const byUser = new Map<string, { email: string; events: ConsentEvent[] }>();
  for (const row of rows) {
    if (!row.userId) continue;
    const entry = byUser.get(row.userId) ?? { email: row.email, events: [] };
    entry.events.push({
      id: row.id,
      userId: row.userId,
      consentType: row.consentType,
      status: row.status,
      source: row.source,
      consentTextVersion: row.consentTextVersion,
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
    });
    byUser.set(row.userId, entry);
  }

  const withdrawn: WithdrawnUser[] = [];
  for (const [userId, entry] of byUser) {
    const latest = latestConsentEvent(entry.events, 'marketing_email');
    if (latest?.status === 'withdrawn') {
      withdrawn.push({ userId, email: entry.email, withdrawnAt: latest.occurredAt });
    }
  }
  return withdrawn;
}

export interface ConsentSyncOptions {
  readonly db: Database;
  readonly emailClient: EmailClient;
  readonly logger: Logger;
  readonly now: Date;
  /**
   * Caps the *drift read*, which is diagnostic and therefore samplable. The
   * suppression push is never capped: skipping it would mean a withdrawal that
   * quietly never reached the processor.
   */
  readonly maxPostmarkChecks?: number;
}

const DEFAULT_MAX_POSTMARK_CHECKS = 100;

export async function runConsentSync(options: ConsentSyncOptions): Promise<ConsentSyncReport> {
  const { db, logger, now } = options;
  const maxChecks = options.maxPostmarkChecks ?? DEFAULT_MAX_POSTMARK_CHECKS;

  const withdrawn = await loadWithdrawnUsers(db);

  let suppressionsRecorded = 0;
  let alreadyRecorded = 0;
  let pushedToPostmark = 0;
  let postmarkChecked = 0;
  let postmarkMissing = 0;
  let postmarkCheckFailed = 0;

  for (const user of withdrawn) {
    const inserted = await db
      .insert(emailSuppressions)
      .values({
        email: user.email,
        messageStream: MARKETING_STREAM_COLUMN,
        reason: 'unsubscribe',
        suppressedAt: user.withdrawnAt,
        detail: 'marketing consent withdrawn (consent.sync)',
      })
      // The unique index on (email, stream) is the idempotency key: this job
      // is safe to run twice, which at-least-once delivery guarantees it will
      // be. A conflict means the withdrawal was already recorded.
      .onConflictDoNothing({
        target: [emailSuppressions.email, emailSuppressions.messageStream],
      })
      .returning({ id: emailSuppressions.id });

    if (inserted.length === 0) {
      alreadyRecorded += 1;
    } else {
      suppressionsRecorded += 1;
    }

    // Read before writing, and only up to the cap. This is the only moment
    // drift is observable: after the push below, the answer is always yes.
    if (postmarkChecked < maxChecks) {
      postmarkChecked += 1;
      try {
        const suppressed = await options.emailClient.isSuppressed(user.email, MARKETING_STREAM);
        if (!suppressed) postmarkMissing += 1;
      } catch (error) {
        // Diagnostic only. A failed *read* must not stop the push that follows
        // — and if Postmark is genuinely down, the push throws a line later
        // and fails the job properly.
        postmarkCheckFailed += 1;
        logger.warn({ err: error }, 'could not read Postmark suppression state');
      }
    }

    // Not wrapped in try/catch, on purpose. A withdrawal that failed to reach
    // the processor while the run reported success is the exact failure this
    // job exists to prevent, so it propagates and fails the job.
    //
    // `MARKETING_STREAM` is a constant, never a parameter: spec §27 requires
    // that unsubscribing from marketing leaves account-critical mail working.
    await options.emailClient.suppressAddress(user.email, MARKETING_STREAM);
    pushedToPostmark += 1;
  }

  if (postmarkMissing > 0) {
    // Deliberately loud, and deliberately without addresses (spec §40).
    logger.warn(
      { postmarkMissing, postmarkChecked, stream: MARKETING_STREAM },
      'withdrawals found unsuppressed in Postmark and re-asserted; ' +
        'drift this job did not cause, now corrected',
    );
  }

  const report: ConsentSyncReport = {
    withdrawalsConsidered: withdrawn.length,
    suppressionsRecorded,
    alreadyRecorded,
    pushedToPostmark,
    postmarkChecked,
    postmarkMissing,
    postmarkCheckFailed,
  };

  logger.info({ ...report, at: now.toISOString() }, 'consent sync complete');
  return report;
}
