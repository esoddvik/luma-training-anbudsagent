import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME } from '@luma/auth';

/**
 * Calling `apps/core` from a server action.
 *
 * ## Why this exists at all, when nothing else in the app needs it
 *
 * Every read in this app goes straight to PostgreSQL — `db.ts` records why: a
 * server component fetching its own API adds a network hop and a second copy
 * of the authorisation rules. That holds for everything the web app can do by
 * itself.
 *
 * It cannot do this one. Triggering a Doffin ingest or backfill needs the
 * `TenderSourceAdapter`, and spec section 36 forbids running Doffin ingest as a
 * request-bound Vercel function — it is long-running work that belongs to the
 * Railway process. So the admin trigger is the first thing in this app that
 * genuinely has to cross the service boundary.
 *
 * ## Why it forwards the operator's session instead of using a service secret
 *
 * The obvious alternative is a shared secret that lets the web app tell core
 * "do this admin thing". That would create a credential which is, by
 * construction, permanently authorised to run every admin action — and would
 * move the "is this person an admin" decision into the web app, leaving core
 * trusting a caller rather than a user.
 *
 * Forwarding the session cookie keeps the decision where it already lives.
 * Core validates the session against the database exactly as it does for any
 * other request and runs its own `requireAdmin`, so the request is authorised
 * as *that operator*, it appears in the audit log as them, and revoking their
 * session revokes this too. There is no new privilege anywhere — the web app
 * cannot do anything through this seam that the signed-in person could not do
 * by calling core directly.
 *
 * The web action still checks admin itself before calling. Two independent
 * checks, and the one that matters is core's.
 */

/** The header `checkCsrf` requires on every state-changing request. */
const CSRF_HEADER = 'x-luma-csrf';

export type CoreApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: string;
      readonly message: string;
    };

function apiBaseUrl(): string {
  const configured = process.env['API_URL'];
  if (!configured || configured.length === 0) {
    throw new Error('API_URL mangler. Administrasjonshandlingen kan ikke nå kjernetjenesten.');
  }
  return configured.replace(/\/$/, '');
}

/**
 * POSTs to a core route as the currently signed-in user.
 *
 * Returns a discriminated result rather than throwing on a 4xx: an admin
 * pressing a button and getting "du er ikke logget inn lenger" is a normal
 * outcome that the page should render, not an exception that becomes a 500.
 */
export async function postToCore<T>(
  path: string,
  body: unknown,
  options: { timeoutMs?: number } = {},
): Promise<CoreApiResult<T>> {
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE_NAME)?.value;

  if (!session) {
    return {
      ok: false,
      status: 401,
      code: 'not_signed_in',
      message: 'Du er ikke logget inn lenger. Last siden på nytt.',
    };
  }

  const controller = new AbortController();
  // Generous, because the backfill this was built for walks months of
  // issue-date windows and legitimately takes minutes. A short timeout here
  // would abandon a run that is still working and report failure for it.
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 600_000);

  try {
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forwarded, not minted. See the note above.
        Cookie: `${SESSION_COOKIE_NAME}=${session}`,
        // `checkCsrf` wants the header present; its value is not inspected,
        // because the protection is that a cross-site form cannot set one.
        [CSRF_HEADER]: '1',
        // Core compares this against its allowed origins. Sent explicitly
        // because a server-side fetch has no browser to set it.
        Origin: new URL(process.env['APP_URL'] ?? apiBaseUrl()).origin,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });

    const text = await response.text();
    const parsed: unknown = text.length > 0 ? JSON.parse(text) : {};

    if (!response.ok) {
      const problem = parsed as { code?: string; message?: string };
      return {
        ok: false,
        status: response.status,
        code: problem.code ?? 'ukjent_feil',
        message: problem.message ?? 'Handlingen kunne ikke fullføres.',
      };
    }

    return { ok: true, data: parsed as T };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      status: aborted ? 504 : 502,
      code: aborted ? 'tidsavbrudd' : 'kjernetjenesten_svarte_ikke',
      message: aborted
        ? 'Kjøringen tok for lang tid. Den kan fortsatt være i gang — sjekk kjøringene før du prøver igjen.'
        : 'Kjernetjenesten svarte ikke. Prøv igjen om litt.',
    };
  } finally {
    clearTimeout(timer);
  }
}
