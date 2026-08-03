import type { Database } from '@luma/db';
import type { Role } from '@luma/auth';
import type { BillingProvider, OrderRequest, OrderStatus } from '@luma/domain';
import type { EmailClient } from '@luma/email';
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
  readonly authEmailFrom: string;
  readonly billingAdminEmail: string;
  readonly currentPrivacyPolicyVersion: string;
  readonly currentTermsVersion: string;
  readonly currentMarketingConsentTextVersion: string;
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
 * The two background jobs an administrator can trigger from the API (§45).
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
