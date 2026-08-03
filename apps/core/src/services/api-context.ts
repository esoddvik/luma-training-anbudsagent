import type { CoreEnv } from '@luma/config';
import type { Database } from '@luma/db';
import { senderIdentityFromEnv, type EmailClient } from '@luma/email';
import type { Logger } from '@luma/observability';
import { ManualInvoiceBillingProvider } from './billing-manual.js';
import type {
  ApiConfig,
  ApiContext,
  DeferredWork,
  DeferredWorkQueue,
  JobRunner,
  QueueStatusReader,
} from './context.js';

/**
 * Assembling the `ApiContext` from validated environment configuration.
 *
 * Kept out of `main.ts` so that an integration test can build the same object
 * from a throwaway database, a fake Postmark client and a frozen clock without
 * duplicating the field-by-field mapping — which is exactly the kind of
 * duplication that lets a test pass against a configuration production never
 * has.
 */

export function apiConfigFromEnv(env: CoreEnv): ApiConfig {
  return {
    appUrl: env.APP_URL,
    privacyUrl: env.LUMA_PRIVACY_POLICY_URL,
    termsUrl: env.TENDER_SERVICE_TERMS_URL,
    authSecret: env.AUTH_SECRET,
    shareTokenSecret: env.SHARE_TOKEN_SECRET,
    mcpTokenPepper: env.MCP_TOKEN_PEPPER,
    shareDefaultTtlDays: env.SHARE_DEFAULT_TTL_DAYS,
    adminEmails: env.ADMIN_EMAIL_ALLOWLIST,
    authEmailFrom: env.AUTH_EMAIL_FROM,
    sender: senderIdentityFromEnv(env),
    billingAdminEmail: env.BILLING_ADMIN_EMAIL,
    currentPrivacyPolicyVersion: env.CURRENT_PRIVACY_POLICY_VERSION,
    currentTermsVersion: env.CURRENT_TERMS_VERSION,
    currentMarketingConsentTextVersion: env.CURRENT_MARKETING_CONSENT_TEXT_VERSION,
    postmarkWebhookUsername: env.POSTMARK_WEBHOOK_USERNAME,
    postmarkWebhookPassword: env.POSTMARK_WEBHOOK_PASSWORD,
    isProduction: env.NODE_ENV === 'production',
  };
}

export interface BuildApiContextOptions {
  readonly db: Database;
  readonly email: EmailClient;
  readonly logger: Logger;
  readonly config: ApiConfig;
  readonly jobs: JobRunner;
  /** Injected so tests can freeze time. Defaults to the wall clock. */
  readonly now?: () => Date;
  /**
   * Where deferred work goes. Omitted, it is logged and dropped.
   *
   * Logging rather than throwing is the deliberate choice while the queue is
   * being wired in: the only thing currently deferred is an operational alert,
   * and refusing a Postmark webhook because the alert could not be queued
   * would turn a notification gap into a retry storm and lost bounce data.
   */
  readonly deferred?: DeferredWorkQueue;
  /** Omitted when this process runs no worker. See `QueueStatusReader`. */
  readonly queue?: QueueStatusReader;
}

/**
 * The default queue: writes a log line and returns.
 *
 * `recipient` is deliberately not logged. Spec §40 requires email addresses to
 * be redacted in logs, and an alert about a bounce is exactly the line where
 * an address would otherwise end up in a log aggregator forever.
 */
export function loggingDeferredWorkQueue(logger: Logger): DeferredWorkQueue {
  return {
    enqueue: async (work: DeferredWork) => {
      logger.warn(
        { kind: work.kind, severity: work.severity, reason: work.reason, stream: work.stream },
        'utsatt arbeid ble ikke kølagt: ingen kø er koblet til API-laget ennå',
      );
    },
  };
}

export function buildApiContext(options: BuildApiContextOptions): ApiContext {
  const now = options.now ?? (() => new Date());
  return {
    db: options.db,
    email: options.email,
    logger: options.logger,
    now,
    config: options.config,
    billing: new ManualInvoiceBillingProvider(options.db, now),
    jobs: options.jobs,
    deferred: options.deferred ?? loggingDeferredWorkQueue(options.logger),
    ...(options.queue ? { queue: options.queue } : {}),
  };
}
