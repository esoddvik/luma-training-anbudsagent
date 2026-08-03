import { z } from 'zod';
import type { Job, PgBoss, Queue, WorkOptions } from 'pg-boss';
import type { Database } from '@luma/db';
import type { TenderSourceAdapter } from '@luma/doffin';
import type { EmailClient } from '@luma/email';
import type { Logger } from '@luma/observability';
import { runConsentSync } from '../jobs/consent-sync.js';
import { loadClaimedDelivery, loadImmediateCandidate } from '../jobs/delivery-reads.js';
import { runDigestScheduler } from '../jobs/digest.js';
import { sendClaimedDigest } from '../jobs/digest-send.js';
import { runImmediateAlerts } from '../jobs/immediate.js';
import { sendClaimedImmediateAlert } from '../jobs/immediate-send.js';
import { runIngest } from '../jobs/ingest.js';
import { runMatching } from '../jobs/match.js';
import { CRON, JOB, type JobName } from '../jobs/names.js';
import { runShareCleanup } from '../jobs/share-cleanup.js';
import { DEAD_LETTER_QUEUE } from './boss.js';

/**
 * Wiring the job functions to the queue (spec §38, ADR-0008).
 *
 * Every function called from here is written and tested elsewhere. This module
 * owns three things and nothing else: which queue calls which function, what
 * one job enqueues next, and what happens when a handler throws.
 *
 * **The chain, and the one place duplicate emails are prevented.**
 *
 * ```
 * doffin.sync ─▶ tender.match ─▶ notification.immediate.prepare ─▶ email.send
 * notification.digest.prepare ───────────────────────────────────▶ email.send
 * ```
 *
 * `runIngest` returns `matchableTenderIds`, which excludes every notice whose
 * payload hash was unchanged. Enqueueing matching for those instead would
 * re-match an identical tender, produce a match row that looks new to the
 * immediate-alert query, and interrupt a user about a tender they were already
 * told about. It is not that the downstream jobs would misbehave — it is that
 * the *only* thing standing between an idempotent re-ingest and a duplicate
 * alert is this filter, plus the delivery claim keys underneath it. The
 * integration test for this exists, and it has been shown to fail when the
 * filter is removed.
 *
 * **At-least-once.** Every handler here can run twice for the same payload,
 * and none of them adds a deduplication mechanism of its own. They do not need
 * one: `upsertTender` is idempotent on the payload hash, `tender_matches` has a
 * unique key, and both delivery preparers claim under a unique idempotency key
 * before anything is sent. A second mechanism layered on top would be a second
 * thing to keep in agreement with the first.
 */

/** Configuration a job needs that is not a database row. */
export interface JobConfig {
  readonly appUrl: string;
  readonly privacyUrl: string;
  readonly termsUrl: string;
  readonly senderName: string;
  readonly senderPostalAddress: string;
  readonly senderContactEmail: string;
  readonly osloRegionCodes: readonly string[];
}

export interface RegisterJobsOptions {
  readonly boss: PgBoss;
  readonly db: Database;
  readonly adapter: TenderSourceAdapter;
  readonly emailClient: EmailClient;
  readonly logger: Logger;
  readonly config: JobConfig;
  /** `false` registers queues and schedules but attaches no handlers. */
  readonly worker?: boolean;
  /** Injectable for tests. */
  readonly now?: () => Date;
}

/**
 * Retry behaviour (spec §38: exponential backoff, retry limit, failed state).
 *
 * `retryBackoff` makes pg-boss compute `retryDelay * 2 ** retryCount` with
 * jitter, so five attempts spread over roughly ten minutes rather than
 * hammering a dependency that is already struggling. When they are exhausted
 * the job's payload is copied to `job.dead-letter`, where admin can see it and
 * `redrive` can put it back.
 */
const RETRY: Omit<Queue, 'name' | 'policy'> = {
  retryLimit: 5,
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 900,
  expireInSeconds: 600,
  deadLetter: DEAD_LETTER_QUEUE,
};

/**
 * Per-queue overrides.
 *
 * `email.send` gets **no retries**, and that is the single most deliberate
 * line in this file. The send is not idempotent past the moment Postmark
 * accepts the message: a process that dies between the accepted send and the
 * `sent` row would, on retry, deliver a second copy of the same digest. Spec
 * §38 says "ingen doble e-poster", and the codebase has already chosen which
 * side of that trade to fall on — `digest.ts` claims before sending precisely
 * so a crash loses one email rather than sending two, and the runbook tells
 * the operator that is intended. Retrying here would quietly reverse it.
 *
 * Ordinary send failures do not need the retry anyway: `sendClaimedDigest`
 * catches them, marks the delivery `failed` with a reason, and returns. The
 * tenders stay unsent and appear in the next digest.
 */
const QUEUE_OPTIONS: Readonly<Record<JobName, Omit<Queue, 'name' | 'policy'>>> = {
  [JOB.doffinSync]: { ...RETRY, retryLimit: 3, expireInSeconds: 1800 },
  [JOB.tenderMatch]: { ...RETRY, expireInSeconds: 1800 },
  [JOB.tenderNormalize]: RETRY,
  [JOB.tenderChangeDetect]: RETRY,
  [JOB.notificationImmediatePrepare]: RETRY,
  [JOB.notificationDigestPrepare]: RETRY,
  [JOB.emailSend]: { ...RETRY, retryLimit: 0 },
  [JOB.postmarkWebhookProcess]: RETRY,
  [JOB.feedbackProcess]: RETRY,
  [JOB.orderRequestNotify]: RETRY,
  [JOB.consentSync]: RETRY,
  [JOB.shareCleanup]: { ...RETRY, retryLimit: 2 },
};

const WORK_OPTIONS: WorkOptions = {
  batchSize: 1,
  pollingIntervalSeconds: 2,
};

/**
 * Cron runs in Norwegian local time.
 *
 * Only `share.cleanup` actually cares — "03:30" should mean 03:30 in Oslo, not
 * 04:30 for half the year. The hourly sync and the quarter-hourly digest tick
 * land identically in any zone, and the digest resolves each user's own
 * timezone inside `runDigestScheduler` regardless.
 */
const SCHEDULE_TZ = 'Europe/Oslo';

const tenderIdsPayload = z.object({ tenderIds: z.array(z.uuid()).min(1) });
const emailSendPayload = z.object({ deliveryId: z.uuid() });
/** Scheduled jobs carry no payload. `null` from cron parses as `{}`. */
const noPayload = z.object({}).loose();

/**
 * Structured counters a handler reports on completion. Never free text, and
 * never a value taken from a payload.
 *
 * `undefined` is admitted because a handler's branches return different keys
 * and TypeScript widens the union with optional members; pino drops undefined
 * fields, so nothing reaches the log line.
 */
type JobOutcome = Record<string, number | boolean | string | undefined>;

/**
 * Wraps a handler with payload validation, logging and error propagation.
 *
 * The log lines carry the queue name, the job id and counters — never the
 * payload and never a rendered message (spec §40, §47). An error is logged and
 * rethrown, because pg-boss decides retry-versus-dead-letter from the throw.
 */
function handler<T>(
  name: JobName,
  logger: Logger,
  schema: z.ZodType<T>,
  run: (data: T) => Promise<JobOutcome | void>,
): (jobs: Job<unknown>[]) => Promise<void> {
  return async (jobs) => {
    for (const job of jobs) {
      const parsed = schema.safeParse(job.data ?? {});
      if (!parsed.success) {
        // A payload that fails validation will fail it again on every retry,
        // so these attempts are wasted — but they are bounded, and the job
        // ends up in the dead-letter queue where it is visible. Refusing it
        // here rather than letting a handler read `undefined.tenderIds` is
        // what makes the failure legible.
        logger.error({ job: name, jobId: job.id }, 'job payload rejected by schema');
        throw new Error(`invalid payload for ${name}`);
      }

      const started = Date.now();
      logger.info({ job: name, jobId: job.id }, 'job started');
      try {
        const outcome = await run(parsed.data);
        logger.info(
          { job: name, jobId: job.id, durationMs: Date.now() - started, ...(outcome ?? {}) },
          'job completed',
        );
      } catch (error) {
        logger.error(
          { job: name, jobId: job.id, durationMs: Date.now() - started, err: error },
          'job failed',
        );
        throw error;
      }
    }
  };
}

/**
 * Creates every queue and brings its options up to date.
 *
 * `createQueue` is `ON CONFLICT DO NOTHING`, so a second boot is a no-op —
 * which also means it will not adopt changed retry settings, hence the
 * `updateQueue` immediately after. `policy` is deliberately left at the
 * default: it cannot be changed by `updateQueue`, and none of these queues
 * needs one. Overlap safety comes from the claim keys in the job functions,
 * not from a queue policy.
 */
export async function createQueues(boss: PgBoss): Promise<void> {
  // First, because every other queue names it as its dead letter target and
  // pg-boss checks that the target exists.
  await boss.createQueue(DEAD_LETTER_QUEUE);

  for (const [name, options] of Object.entries(QUEUE_OPTIONS)) {
    await boss.createQueue(name, options);
    await boss.updateQueue(name, options);
  }
}

/**
 * Declares the cron schedules (spec §38, ADR-0008).
 *
 * pg-boss upserts on `(name, key)` and the key defaults to the empty string,
 * so calling this on every boot keeps exactly one row per queue and quietly
 * corrects a changed cron expression. Re-registering cannot accumulate
 * duplicates; the integration test asserts that rather than assuming it.
 */
export async function registerSchedules(boss: PgBoss): Promise<void> {
  await boss.schedule(JOB.doffinSync, CRON.doffinSync, null, { tz: SCHEDULE_TZ });
  await boss.schedule(JOB.notificationDigestPrepare, CRON.digestScheduler, null, {
    tz: SCHEDULE_TZ,
  });
  await boss.schedule(JOB.shareCleanup, CRON.shareCleanup, null, { tz: SCHEDULE_TZ });
}

export async function registerJobs(options: RegisterJobsOptions): Promise<void> {
  const { boss, db, logger, config } = options;
  const worker = options.worker ?? true;
  const now = options.now ?? (() => new Date());

  await createQueues(boss);
  await registerSchedules(boss);

  if (!worker) {
    logger.info('worker disabled: queues and schedules registered, no handlers attached');
    return;
  }

  // doffin.sync → runIngest, then matching for what actually changed.
  await boss.work(
    JOB.doffinSync,
    WORK_OPTIONS,
    handler(JOB.doffinSync, logger, noPayload, async () => {
      const report = await runIngest({
        db,
        adapter: options.adapter,
        logger,
        now: now(),
      });

      // The filter that stops duplicate alerts. Unchanged tenders are not in
      // `matchableTenderIds`, and nothing downstream re-adds them.
      if (report.matchableTenderIds.length > 0) {
        await boss.send(JOB.tenderMatch, { tenderIds: report.matchableTenderIds });
      }

      return {
        runId: report.runId,
        ingestStatus: report.status,
        fetched: report.fetched,
        created: report.created,
        updated: report.updated,
        unchanged: report.unchanged,
        failed: report.failed,
        matchEnqueued: report.matchableTenderIds.length,
        checkpointAdvanced: report.checkpointAdvanced,
      };
    }),
  );

  // tender.match → runMatching, then look for immediate alerts.
  await boss.work(
    JOB.tenderMatch,
    WORK_OPTIONS,
    handler(JOB.tenderMatch, logger, tenderIdsPayload, async ({ tenderIds }) => {
      const report = await runMatching({ db, logger, now: now(), tenderIds });
      await boss.send(JOB.notificationImmediatePrepare, { tenderIds });
      return {
        tendersConsidered: report.tendersConsidered,
        profilesConsidered: report.profilesConsidered,
        matchesWritten: report.matchesWritten,
        included: report.included,
      };
    }),
  );

  // notification.immediate.prepare → claim, then one email.send per claim.
  await boss.work(
    JOB.notificationImmediatePrepare,
    WORK_OPTIONS,
    handler(JOB.notificationImmediatePrepare, logger, tenderIdsPayload, async ({ tenderIds }) => {
      const report = await runImmediateAlerts({ db, logger, now: now(), tenderIds });
      for (const claim of report.claims) {
        await boss.send(JOB.emailSend, { deliveryId: claim.deliveryId });
      }
      return {
        considered: report.considered,
        claimed: report.claimed,
        skippedAlreadyClaimed: report.skippedAlreadyClaimed,
      };
    }),
  );

  // notification.digest.prepare → one scheduler tick, then one send per claim.
  await boss.work(
    JOB.notificationDigestPrepare,
    WORK_OPTIONS,
    handler(JOB.notificationDigestPrepare, logger, noPayload, async () => {
      const report = await runDigestScheduler({ db, logger, now: now() });
      for (const claim of report.claims) {
        await boss.send(JOB.emailSend, { deliveryId: claim.deliveryId });
      }
      return {
        candidatesConsidered: report.candidatesConsidered,
        due: report.due,
        claimed: report.claimed,
        skippedAlreadySent: report.skippedAlreadySent,
        skippedEmpty: report.skippedEmpty,
      };
    }),
  );

  // email.send → render and hand one claimed delivery to Postmark.
  await boss.work(
    JOB.emailSend,
    WORK_OPTIONS,
    handler(JOB.emailSend, logger, emailSendPayload, async ({ deliveryId }) => {
      const claim = await loadClaimedDelivery(db, deliveryId);
      if (!claim) {
        // The delivery, its user or its profile is gone. Ordinary after an
        // account deletion between claim and send; nothing to do and nothing
        // to fail.
        return { skipped: 'delivery_missing' };
      }

      // The claim key stops two *preparers* producing two emails. It does not
      // stop this job being delivered twice, which at-least-once guarantees it
      // eventually will be — so the state of the delivery row is the second
      // gate, and it is the one that holds on a redelivery.
      if (claim.status !== 'pending') {
        return { skipped: `delivery_${claim.status}` };
      }

      if (claim.kind === 'immediate') {
        const candidate = await loadImmediateCandidate(db, claim);
        if (!candidate) return { skipped: 'immediate_item_missing' };

        const result = await sendClaimedImmediateAlert({
          db,
          emailClient: options.emailClient,
          logger,
          candidate,
          deliveryId,
          now: now(),
          ...config,
        });
        return { kind: claim.kind, sent: result.sent };
      }

      if (claim.kind === 'tender_change') {
        // `renderMaterialChange` exists, but nothing claims a delivery of this
        // kind yet: change notifications currently ride along in the digest's
        // "endringer i lagrede anbud" section (spec §26 section 6). When a
        // preparer for them is written, it belongs here.
        return { skipped: 'tender_change_not_prepared' };
      }

      const result = await sendClaimedDigest({
        db,
        emailClient: options.emailClient,
        logger,
        candidate: claim.candidate,
        deliveryId,
        now: now(),
        ...config,
      });
      return { kind: claim.kind, sent: result.sent };
    }),
  );

  // share.cleanup → delete expired links.
  await boss.work(
    JOB.shareCleanup,
    WORK_OPTIONS,
    handler(JOB.shareCleanup, logger, noPayload, async () => {
      const report = await runShareCleanup({ db, logger, now: now() });
      return { deleted: report.deleted };
    }),
  );

  // consent.sync → reconcile withdrawals. Read `consent-sync.ts` before
  // trusting this to have suppressed anybody in Postmark: it cannot.
  await boss.work(
    JOB.consentSync,
    WORK_OPTIONS,
    handler(JOB.consentSync, logger, noPayload, async () => {
      const report = await runConsentSync({
        db,
        emailClient: options.emailClient,
        logger,
        now: now(),
      });
      return { ...report };
    }),
  );

  logger.info({ queues: Object.keys(QUEUE_OPTIONS).length }, 'job handlers registered');
}
