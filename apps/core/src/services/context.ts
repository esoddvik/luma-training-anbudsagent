import type { Database } from '@luma/db';
import type { Role } from '@luma/auth';
import type { BillingProvider, OrderRequest, OrderStatus } from '@luma/domain';
import type { EmailClient, SenderIdentity } from '@luma/email';
import type { Logger } from '@luma/observability';

/**
 * Everything the service layer needs, passed in rather than imported.
 *
 * The services below never reach for a module-level singleton: no ambient
 * database handle, no `new Date()`, no process.env read. That is what makes an
 * integration test able to point the whole API at a throwaway database, a fake
 * Postmark client and a frozen clock without patching modules.
 */

export interface ApiConfig {
  /** The web app's origin. Share and login URLs are built against it. */
  readonly appUrl: string;
  readonly privacyUrl: string;
  readonly termsUrl: string;
  /** `AUTH_SECRET`. Peppers session and magic-link token hashes. */
  readonly authSecret: string;
  /** `SHARE_TOKEN_SECRET`. Peppers the share-token hash. */
  readonly shareTokenSecret: string;
  /** `MCP_TOKEN_PEPPER`. Peppers the MCP token hash. */
  readonly mcpTokenPepper: string;
  readonly shareDefaultTtlDays: number;
  /** `ADMIN_EMAIL_ALLOWLIST`, lowercased. The only source of admin rights. */
  readonly adminEmails: readonly string[];
  /** The verified Postmark sender signature. Usually a no-reply address. */
  readonly authEmailFrom: string;
  /**
   * The footer's sender identity: name, postal address and a contact address a
   * recipient can actually write to.
   *
   * §25 requires the footer to carry «avsenderinformasjon og
   * kontaktinformasjon» and does not itemise it further — the three fields are
   * `SenderIdentity` in `@luma/email`, not a spec enumeration. (An earlier
   * version of this comment presented them as §25's list.) §48 lists no sender
   * variable either, so `SENDER_NAME`, `SENDER_POSTAL_ADDRESS` and
   * `SENDER_CONTACT_EMAIL` are additions beyond it, recorded in
   * `docs/spec-deviations.md`. All three are configuration; the postal address
   * was a hard-coded constant until that variable existed, and is not one now.
   *
   * Distinct from `authEmailFrom` on purpose — see `senderIdentityFromEnv`.
   */
  readonly sender: SenderIdentity;
  readonly billingAdminEmail: string;
  readonly currentPrivacyPolicyVersion: string;
  readonly currentTermsVersion: string;
  readonly currentMarketingConsentTextVersion: string;
  /**
   * `POSTMARK_WEBHOOK_USERNAME` / `POSTMARK_WEBHOOK_PASSWORD` (spec §27, §48).
   *
   * The Postmark webhook is a public endpoint that writes to our database, and
   * these are the only thing standing in front of it. Compared in constant
   * time by `authenticateWebhook` in `@luma/email`.
   */
  readonly postmarkWebhookUsername: string;
  readonly postmarkWebhookPassword: string;
  /** Controls the `Secure` attribute on the session cookie. */
  readonly isProduction: boolean;
}

/**
 * The admin status change, which `BillingProvider` does not cover.
 *
 * Spec §28.2 has an administrator move an order through `in_progress` and
 * possibly `declined`, neither of which is `activateOrder` or `cancelOrder`.
 * Rather than widen the phase-7 interface with MVP-shaped methods, the manual
 * provider implements this alongside it.
 */
export interface OrderStatusWriter {
  transition(
    orderId: string,
    to: OrderStatus,
    adminId: string,
    adminNote?: string,
  ): Promise<OrderRequest>;
}

/**
 * The background jobs an administrator can trigger from the API (§45).
 *
 * A seam rather than a direct import of `jobs/ingest.ts`, because ingest needs
 * a `TenderSourceAdapter` and wiring the live Doffin adapter into the HTTP
 * layer would mean an integration test of the admin route could not run
 * without a Doffin subscription key.
 */
export interface JobRunner {
  runIngest(input: {
    adminUserId: string;
  }): Promise<{ runId: string; status: string; fetched: number; created: number; updated: number }>;
  runMatching(input: {
    tenderIds?: readonly string[];
    alertProfileId?: string;
  }): Promise<{ tendersConsidered: number; profilesConsidered: number; matchesWritten: number }>;
  /**
   * Fills in history the hourly sync cannot reach.
   *
   * Separate from `runIngest` rather than a flag on it, because the two do
   * genuinely different things: ingest walks forward from a checkpoint and
   * enqueues matching, and a backfill walks issue-date windows backwards and
   * deliberately enqueues none. A boolean would put those two behaviours behind
   * one name and one set of counters.
   */
  runBackfill(input: { days: number; adminUserId: string }): Promise<{
    windows: number;
    fetched: number;
    created: number;
    updated: number;
    unchanged: number;
    failed: number;
    truncatedWindows: readonly string[];
  }>;
}

/**
 * Follow-up work a request wants done later, not now.
 *
 * Spec §27 requires the Postmark webhook to answer fast and queue the slow
 * part. `apps/core` does have a queue — pg-boss, per ADR-8 — but it is owned by
 * the runtime layer and is being wired up separately, and the route layer
 * deliberately holds no handle to it: an HTTP surface that imports the queue
 * module cannot be integration-tested without one running.
 *
 * So this is the seam. It is intentionally as narrow as the requirement: one
 * method, a closed union of payloads, no job options, no scheduling, no
 * cancellation. When pg-boss is available, `main.ts` passes an implementation
 * that calls `boss.send('postmark.webhook.process', work)`; until then the
 * default logs, which is the correct behaviour for work whose only current
 * consumer is an administrator reading the log.
 *
 * Nothing a *user* depends on may go through here. Everything the webhook must
 * not lose — the event row, the suppression, the consent withdrawal — is
 * written synchronously inside the request, before Postmark is answered.
 */
export type DeferredWork =
  /**
   * An operational alert derived from a webhook (spec §27, ADR-5): a hard
   * bounce on the transactional stream, a spam complaint, or a suppression
   * that appeared on transactional mail. Sending it involves Postmark, which
   * is exactly the kind of latency a webhook handler must not take on.
   */
  {
    readonly kind: 'postmark.admin_alert';
    readonly severity: 'warning' | 'critical';
    readonly reason: string;
    readonly stream: string;
    /** Recipient address. Redacted before it reaches a log line. */
    readonly recipient: string;
    readonly detail?: string;
  };

/**
 * Where deferred work goes. Defaults to a logging no-op.
 *
 * **Before wiring this to pg-boss, check the target queue has a consumer.**
 * `boss.send` to a queue with no registered worker *succeeds* — it returns a
 * job id and the row sits in `created` forever. The queue whose name most
 * obviously fits this seam, `postmark.webhook.process`, is one of the five in
 * §38 that currently have no handler, so the natural wiring is also the one
 * that loses the work silently. `warnAboutUnconsumedQueues` in `queue/` reads
 * the live worker list back from pg-boss and names those five; consult it
 * rather than assuming, because the list changes as handlers land.
 *
 * That matters here specifically because §27 requires the webhook to answer
 * fast and «kølegg langsom behandling», so this seam is on the path a future
 * implementer will take. A dropped operational alert is invisible by
 * construction — nobody is waiting for it.
 */
export interface DeferredWorkQueue {
  enqueue(work: DeferredWork): Promise<void>;
}

/**
 * Queue depth for the admin dashboard (spec §45 "køstatus", §38).
 *
 * A read-only port, not the `PgBoss` handle. Handing the HTTP layer the real
 * client would also hand it `send`, `deleteQueue` and `purge` — an admin
 * *dashboard* has no business being able to drain a queue, and the narrow
 * shape means an integration test of `/admin/ingest-status` needs no running
 * pg-boss. Same reasoning as `JobRunner` above.
 */
export interface QueueStatusReader {
  status(): Promise<readonly { name: string; ready: number; active: number; failed: number }[]>;
}

export interface ApiContext {
  readonly db: Database;
  readonly email: EmailClient;
  readonly logger: Logger;
  /** Injected clock. Every timestamp the API writes comes from here. */
  readonly now: () => Date;
  readonly config: ApiConfig;
  readonly billing: BillingProvider & OrderStatusWriter;
  readonly jobs: JobRunner;
  /** See `DeferredWork`. Defaults to a logging no-op. */
  readonly deferred: DeferredWorkQueue;
  /**
   * Optional, and in the deployed wiring always present.
   *
   * An earlier version of this comment claimed it was absent when
   * `WORKER_ENABLED=false`. That is wrong: `startQueue` connects pg-boss
   * regardless, and the flag only decides whether this process registers
   * *handlers*. Queue depth is a property of the shared database, not of the
   * process reading it, so a producer-only replica reports the real numbers —
   * which is the more useful answer, and the reason the wiring is not gated.
   *
   * So `null` means "not observed", and in practice that is a test context
   * built without a reader, or a queue read that threw. It is deliberately not
   * `[]`: an idle queue and an unobservable one are different facts, and a
   * dashboard that renders them identically reports calm during an outage.
   */
  readonly queue?: QueueStatusReader;
}

/**
 * Who is making the request.
 *
 * Carried explicitly into every service call, because spec §39 puts
 * authorisation in the service layer: a service that had to ask the framework
 * who the caller was would be a service that could be called without one.
 */
export interface Actor {
  readonly userId: string;
  readonly email: string;
  readonly role: Role;
  readonly sessionId: string;
}
