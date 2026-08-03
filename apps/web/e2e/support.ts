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
 * Skipping is right on a laptop and dangerous in CI. A suite that fails without
 * a seed would be red on every machine that has not run one, and a suite that
 * is always red is a suite people stop reading — but a CI leg that skips is
 * green having verified nothing, including the shared-view privacy check, which
 * is the assertion most worth having. So the skip is kept for local runs and
 * turned into a hard failure in CI by the guard below.
 */

/**
 * Whether this process is running in CI.
 *
 * The same parse as `isCi` in `packages/db/src/testing/harness.ts`, and for the
 * same reason: `CI=false` is a real thing people export — it is the documented
 * way to stop a Next.js build treating warnings as errors, and this *is* the
 * Next app — so plain truthiness would read `'false'` as "we are in CI" and
 * hard-fail a laptop run that was correct to skip.
 *
 * Duplicated rather than imported, which is worth naming because the harness
 * explicitly says to import it. Two reasons it cannot be: this repository's
 * ESLint config forbids importing `@luma/db/testing` outside a `*.test.ts`
 * file, since that module opens an admin database connection and issues
 * `CREATE DATABASE`, and this file is not a test file; and the Playwright suite
 * drives a deployed URL over HTTP and has no business holding a database handle
 * at all. The expression is copied verbatim so the two cannot come to disagree
 * about what `CI=false` means.
 */
export const isCi = !['', '0', 'false'].includes((process.env['CI'] ?? '').toLowerCase());

/**
 * Every seed value the suite reads, and what each one unlocks.
 *
 * One list, in one place, so a spec cannot quietly start depending on a
 * variable the CI job does not set. Reading `process.env['E2E_…']` anywhere
 * else under `e2e/` is how this guard gets bypassed — read it from here.
 */
const REQUIRED_SEEDS: Readonly<Record<string, string>> = {
  E2E_SESSION_COOKIE: 'session cookie for the seeded user; unlocks every signed-in page',
  E2E_TENDER_ID: 'a tender the seeded user has a match on; unlocks the detail page',
  E2E_SHARE_TOKEN: 'an active share link; unlocks the public shared view',
  E2E_SHARER_EMAIL: "the sharing user's address; the shared view must not contain it",
  E2E_PROFILE_KEYWORD: 'a keyword from the seeded alert profile; must not leak into the share',
  E2E_PROFILE_NAME: 'the seeded profile name; must not leak into the share',
};

/**
 * In CI, missing seed data is a broken pipeline, not a reason to skip.
 *
 * This throws during module evaluation, so it preempts collection: every spec
 * imports this file, and Playwright reports the failure before a single test is
 * attempted. That is deliberate. An assertion inside a test would still let the
 * rest of the suite report a green run around it, and a `test.skip()` condition
 * is exactly the thing being fixed.
 *
 * The three privacy variables are required alongside the three that unlock
 * pages, because without them the shared-view leak assertions silently degrade
 * from "this address does not appear on the page" to "no address was checked".
 * A test that still passes once its subject is removed is not a test.
 */
if (isCi) {
  const missing = Object.keys(REQUIRED_SEEDS).filter((name) => {
    const value = process.env[name];
    return value === undefined || value.length === 0;
  });

  if (missing.length > 0) {
    throw new Error(
      'CI is set, but the end-to-end seed data is not:\n' +
        missing.map((name) => `  ${name} — ${REQUIRED_SEEDS[name]}`).join('\n') +
        '\n\nWithout these the specs skip themselves and the run reports success having ' +
        'verified nothing, including the shared-view privacy check. Set them on the ' +
        "Playwright job from the seed step's output, or unset CI to run locally.",
    );
  }
}

export const SESSION_COOKIE_NAME = 'luma_session';

export const sessionCookie = process.env['E2E_SESSION_COOKIE'];

/** A token for a share link seeded before the run. */
export const shareToken = process.env['E2E_SHARE_TOKEN'];

/** A tender id the seeded user has a match on. */
export const tenderId = process.env['E2E_TENDER_ID'];

/** The sharing user's address. The shared view must never contain it. */
export const sharerEmail = process.env['E2E_SHARER_EMAIL'];

/** A keyword from the seeded alert profile. Must not leak into the share. */
export const profileKeyword = process.env['E2E_PROFILE_KEYWORD'];

/** The seeded profile's name. Must not leak into the share. */
export const profileName = process.env['E2E_PROFILE_NAME'];

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
