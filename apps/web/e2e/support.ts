import { test as base, type BrowserContext } from '@playwright/test';

/**
 * Shared plumbing for the end-to-end suite.
 *
 * The signed-in pages need a real session, and sessions are opaque rows in
 * PostgreSQL rather than something the browser can forge. The suite therefore
 * takes the cookie value from the environment: a seed step (or a developer's
 * own browser) supplies `E2E_SESSION_COOKIE`, and the specs that need it skip
 * themselves when it is absent.
 *
 * Skipping rather than failing is deliberate, and it is a trade-off worth
 * naming: a suite that fails without a seeded session would be red on every
 * machine that has not run the seed, and a suite that is always red is a suite
 * people stop reading. The cost is that a missing seed shows up as "skipped"
 * rather than "broken", so the CI job that runs these has to assert that the
 * variable is set.
 */

export const SESSION_COOKIE_NAME = 'luma_session';

export const sessionCookie = process.env['E2E_SESSION_COOKIE'];

/** A token for a share link seeded before the run. */
export const shareToken = process.env['E2E_SHARE_TOKEN'];

/** A tender id the seeded user has a match on. */
export const tenderId = process.env['E2E_TENDER_ID'];

export async function signIn(context: BrowserContext, baseURL: string): Promise<void> {
  if (!sessionCookie) throw new Error('E2E_SESSION_COOKIE er ikke satt');
  const url = new URL(baseURL);
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: sessionCookie,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'Lax',
    },
  ]);
}

export const test = base;
export { expect } from '@playwright/test';
