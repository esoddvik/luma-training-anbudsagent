import { readdir, readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { hashToken, SESSION_COOKIE_NAME } from '@luma/auth';
import * as schema from '@luma/db/schema';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import type { requireCurrentTerms as RequireCurrentTerms } from './session';
import type { acceptTermsAction as AcceptTermsAction } from './actions/legal-actions';

const describeDb = hasDatabase ? describe : describe.skip;
const PEPPER = 'p'.repeat(32);
const SEEDED = '2026-01-utkast';

/**
 * The terms gate (spec section 20.1, section 51 blocker 2).
 *
 * Two failures matter and they pull opposite ways. Letting a user through with
 * an outstanding acceptance leaves the service being used under text nobody
 * agreed to, which is the whole reason this exists. Blocking a user who is up
 * to date — or blocking one when no version is in force at all — locks people
 * out of a service they have done nothing wrong in.
 */

const cookieJar = new Map<string, { value: string }>();

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    const signal = new Error('NEXT_REDIRECT') as Error & { redirectPath?: string };
    signal.redirectPath = path;
    throw signal;
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const entry = cookieJar.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set: () => undefined,
    delete: () => undefined,
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

async function redirectTargetOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const path = (error as { redirectPath?: unknown }).redirectPath;
    if (typeof path === 'string') return path;
    throw error;
  }
}

describeDb('the terms gate', () => {
  let harness: TestDatabase;
  let db: TestDatabase['db'];
  let requireCurrentTerms: typeof RequireCurrentTerms;
  let acceptTermsAction: typeof AcceptTermsAction;

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db;
    process.env.AUTH_SECRET = PEPPER;

    vi.doMock('./db', async () => {
      const actual = await vi.importActual<Record<string, unknown>>('./db');
      return { ...actual, getWebDb: () => db, authPepper: () => PEPPER };
    });

    ({ requireCurrentTerms } = await import('./session'));
    ({ acceptTermsAction } = await import('./actions/legal-actions'));
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  beforeEach(() => {
    cookieJar.clear();
  });

  async function signIn(): Promise<string> {
    const [user] = await db
      .insert(schema.users)
      .values({ email: `gate-${crypto.randomUUID()}@eksempel.no` })
      .returning({ id: schema.users.id });

    const token = crypto.randomUUID();
    await db.insert(schema.sessions).values({
      userId: user!.id,
      tokenHash: hashToken(token, PEPPER),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    cookieJar.set(SESSION_COOKIE_NAME, { value: token });
    return user!.id;
  }

  it('sends a user who owes an acceptance to the acceptance page', async () => {
    await signIn();
    expect(await redirectTargetOf(() => requireCurrentTerms())).toBe('/vilkar/godta');
  });

  it('carries where they were going, so accepting does not lose the destination', async () => {
    await signIn();
    expect(await redirectTargetOf(() => requireCurrentTerms('/varsler/ny'))).toBe(
      '/vilkar/godta?retur=%2Fvarsler%2Fny',
    );
  });

  it('lets a user who has accepted the version in force through', async () => {
    const userId = await signIn();
    await db.insert(schema.userLegalAcceptances).values({
      userId,
      kind: 'terms',
      version: SEEDED,
      acceptedAt: new Date(),
    });

    // No redirect at all: the gate returns the user.
    expect(await redirectTargetOf(() => requireCurrentTerms())).toBeNull();
  });

  it('records exactly one acceptance and one consent event, and lets them through', async () => {
    const userId = await signIn();

    const form = new FormData();
    form.set('versjon', SEEDED);
    expect(await redirectTargetOf(() => acceptTermsAction(form))).toBe('/oversikt');

    const acceptances = await db
      .select()
      .from(schema.userLegalAcceptances)
      .where(eq(schema.userLegalAcceptances.userId, userId));
    expect(acceptances).toHaveLength(1);
    expect(acceptances[0]!.version).toBe(SEEDED);

    const consents = await db
      .select()
      .from(schema.consentEvents)
      .where(eq(schema.consentEvents.userId, userId));
    expect(consents).toHaveLength(1);
    expect(consents[0]!.consentType).toBe('terms_acceptance');
    expect(consents[0]!.status).toBe('accepted');
    expect(consents[0]!.source).toBe('account_settings');

    expect(await redirectTargetOf(() => requireCurrentTerms())).toBeNull();
  });

  it('appends nothing when the same version is submitted twice', async () => {
    const userId = await signIn();

    const form = new FormData();
    form.set('versjon', SEEDED);
    await redirectTargetOf(() => acceptTermsAction(form));
    await redirectTargetOf(() => acceptTermsAction(form));

    const acceptances = await db
      .select()
      .from(schema.userLegalAcceptances)
      .where(eq(schema.userLegalAcceptances.userId, userId));
    const consents = await db
      .select()
      .from(schema.consentEvents)
      .where(eq(schema.consentEvents.userId, userId));

    // The consent log is append-only: a spurious row could never be removed,
    // and the sequence is the evidence.
    expect(acceptances).toHaveLength(1);
    expect(consents).toHaveLength(1);
  });

  it('grants no marketing consent by accepting the terms', async () => {
    const userId = await signIn();
    const form = new FormData();
    form.set('versjon', SEEDED);
    await redirectTargetOf(() => acceptTermsAction(form));

    const marketing = await db
      .select()
      .from(schema.consentEvents)
      .where(eq(schema.consentEvents.consentType, 'marketing_email'));
    expect(marketing.filter((row) => row.userId === userId)).toEqual([]);
  });

  it('refuses a version that does not exist rather than recording it', async () => {
    const userId = await signIn();

    const form = new FormData();
    form.set('versjon', 'finnes-ikke');
    expect(await redirectTargetOf(() => acceptTermsAction(form))).toBe('/vilkar/godta');

    const acceptances = await db
      .select()
      .from(schema.userLegalAcceptances)
      .where(eq(schema.userLegalAcceptances.userId, userId));
    expect(acceptances).toEqual([]);
  });
});

/**
 * Which routes the gate covers, read off the filesystem rather than listed.
 *
 * **This is the weakest test in the file and should be read as such.** The gate
 * is the `(app)` layout, so membership of the route group *is* the coverage;
 * what a directory walk can prove is that nobody quietly moved a page out of
 * the group, and that the exempt set is exactly the four routes that were
 * argued for. It cannot prove the gate ran for any particular request — that
 * needs a request-level harness this app does not have.
 *
 * A hand-written list of gated pages would be worse: it stays green while a
 * page added next month sits outside it, which is a guard keyed on spelling.
 */
describe('route coverage', () => {
  const appDir = new URL('../../app/', import.meta.url);

  it('has every signed-in page under the gated group, bar the argued exemptions', async () => {
    const gated = await readdir(new URL('(app)', appDir), { recursive: true });
    const exempt = await readdir(new URL('(konto)', appDir), { recursive: true });

    // `readdir` returns platform separators; the assertions are written with
    // forward slashes so they read the same on Windows and in CI.
    const pagesIn = (entries: string[]) =>
      entries
        .map((entry) => String(entry).replace(/\\/g, '/'))
        .filter((entry) => entry.endsWith('page.tsx'))
        .sort();

    // A sanity floor: if this ever reads zero the walk has broken and every
    // assertion below would pass over an empty set.
    expect(pagesIn(gated).length).toBeGreaterThan(8);

    expect(pagesIn(exempt)).toEqual([
      'innstillinger/slett-konto/page.tsx',
      'vilkar/godta/page.tsx',
    ]);

    // The exemptions are the ones that were argued for, and nothing else has
    // drifted into the ungated group.
    expect(pagesIn(gated).some((entry) => entry.includes('slett-konto'))).toBe(false);
  });

  it('gates the signed-in layout and not the exempt one', async () => {
    const gatedLayout = await readFile(new URL('(app)/layout.tsx', appDir), 'utf8');
    const exemptLayout = await readFile(new URL('(konto)/layout.tsx', appDir), 'utf8');

    expect(gatedLayout).toContain('requireCurrentTerms()');
    expect(exemptLayout).toContain('requireUser()');
    expect(exemptLayout).not.toContain('requireCurrentTerms(');
  });
});
