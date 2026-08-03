import type { CoreEnv } from '@luma/config';
import type { Database } from '@luma/db';
import type { EmailClient } from '@luma/email';
import type { Logger } from '@luma/observability';
import { ManualInvoiceBillingProvider } from './billing-manual.js';
import type { ApiConfig, ApiContext, JobRunner } from './context.js';

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
    billingAdminEmail: env.BILLING_ADMIN_EMAIL,
    currentPrivacyPolicyVersion: env.CURRENT_PRIVACY_POLICY_VERSION,
    currentTermsVersion: env.CURRENT_TERMS_VERSION,
    currentMarketingConsentTextVersion: env.CURRENT_MARKETING_CONSENT_TEXT_VERSION,
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
  };
}
