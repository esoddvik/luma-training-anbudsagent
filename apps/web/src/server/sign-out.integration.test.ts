import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { hashToken, SESSION_COOKIE_NAME, validateSession } from '@luma/auth';
import * as schema from '@luma/db/schema';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import type { signOutAction as SignOutAction } from './actions/session-actions';

const describeDb = hasDatabase ? describe : describe.skip;
const PEPPER = 'p'.repeat(32);

/**
 * Signing out (spec section 10).
 *
 * The property under test is **revocation**, not the cookie. Clearing a cookie
 * makes a browser forget a session; it does not end one. `validateSession`
 * reads `revoked_at` on every request, so a sign-out that only dropped the
 * cookie would leave a usable session behind for anything still holding the
 * token — and a test that asserted "the cookie is gone" would pass for exactly
 * that broken implementation. So the session is presented again afterwards,
 * with the same token, and has to be refused.
 */

/** Captures what the action sets and deletes, without a Next request context. */
const cookieJar = new Map<string, { value: string; options?: unknown }>();
const deleted: unknown[] = [];

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    const signal = new Error('NEXT_REDIRECT') as Error & { redirectPath?: string };
    signal.redirectPath = path;
    throw signal;
  },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const entry = cookieJar.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set: (name: string, value: string, options: unknown) => {
      cookieJar.set(name, { value, options });
    },
    delete: (target: unknown) => {
      deleted.push(target);
      const name = typeof target === 'string' ? target : (target as { name: string }).name;
      cookieJar.delete(name);
    },
  }),
}));

/** Runs something expected to redirect, and returns where to. */
async function redirectTargetOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const path = (error as { redirectPath?: unknown }).redirectPath;
    if (typeof path === 'string') return path;
    throw error;
  }
  throw new Error('expected a redirect, and nothing redirected');
}

describeDb('signOutAction', () => {
  let harness: TestDatabase;
  let db: TestDatabase['db'];
  let signOutAction: typeof SignOutAction;

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db;
    process.env.AUTH_SECRET = PEPPER;

    vi.doMock('./db', async () => {
      const actual = await vi.importActual<Record<string, unknown>>('./db');
      return { ...actual, getWebDb: () => db, authPepper: () => PEPPER };
    });

    ({ signOutAction } = await import('./actions/session-actions'));
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  beforeEach(() => {
    cookieJar.clear();
    deleted.length = 0;
  });

  async function signIn(): Promise<{ sessionId: string; token: string }> {
    const [user] = await db
      .insert(schema.users)
      .values({ email: `utlogging-${crypto.randomUUID()}@eksempel.no` })
      .returning({ id: schema.users.id });

    const token = crypto.randomUUID();
    const [session] = await db
      .insert(schema.sessions)
      .values({
        userId: user!.id,
        tokenHash: hashToken(token, PEPPER),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: schema.sessions.id });

    cookieJar.set(SESSION_COOKIE_NAME, { value: token });
    return { sessionId: session!.id, token };
  }

  it('revokes the session row, not just the cookie', async () => {
    const { sessionId } = await signIn();

    await redirectTargetOf(() => signOutAction());

    const [row] = await db
      .select({ revokedAt: schema.sessions.revokedAt })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId));

    expect(row!.revokedAt).not.toBeNull();
  });

  it('refuses the same token afterwards', async () => {
    const { token } = await signIn();
    const { databaseSessionStore } = await import('./session');

    const before = await validateSession({
      token,
      pepper: PEPPER,
      store: databaseSessionStore(db),
      now: new Date(),
    });
    expect(before.ok).toBe(true);

    await redirectTargetOf(() => signOutAction());

    const after = await validateSession({
      token,
      pepper: PEPPER,
      store: databaseSessionStore(db),
      now: new Date(),
    });
    // The assertion a cookie-only sign-out would fail.
    expect(after.ok).toBe(false);
  });

  it('deletes the cookie with the path it was set on', async () => {
    await signIn();
    await redirectTargetOf(() => signOutAction());

    // `jar.delete(name)` deletes at '/', and the session cookie is scoped to
    // the app's base path, so a bare name would leave the browser holding it.
    expect(deleted).toEqual([{ name: SESSION_COOKIE_NAME, path: expect.any(String) }]);
    expect(cookieJar.has(SESSION_COOKIE_NAME)).toBe(false);
  });

  it('sends the signed-out person to the landing page', async () => {
    await signIn();
    expect(await redirectTargetOf(() => signOutAction())).toBe('/');
  });

  it('does not fail when there is no session to end', async () => {
    // A second submit, a stale tab, a bookmarked form. Signing out twice is
    // the same outcome as signing out once and must not be an error page.
    expect(await redirectTargetOf(() => signOutAction())).toBe('/');
  });
});
