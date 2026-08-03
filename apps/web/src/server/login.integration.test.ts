import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { hashToken, issueMagicLink, SESSION_COOKIE_NAME } from '@luma/auth';
import type { completeLogin as CompleteLogin } from './login';
import * as schema from '@luma/db/schema';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';

/**
 * Redeeming a magic link, against a real database.
 *
 * This is the one flow where a bug locks every user out or, worse, lets the
 * wrong one in, so it is tested against real rows rather than a fake store.
 */

const describeDb = hasDatabase ? describe : describe.skip;
const PEPPER = 'p'.repeat(32);

/** Captures what the page would set, without a Next request context. */
const cookieJar = new Map<string, { value: string; options: unknown }>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const entry = cookieJar.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set: (name: string, value: string, options: unknown) => {
      cookieJar.set(name, { value, options });
    },
  }),
}));

describeDb('completeLogin', () => {
  let harness: TestDatabase;
  let db: TestDatabase['db'];
  let userId: string;
  let completeLogin: typeof CompleteLogin;

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db;

    process.env.AUTH_SECRET = PEPPER;
    vi.doMock('./db', () => ({
      getWebDb: () => db,
      authPepper: () => PEPPER,
    }));

    ({ completeLogin } = await import('./login'));
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  beforeEach(async () => {
    cookieJar.clear();
    await db.execute(sql`truncate table ${schema.users} restart identity cascade`);
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'anbud@entreprenor.no' })
      .returning({ id: schema.users.id });
    userId = user!.id;
  });

  async function issueLink(overrides: { expiresAt?: Date; userId?: string | null } = {}) {
    const link = issueMagicLink({ pepper: PEPPER, now: new Date() });
    await db.insert(schema.magicLinkTokens).values({
      email: 'anbud@entreprenor.no',
      userId: overrides.userId === undefined ? userId : overrides.userId,
      tokenHash: link.tokenHash,
      expiresAt: overrides.expiresAt ?? link.expiresAt,
    });
    return link.token;
  }

  it('signs the user in and sets a session cookie', async () => {
    const token = await issueLink();
    const result = await completeLogin(token);

    expect(result).toEqual({ ok: true, userId });
    expect(cookieJar.has(SESSION_COOKIE_NAME)).toBe(true);
  });

  it('stores the session as a hash, never as the cookie value', async () => {
    const token = await issueLink();
    await completeLogin(token);

    const cookieValue = cookieJar.get(SESSION_COOKIE_NAME)!.value;
    const [session] = await db.select().from(schema.sessions);

    expect(session!.tokenHash).not.toBe(cookieValue);
    expect(session!.tokenHash).toBe(hashToken(cookieValue, PEPPER));
  });

  it('sets the cookie HttpOnly and SameSite=Lax', async () => {
    // Lax rather than Strict: the click arrives cross-site from an email
    // client, and Strict would drop the cookie on exactly this navigation.
    const token = await issueLink();
    await completeLogin(token);

    expect(cookieJar.get(SESSION_COOKIE_NAME)!.options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
    });
  });

  it('refuses a token that was never issued', async () => {
    const result = await completeLogin('not-a-real-token');
    expect(result.ok).toBe(false);
    expect(cookieJar.has(SESSION_COOKIE_NAME)).toBe(false);
  });

  it('refuses a missing token', async () => {
    expect((await completeLogin(undefined)).ok).toBe(false);
  });

  it('refuses an expired link, in Norwegian', async () => {
    const token = await issueLink({ expiresAt: new Date(Date.now() - 60_000) });
    const result = await completeLogin(token);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/utløpt/i);
  });

  it('is single use: the second click fails and creates no second session', async () => {
    const token = await issueLink();
    const first = await completeLogin(token);
    const second = await completeLogin(token);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(await db.$count(schema.sessions)).toBe(1);
  });

  it('lets only one of two simultaneous redemptions through', async () => {
    // A mail scanner prefetching the link while the user clicks it is the
    // realistic version of this race, not a contrived one.
    const token = await issueLink();
    const results = await Promise.all([completeLogin(token), completeLogin(token)]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await db.$count(schema.sessions)).toBe(1);
  });

  it('marks the link consumed', async () => {
    const token = await issueLink();
    await completeLogin(token);

    const [row] = await db.select().from(schema.magicLinkTokens);
    expect(row!.consumedAt).not.toBeNull();
  });

  it('refuses a link issued for an address with no account', async () => {
    // The login endpoint answers identically whether or not an account exists,
    // so such a token can be created. It must never produce a session.
    const token = await issueLink({ userId: null });
    const result = await completeLogin(token);

    expect(result.ok).toBe(false);
    expect(await db.$count(schema.sessions)).toBe(0);
  });

  it('says the same thing about an unknown token as about a consumed one', async () => {
    // Different wording is fine — both tell the user to request a new link —
    // but neither may reveal whether the token was ever real.
    const token = await issueLink();
    await completeLogin(token);

    const consumed = await completeLogin(token);
    const unknown = await completeLogin('never-existed');

    for (const result of [consumed, unknown]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/[Bb]e om en ny lenke/);
    }
  });
});
