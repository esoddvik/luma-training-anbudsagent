import {
  createPostmarkTransport,
  PostmarkEmailClient,
  type BaseEmailContext,
  type EmailClient,
  type SenderIdentity,
} from '@luma/email';
import { privacyPolicyUrl } from '@/lib/legal';

/**
 * The web app's outbound transactional email.
 *
 * Only one email is sent from here: the magic login link. Everything else that
 * Luma sends — digests, immediate alerts, order confirmations — belongs to the
 * queue in `apps/core`, and nothing in this module is meant to grow into a
 * second copy of that.
 *
 * **Why the client is built by hand instead of `createEmailClientFromEnv()`.**
 * That helper calls `getCoreEnv()`, which validates the *core* service's whole
 * environment: Doffin subscription key, billing address, cron secret, MCP
 * pepper. The web app is not configured with any of those, so the first login
 * attempt would fail with a list of missing variables that have nothing to do
 * with login. `parseWebEnv` in `@luma/config` already declares exactly the
 * three variables needed here (`POSTMARK_SERVER_TOKEN`,
 * `POSTMARK_TRANSACTIONAL_STREAM`, `AUTH_EMAIL_FROM`), which is the same
 * decision recorded in configuration form.
 *
 * Every value is read at call time rather than at module load, for the reason
 * `authPepper()` gives in `db.ts`: a missing variable must surface as a failed
 * request with a clear Norwegian message, not as a build-time crash in a
 * preview deployment that never sends a login link.
 */

function required(name: string, human: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`${name} mangler. ${human}`);
  }
  return value;
}

/** `APP_URL`. The public root of this app, used to build the emailed link. */
export function appUrl(): string {
  return required('APP_URL', 'Innloggingslenken kan ikke bygges uten adressen til tjenesten.');
}

/** `TENDER_SERVICE_TERMS_URL` (spec section 19). Required in every footer. */
export function termsUrl(): string {
  return required('TENDER_SERVICE_TERMS_URL', 'E-postbunnteksten krever lenke til bruksvilkårene.');
}

/**
 * Luma Training's sender identity.
 *
 * A constant, matching `apps/core`. Spec section 48 defines no environment
 * variable for the postal address, and inventing one would move a legally
 * required footer field out of the review that changes it. Recorded as a known
 * deviation in `docs/spec-deviations.md`.
 */
const LUMA_SENDER: Omit<SenderIdentity, 'contactEmail'> = {
  name: 'Luma Training',
  postalAddress: 'Luma Training AS, Oslo',
};

let cached: EmailClient | undefined;

/**
 * The Postmark client. Cached per process, like the database pool.
 *
 * The integration suite substitutes a `FakePostmarkClient` by mocking this
 * module rather than through a setter, so no production-reachable seam exists
 * for replacing the client at runtime.
 */
export function getWebEmailClient(): EmailClient {
  if (cached) return cached;

  cached = new PostmarkEmailClient({
    transport: createPostmarkTransport(
      required('POSTMARK_SERVER_TOKEN', 'Innloggingslenken kan ikke sendes uten Postmark.'),
    ),
    streams: {
      transactional: process.env['POSTMARK_TRANSACTIONAL_STREAM'] ?? 'transactional',
      // Named for completeness; the web app can only reach the transactional
      // stream, because `sendTransactional` is the only method it calls and
      // the template's type admits no other stream (ADR-0005).
      tenderNotifications:
        process.env['POSTMARK_TENDER_NOTIFICATION_STREAM'] ?? 'tender-notifications',
      lumaMarketing: process.env['POSTMARK_MARKETING_STREAM'] ?? 'luma-marketing',
    },
    from: required('AUTH_EMAIL_FROM', 'Postmark trenger en verifisert avsenderadresse.'),
  });
  return cached;
}

/**
 * The context every transactional email from the web app shares.
 *
 * Collecting it here means a login email cannot ship without the privacy and
 * terms links its footer legally needs (spec sections 18 and 19).
 */
export function baseEmailContext(recipientEmail: string, now: Date): BaseEmailContext {
  return {
    recipientEmail,
    sender: {
      ...LUMA_SENDER,
      contactEmail: required('AUTH_EMAIL_FROM', 'Postmark trenger en verifisert avsenderadresse.'),
    },
    links: {
      appUrl: appUrl(),
      privacyUrl: privacyPolicyUrl(),
      termsUrl: termsUrl(),
      medium: 'landing',
    },
    now,
  };
}
