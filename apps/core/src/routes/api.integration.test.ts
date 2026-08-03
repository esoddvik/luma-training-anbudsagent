import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { issueSession, SESSION_COOKIE_NAME, type Role } from '@luma/auth';
import {
  alertProfiles,
  consentEvents,
  consentTextVersions,
  industryTemplates,
  legalDocumentVersions,
  legalDocuments,
  notificationPreferences,
  orderRequests,
  sessions,
  tenderMatchReasons,
  tenderMatches,
  tenderShares,
  tenders,
  users,
} from '@luma/db';
import { createTestDatabase, hasDatabase, isCi, type TestDatabase } from '@luma/db/testing';
import { FORBIDDEN_SHARE_FIELDS, MARKETING_CONSENT_TEXT_NB } from '@luma/domain';
import { FakePostmarkClient } from '@luma/email';
import { MATCHING_VERSION } from '@luma/matching';
import { createLogger } from '@luma/observability';
import { buildApiContext } from '../services/api-context.js';
import { buildServer } from '../server.js';
import type { ApiConfig, JobRunner } from '../services/context.js';

/**
 * The HTTP API end to end, against a real PostgreSQL database (spec §46).
 *
 * The security cases carry most of the weight here: cross-user access, what
 * the public shared view does and does not contain, admin-only enforcement,
 * rate limiting, single-use login links, and consent that is only ever
 * appended to. Those are the behaviours where a regression is invisible in
 * normal use and expensive in production.
 *
 * A fresh Fastify instance is built per test. Rate-limit counters live on the
 * instance, so reusing one would make a limit test poison whatever ran next.
 */

const describeDb = hasDatabase ? describe : describe.skip;

/**
 * A second latch under the harness guard, for one specific failure.
 *
 * `@luma/db/testing` already throws at import when CI is set without a
 * database, so in the ordinary CI-without-Postgres case this file never loads
 * and the test below never runs — the collection error gets there first. That
 * makes this guard redundant *for that case*, and it is worth being precise
 * about why it stays rather than repeating the comfortable claim that the two
 * "catch different things". (They do not: with the harness guard intact,
 * `apps/core` reports four files failing to load and this test appears nowhere
 * in the output.)
 *
 * What it catches is the harness guard being narrowed or removed. If that
 * happens, `hasDatabase` goes back to being a silent `false` and every suite in
 * the repository resumes skipping quietly; this file would then still fail, and
 * `apps/core` is where the cross-user, shared-view-leak and admin-only tests
 * live. One package keeps a tripwire; it costs a few lines.
 *
 * That scenario is demonstrated, not merely argued: the `packages/db` owner
 * neutered the harness guard to `if (false && …)`, rebuilt `dist`, and ran this
 * package with `CI=true` and no `DATABASE_URL`. This test failed and took the
 * run to exit 1; without it the same configuration exits 0 with 104 tests
 * silently skipped. The guard was then restored and the matrix re-verified.
 *
 * Deliberate scope: this fallback covers *this file only*. The other three
 * integration suites in `apps/core` live under `src/jobs/`, which this agent
 * does not own, and they still skip quietly if the harness guard is weakened.
 * That is a considered limit rather than an oversight — the security tests are
 * the ones worth defending twice — but it does mean the fallback protects this
 * suite, not the package.
 *
 * `isCi` is imported rather than re-derived. An earlier version of this file
 * parsed `CI` itself with `Boolean(process.env.CI)`, drifted from the harness
 * within the hour, and failed a laptop run that was correct to skip.
 */
describe('integration coverage guard', () => {
  it('refuses to let CI pass this file by skipping it', () => {
    const skippingInCi = isCi && !hasDatabase;
    expect(
      skippingInCi
        ? 'CI reached this file with no DATABASE_URL, so every security test in it ' +
            'was skipped. The guard in packages/db/src/testing/harness.ts should have ' +
            'thrown before this point — check whether it has been narrowed or removed, ' +
            'then restore DATABASE_URL on the test job in .github/workflows/ci.yml.'
        : 'ok',
    ).toBe('ok');
  });
});

const APP_URL = 'https://anbudsvarsling.luma-training.com';
const ADMIN_EMAIL = 'drift@luma-training.com';
const SECRET = 'a'.repeat(40);

const CONFIG: ApiConfig = {
  appUrl: APP_URL,
  privacyUrl: 'https://luma-training.com/personvern',
  termsUrl: 'https://luma-training.com/vilkar',
  authSecret: SECRET,
  shareTokenSecret: `share-${SECRET}`,
  mcpTokenPepper: `mcp-${SECRET}`,
  shareDefaultTtlDays: 30,
  adminEmails: [ADMIN_EMAIL],
  authEmailFrom: 'anbudsvarsling@luma-training.com',
  billingAdminEmail: 'faktura@luma-training.com',
  currentPrivacyPolicyVersion: '2026-01',
  currentTermsVersion: '2026-01',
  currentMarketingConsentTextVersion: 'v1',
  isProduction: false,
};

const logger = createLogger({ service: 'core', silent: true });

describeDb('HTTP API', () => {
  let harness: TestDatabase;
  let db: TestDatabase['db'];
  let app: Awaited<ReturnType<typeof buildServer>>;
  let email: FakePostmarkClient;
  let clock: Date;
  let jobCalls: { ingest: number; matching: number };

  const jobs: JobRunner = {
    runIngest: async () => {
      jobCalls.ingest += 1;
      return {
        runId: crypto.randomUUID(),
        status: 'succeeded',
        fetched: 3,
        created: 1,
        updated: 2,
      };
    },
    runMatching: async () => {
      jobCalls.matching += 1;
      return { tendersConsidered: 4, profilesConsidered: 1, matchesWritten: 4 };
    },
  };

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await harness?.destroy();
  });

  beforeEach(async () => {
    await app?.close();
    clock = new Date('2026-08-10T09:00:00Z');
    email = new FakePostmarkClient({ now: () => clock });
    jobCalls = { ingest: 0, matching: 0 };

    await db.execute(
      sql`truncate table ${users}, ${tenders}, ${industryTemplates}, ${consentTextVersions},
          ${legalDocuments}, ${legalDocumentVersions} restart identity cascade`,
    );

    await db.insert(consentTextVersions).values({
      consentType: 'marketing_email',
      version: 'v1',
      body: MARKETING_CONSENT_TEXT_NB,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });

    for (const kind of ['terms', 'privacy'] as const) {
      const doc = await db
        .insert(legalDocuments)
        .values({ kind, title: kind === 'terms' ? 'Bruksvilkår' : 'Personvern' })
        .returning({ id: legalDocuments.id });
      await db.insert(legalDocumentVersions).values({
        legalDocumentId: doc[0]!.id,
        kind,
        version: '2026-01',
        body: 'Tekst.',
        isPlaceholder: false,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      });
    }

    const ctx = buildApiContext({
      db,
      email,
      logger,
      config: CONFIG,
      jobs,
      now: () => clock,
    });

    app = await buildServer({
      logger,
      allowedOrigins: [APP_URL],
      api: ctx,
    });
  });

  // --- helpers ------------------------------------------------------------

  interface Caller {
    userId: string;
    email: string;
    cookie: string;
  }

  /** Creates an account and a live session, skipping the email round trip. */
  async function signIn(address: string): Promise<Caller> {
    const inserted = await db
      .insert(users)
      .values({ email: address, role: address === ADMIN_EMAIL ? 'admin' : 'user' })
      .returning({ id: users.id });
    const userId = inserted[0]!.id;

    const session = issueSession({ pepper: SECRET, now: clock });
    await db.insert(sessions).values({
      userId,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
      lastUsedAt: clock,
    });
    await db
      .insert(notificationPreferences)
      .values({ userId })
      .onConflictDoNothing({ target: notificationPreferences.userId });

    return { userId, email: address, cookie: session.token };
  }

  interface RequestOptions {
    as?: Caller;
    body?: unknown;
    /** Omits the CSRF header, for the guard's own tests. */
    withoutCsrf?: boolean;
    origin?: string;
  }

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    options: RequestOptions = {},
  ) {
    const headers: Record<string, string> = { origin: options.origin ?? APP_URL };
    if (!options.withoutCsrf) headers['x-luma-csrf'] = '1';

    return app.inject({
      method,
      url,
      headers,
      ...(options.body !== undefined ? { payload: options.body } : {}),
      ...(options.as ? { cookies: { [SESSION_COOKIE_NAME]: options.as.cookie } } : {}),
    });
  }

  let tenderSequence = 0;

  async function seedTender(overrides: Partial<typeof tenders.$inferInsert> = {}) {
    tenderSequence += 1;
    const rows = await db
      .insert(tenders)
      .values({
        source: 'doffin',
        sourceId: `2026-9000${tenderSequence}`,
        sourceUrl: `https://doffin.no/notices/2026-9000${tenderSequence}`,
        title: 'Rehabilitering av Sandvika skole',
        description: 'Bærum kommune skal rehabilitere Sandvika skole.',
        buyerName: 'Bærum kommune',
        noticeCategory: 'competition',
        status: 'open',
        publishedAt: new Date('2026-08-09T06:00:00Z'),
        deadlineAt: new Date('2026-09-15T12:00:00Z'),
        sourcePayloadHash: `hash-${tenderSequence}`,
        rawPayload: { id: `2026-9000${tenderSequence}` },
        ...overrides,
      })
      .returning({ id: tenders.id });
    return rows[0]!.id;
  }

  async function seedProfile(caller: Caller, name = 'Bygg og rehabilitering') {
    const rows = await db
      .insert(alertProfiles)
      .values({ userId: caller.userId, name, minimumMatchScore: 10 })
      .returning({ id: alertProfiles.id });
    return rows[0]!.id;
  }

  /** A stored match with one reason, as the matching job would have written it. */
  async function seedMatch(profileId: string, tenderId: string, included = true) {
    const rows = await db
      .insert(tenderMatches)
      .values({
        tenderId,
        alertProfileId: profileId,
        score: 72,
        confidence: 'high',
        included,
        matchingVersion: MATCHING_VERSION,
      })
      .returning({ id: tenderMatches.id });
    const matchId = rows[0]!.id;

    await db.insert(tenderMatchReasons).values({
      matchId,
      entryType: 'reason',
      reasonType: 'cpv',
      typeKey: 'cpv',
      label: 'Treffer CPV-koden 45000000',
      contribution: 40,
      evidence: ['45000000'],
      sortOrder: 0,
    });
    return matchId;
  }

  function profileBody(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Bygg i Viken',
      active: true,
      cpvInclude: ['45000000'],
      cpvExclude: [],
      keywordsInclude: ['rehabilitering'],
      keywordsExclude: [],
      regionsInclude: ['NO082'],
      municipalitiesInclude: [],
      buyerInclude: [],
      buyerExclude: [],
      noticeTypes: [],
      procedureTypes: [],
      includePlannedProcurements: true,
      frequency: 'daily',
      digestHourLocal: 7,
      timezone: 'Europe/Oslo',
      minimumMatchScore: 20,
      ...overrides,
    };
  }

  // --- authentication -----------------------------------------------------

  describe('POST /api/v1/auth/request-link', () => {
    it('answers identically for a known and an unknown address', async () => {
      await signIn('kjent@entreprenor.no');

      const known = await call('POST', '/api/v1/auth/request-link', {
        body: { email: 'kjent@entreprenor.no' },
      });
      const unknown = await call('POST', '/api/v1/auth/request-link', {
        body: { email: 'ukjent@entreprenor.no' },
      });

      // Same status and same body. The login form must not be usable as a
      // customer list (spec §10).
      expect(known.statusCode).toBe(202);
      expect(unknown.statusCode).toBe(202);
      expect(unknown.body).toBe(known.body);
      expect(known.json().message).toMatch(/Hvis adressen er registrert/);
    });

    it('sends the link on the transactional stream, and only to a real account', async () => {
      await signIn('kjent@entreprenor.no');
      await call('POST', '/api/v1/auth/request-link', { body: { email: 'kjent@entreprenor.no' } });
      await call('POST', '/api/v1/auth/request-link', { body: { email: 'ukjent@entreprenor.no' } });

      expect(email.sent).toHaveLength(1);
      expect(email.sent[0]?.stream).toBe('transactional');
      expect(email.sent[0]?.template).toBe('auth-magic-link-v1');
      expect(email.sent[0]?.to).toBe('kjent@entreprenor.no');
    });

    it('rate limits by address, not only by client', async () => {
      await signIn('spam@entreprenor.no');
      const attempts = [];
      for (let i = 0; i < 6; i += 1) {
        attempts.push(
          await call('POST', '/api/v1/auth/request-link', {
            body: { email: 'spam@entreprenor.no' },
          }),
        );
      }

      expect(attempts.slice(0, 5).map((r) => r.statusCode)).toEqual([202, 202, 202, 202, 202]);
      expect(attempts[5]?.statusCode).toBe(429);
      expect(attempts[5]?.json().error.code).toBe('rate_limited');
      expect(email.sent).toHaveLength(5);
    });
  });

  describe('POST /api/v1/auth/redeem', () => {
    /** Pulls the token out of the email the way a user's mail client would. */
    async function requestAndExtractToken(address: string): Promise<string> {
      await call('POST', '/api/v1/auth/request-link', { body: { email: address } });
      const sent = email.lastSent();
      const match = /token=([A-Za-z0-9_-]+)/.exec(sent?.text ?? '');
      if (!match?.[1]) throw new Error('no magic link token in the sent email');
      return match[1];
    }

    it('opens a session and sets the cookie', async () => {
      await signIn('bruker@entreprenor.no');
      const token = await requestAndExtractToken('bruker@entreprenor.no');

      const response = await call('POST', '/api/v1/auth/redeem', { body: { token } });

      expect(response.statusCode).toBe(200);
      expect(response.json().user.email).toBe('bruker@entreprenor.no');

      const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
      expect(cookie).toBeDefined();
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
      expect(cookie?.path).toBe('/');
    });

    it('is single use', async () => {
      await signIn('engang@entreprenor.no');
      const token = await requestAndExtractToken('engang@entreprenor.no');

      expect((await call('POST', '/api/v1/auth/redeem', { body: { token } })).statusCode).toBe(200);

      const second = await call('POST', '/api/v1/auth/redeem', { body: { token } });
      expect(second.statusCode).toBe(401);
      expect(second.json().error.code).toBe('magic_link_already_used');
      expect(second.json().error.message).toMatch(/allerede brukt/);
    });

    it('rejects a token that was never issued', async () => {
      const response = await call('POST', '/api/v1/auth/redeem', {
        body: { token: 'x'.repeat(43) },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('magic_link_invalid');
    });
  });

  describe('logout', () => {
    it('ends this session', async () => {
      const user = await signIn('utlogg@entreprenor.no');
      expect((await call('GET', '/api/v1/me', { as: user })).statusCode).toBe(200);

      expect((await call('POST', '/api/v1/auth/logout', { as: user })).statusCode).toBe(200);
      expect((await call('GET', '/api/v1/me', { as: user })).statusCode).toBe(401);
    });

    it('ends every session (spec §10)', async () => {
      const first = await signIn('mange@entreprenor.no');
      const second = issueSession({ pepper: SECRET, now: clock });
      await db.insert(sessions).values({
        userId: first.userId,
        tokenHash: second.tokenHash,
        expiresAt: second.expiresAt,
        lastUsedAt: clock,
      });
      const otherDevice: Caller = { ...first, cookie: second.token };

      const response = await call('POST', '/api/v1/auth/logout-all', { as: first });
      expect(response.json().revokedSessions).toBe(2);
      expect((await call('GET', '/api/v1/me', { as: otherDevice })).statusCode).toBe(401);
    });
  });

  describe('authentication', () => {
    it('refuses an anonymous read of an account resource', async () => {
      const response = await call('GET', '/api/v1/me');
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('unauthenticated');
      expect(response.json().error.message).toMatch(/logge inn/);
    });
  });

  // --- CSRF ---------------------------------------------------------------

  describe('CSRF protection', () => {
    it('refuses a state-changing request without the custom header', async () => {
      const user = await signIn('csrf@entreprenor.no');
      const response = await call('POST', '/api/v1/alert-profiles', {
        as: user,
        body: profileBody(),
        withoutCsrf: true,
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('csrf_header_missing');
    });

    it('refuses a state-changing request from a foreign origin', async () => {
      const user = await signIn('origin@entreprenor.no');
      const response = await call('POST', '/api/v1/alert-profiles', {
        as: user,
        body: profileBody(),
        origin: 'https://angriper.example',
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('csrf_origin_rejected');
    });

    it('leaves reads alone', async () => {
      const user = await signIn('les@entreprenor.no');
      const response = await call('GET', '/api/v1/me', { as: user, withoutCsrf: true });
      expect(response.statusCode).toBe(200);
    });
  });

  // --- alert profiles -----------------------------------------------------

  describe('/api/v1/alert-profiles', () => {
    it('creates, reads back and lists a profile', async () => {
      const user = await signIn('profil@entreprenor.no');

      const created = await call('POST', '/api/v1/alert-profiles', {
        as: user,
        body: profileBody(),
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().id;

      const fetched = await call('GET', `/api/v1/alert-profiles/${id}`, { as: user });
      expect(fetched.json()).toMatchObject({
        name: 'Bygg i Viken',
        cpvInclude: ['45000000'],
        keywordsInclude: ['rehabilitering'],
        regionsInclude: ['NO082'],
      });

      const list = await call('GET', '/api/v1/alert-profiles', { as: user });
      expect(list.json().items).toHaveLength(1);
    });

    it('rejects an invalid body in Norwegian with a machine-readable code', async () => {
      const user = await signIn('ugyldig@entreprenor.no');
      const response = await call('POST', '/api/v1/alert-profiles', {
        as: user,
        body: profileBody({ digestHourLocal: 99, name: '' }),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('validation_error');
      expect(response.json().error.message).toMatch(/^Forespørselen mangler eller har ugyldige/);
    });

    it('rejects a value floor above its ceiling', async () => {
      const user = await signIn('intervall@entreprenor.no');
      const response = await call('POST', '/api/v1/alert-profiles', {
        as: user,
        body: profileBody({ estimatedValueMinNok: 900, estimatedValueMaxNok: 100 }),
      });
      expect(response.statusCode).toBe(400);
    });

    it('paginates with a cursor and caps the limit', async () => {
      const user = await signIn('sider@entreprenor.no');
      await seedProfile(user, 'Første');
      clock = new Date('2026-08-10T10:00:00Z');
      await seedProfile(user, 'Andre');

      const first = await call('GET', '/api/v1/alert-profiles?limit=1', { as: user });
      expect(first.json().items).toHaveLength(1);
      expect(first.json().nextCursor).toBeTruthy();

      const second = await call(
        'GET',
        `/api/v1/alert-profiles?limit=1&cursor=${encodeURIComponent(first.json().nextCursor)}`,
        { as: user },
      );
      expect(second.json().items).toHaveLength(1);
      expect(second.json().items[0].id).not.toBe(first.json().items[0].id);

      const tooMany = await call('GET', '/api/v1/alert-profiles?limit=5000', { as: user });
      expect(tooMany.statusCode).toBe(400);
      expect(tooMany.json().error.code).toBe('validation_error');
    });

    it('previews matches without writing any', async () => {
      const user = await signIn('forhaandsvis@entreprenor.no');
      await seedTender();
      const created = await call('POST', '/api/v1/alert-profiles', {
        as: user,
        body: profileBody({ keywordsInclude: ['rehabilitering'], minimumMatchScore: 1 }),
      });

      const preview = await call('POST', `/api/v1/alert-profiles/${created.json().id}/preview`, {
        as: user,
        body: {},
      });

      expect(preview.statusCode).toBe(200);
      expect(preview.json().tendersEvaluated).toBe(1);
      expect(preview.json().matchingVersion).toBe(MATCHING_VERSION);
      // Preview must not create rows the digest would then treat as new.
      expect(await db.$count(tenderMatches)).toBe(0);
    });

    it('previews unsaved edits without saving them', async () => {
      const user = await signIn('utkast@entreprenor.no');
      await seedTender();
      const created = await call('POST', '/api/v1/alert-profiles', {
        as: user,
        body: profileBody(),
      });
      const id = created.json().id;

      await call('POST', `/api/v1/alert-profiles/${id}/preview`, {
        as: user,
        body: { name: 'Et helt annet navn', keywordsInclude: ['brolegging'] },
      });

      const stored = await call('GET', `/api/v1/alert-profiles/${id}`, { as: user });
      expect(stored.json().name).toBe('Bygg i Viken');
      expect(stored.json().keywordsInclude).toEqual(['rehabilitering']);
    });

    it('soft-deletes rather than removing the row', async () => {
      const user = await signIn('slett@entreprenor.no');
      const id = await seedProfile(user);

      expect((await call('DELETE', `/api/v1/alert-profiles/${id}`, { as: user })).statusCode).toBe(
        204,
      );
      expect((await call('GET', `/api/v1/alert-profiles/${id}`, { as: user })).statusCode).toBe(
        404,
      );

      const rows = await db.select().from(alertProfiles).where(eq(alertProfiles.id, id));
      expect(rows[0]?.deletedAt).not.toBeNull();
    });
  });

  // --- cross-user isolation ----------------------------------------------

  describe('one user cannot reach another user data', () => {
    it('refuses to read, change or delete a foreign alert profile', async () => {
      const owner = await signIn('eier@entreprenor.no');
      const intruder = await signIn('inntrenger@entreprenor.no');
      const profileId = await seedProfile(owner);

      const read = await call('GET', `/api/v1/alert-profiles/${profileId}`, { as: intruder });
      expect(read.statusCode).toBe(403);
      expect(read.json().error.code).toBe('forbidden');
      expect(read.body).not.toContain('Bygg og rehabilitering');

      expect(
        (
          await call('PATCH', `/api/v1/alert-profiles/${profileId}`, {
            as: intruder,
            body: { name: 'Kapret' },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await call('DELETE', `/api/v1/alert-profiles/${profileId}`, { as: intruder })).statusCode,
      ).toBe(403);

      const stored = await db.select().from(alertProfiles).where(eq(alertProfiles.id, profileId));
      expect(stored[0]?.name).toBe('Bygg og rehabilitering');
      expect(stored[0]?.deletedAt).toBeNull();
    });

    it('refuses to read or save a tender the caller has no match for', async () => {
      const owner = await signIn('anbudseier@entreprenor.no');
      const intruder = await signIn('anbudstyv@entreprenor.no');
      const tenderId = await seedTender();
      await seedMatch(await seedProfile(owner), tenderId);

      // 404 rather than 403: a 403 would confirm that the id is real and that
      // somebody else is watching it.
      expect((await call('GET', `/api/v1/tenders/${tenderId}`, { as: intruder })).statusCode).toBe(
        404,
      );
      expect(
        (await call('POST', `/api/v1/tenders/${tenderId}/save`, { as: intruder })).statusCode,
      ).toBe(404);
      expect(
        (
          await call('POST', `/api/v1/tenders/${tenderId}/feedback`, {
            as: intruder,
            body: { verdict: 'not_relevant' },
          })
        ).statusCode,
      ).toBe(404);
    });

    it('keeps saved tenders out of another user list', async () => {
      const owner = await signIn('lagrer@entreprenor.no');
      const other = await signIn('annen@entreprenor.no');
      const tenderId = await seedTender();
      await seedMatch(await seedProfile(owner), tenderId);
      await seedProfile(other);

      await call('POST', `/api/v1/tenders/${tenderId}/save`, { as: owner });

      expect(
        (await call('GET', '/api/v1/tenders?state=saved', { as: owner })).json().items,
      ).toHaveLength(1);
      expect(
        (await call('GET', '/api/v1/tenders?state=saved', { as: other })).json().items,
      ).toHaveLength(0);
      expect((await call('GET', '/api/v1/tenders', { as: other })).json().items).toHaveLength(0);
    });

    it('refuses to revoke a foreign share or MCP token', async () => {
      const owner = await signIn('deler@entreprenor.no');
      const intruder = await signIn('tyv@entreprenor.no');
      const tenderId = await seedTender();
      await seedMatch(await seedProfile(owner), tenderId);

      const share = await call('POST', `/api/v1/tenders/${tenderId}/share`, {
        as: owner,
        body: {},
      });
      const token = await call('POST', '/api/v1/mcp-tokens', {
        as: owner,
        body: { name: 'Claude', scopes: ['tenders:read'] },
      });

      expect(
        (await call('POST', `/api/v1/shares/${share.json().id}/revoke`, { as: intruder }))
          .statusCode,
      ).toBe(403);
      expect(
        (await call('POST', `/api/v1/mcp-tokens/${token.json().id}/revoke`, { as: intruder }))
          .statusCode,
      ).toBe(403);

      // And the resources are untouched.
      const shareRows = await db.select().from(tenderShares);
      expect(shareRows[0]?.revokedAt).toBeNull();
    });

    it('keeps MCP tokens and shares out of another user listing', async () => {
      const owner = await signIn('mcpeier@entreprenor.no');
      const other = await signIn('mcpannen@entreprenor.no');
      const tenderId = await seedTender();
      await seedMatch(await seedProfile(owner), tenderId);
      await call('POST', `/api/v1/tenders/${tenderId}/share`, { as: owner, body: {} });
      await call('POST', '/api/v1/mcp-tokens', {
        as: owner,
        body: { name: 'Claude', scopes: ['tenders:read'] },
      });

      expect((await call('GET', '/api/v1/shares', { as: other })).json().items).toHaveLength(0);
      expect((await call('GET', '/api/v1/mcp-tokens', { as: other })).json().items).toHaveLength(0);
    });
  });

  // --- tenders ------------------------------------------------------------

  describe('/api/v1/tenders', () => {
    it('lists a matched tender once, even across several profiles', async () => {
      const user = await signIn('flere@entreprenor.no');
      const tenderId = await seedTender();
      await seedMatch(await seedProfile(user, 'Profil A'), tenderId);
      await seedMatch(await seedProfile(user, 'Profil B'), tenderId);

      const list = await call('GET', '/api/v1/tenders', { as: user });
      expect(list.json().items).toHaveLength(1);
      expect(list.json().items[0].score).toBe(72);
    });

    it('shows the stored explanation on the detail view', async () => {
      const user = await signIn('forklaring@entreprenor.no');
      const tenderId = await seedTender();
      await seedMatch(await seedProfile(user), tenderId);

      const detail = await call('GET', `/api/v1/tenders/${tenderId}`, { as: user });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().matches[0].reasons[0]).toMatchObject({
        type: 'cpv',
        label: 'Treffer CPV-koden 45000000',
        evidence: ['45000000'],
      });
    });

    it('hides dismissed tenders from the default list but keeps them retrievable', async () => {
      const user = await signIn('avvist@entreprenor.no');
      const tenderId = await seedTender();
      await seedMatch(await seedProfile(user), tenderId);

      await call('POST', `/api/v1/tenders/${tenderId}/dismiss`, { as: user });

      expect((await call('GET', '/api/v1/tenders', { as: user })).json().items).toHaveLength(0);
      expect(
        (await call('GET', '/api/v1/tenders?state=dismissed', { as: user })).json().items,
      ).toHaveLength(1);
    });

    it('records relevance feedback against the matching version', async () => {
      const user = await signIn('tilbakemelding@entreprenor.no');
      const tenderId = await seedTender();
      await seedMatch(await seedProfile(user), tenderId);

      const response = await call('POST', `/api/v1/tenders/${tenderId}/feedback`, {
        as: user,
        body: { verdict: 'wrong_geography', comment: 'Feil fylke for oss.' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        verdict: 'wrong_geography',
        matchingVersion: MATCHING_VERSION,
      });
    });

    it('rejects a verdict that is not in the approved list', async () => {
      const user = await signIn('ugyldigverdikt@entreprenor.no');
      const tenderId = await seedTender();
      await seedMatch(await seedProfile(user), tenderId);

      const response = await call('POST', `/api/v1/tenders/${tenderId}/feedback`, {
        as: user,
        body: { verdict: 'kjempebra' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('validation_error');
    });
  });

  // --- the public shared view --------------------------------------------

  describe('GET /api/v1/shared/:token', () => {
    async function createShare() {
      const owner = await signIn('delingseier@entreprenor.no');
      const tenderId = await seedTender();
      await seedMatch(await seedProfile(owner, 'Hemmelig profilnavn'), tenderId);
      const created = await call('POST', `/api/v1/tenders/${tenderId}/share`, {
        as: owner,
        body: {},
      });
      const url: string = created.json().url;
      const token = url.slice(url.lastIndexOf('/') + 1);
      return { owner, tenderId, shareId: created.json().id as string, token };
    }

    it('is readable without a session', async () => {
      const { token } = await createShare();
      const response = await app.inject({ method: 'GET', url: `/api/v1/shared/${token}` });

      expect(response.statusCode).toBe(200);
      expect(response.json().tender.title).toBe('Rehabilitering av Sandvika skole');
      expect(response.json().invitation.heading).toMatch(/anbudsvarsler/);
      expect(response.headers['x-robots-tag']).toContain('noindex');
    });

    it('leaks nothing about the sharer', async () => {
      const { owner, shareId, token } = await createShare();
      const response = await app.inject({ method: 'GET', url: `/api/v1/shared/${token}` });
      const body = response.body;

      // The declared forbidden field names, from the domain package.
      for (const field of FORBIDDEN_SHARE_FIELDS) {
        expect(body).not.toContain(field);
      }
      // And the sharer's actual identity, by value rather than by field name.
      expect(body).not.toContain(owner.userId);
      expect(body).not.toContain(owner.email);
      expect(body).not.toContain('entreprenor.no');
      expect(body).not.toContain('Hemmelig profilnavn');
      expect(body).not.toContain(shareId);
      expect(body).not.toContain(token);

      // The reason *types* are there; the profile values behind them are not.
      expect(response.json().tender.matchReasonTypes).toEqual(['cpv']);
      expect(body).not.toContain('45000000');
    });

    it('counts a view', async () => {
      const { token, shareId } = await createShare();
      await app.inject({ method: 'GET', url: `/api/v1/shared/${token}` });
      await app.inject({ method: 'GET', url: `/api/v1/shared/${token}` });

      const rows = await db.select().from(tenderShares).where(eq(tenderShares.id, shareId));
      expect(rows[0]?.viewCount).toBe(2);
    });

    it('answers 410 for revoked, expired and unknown alike, never 404', async () => {
      const { owner, shareId, token } = await createShare();

      const revoke = await call('POST', `/api/v1/shares/${shareId}/revoke`, { as: owner });
      expect(revoke.statusCode).toBe(200);

      const revoked = await app.inject({ method: 'GET', url: `/api/v1/shared/${token}` });
      const unknown = await app.inject({
        method: 'GET',
        url: `/api/v1/shared/${'z'.repeat(43)}`,
      });

      expect(revoked.statusCode).toBe(410);
      expect(unknown.statusCode).toBe(410);
      // Byte-identical: the two cases must be indistinguishable to an
      // enumerator (spec §40).
      expect(unknown.body).toBe(revoked.body);
      expect(revoked.json().error.message).toMatch(/utløpt eller blitt opphevet/);
      expect(revoked.body).not.toContain('Sandvika');
    });

    it('answers 410 once the link has expired', async () => {
      const { token } = await createShare();
      clock = new Date('2026-10-01T09:00:00Z');

      const response = await app.inject({ method: 'GET', url: `/api/v1/shared/${token}` });
      expect(response.statusCode).toBe(410);
      expect(response.body).not.toContain('Sandvika');
    });

    it('stops working the moment an administrator suppresses the tender', async () => {
      const { tenderId, token } = await createShare();
      const admin = await signIn(ADMIN_EMAIL);

      expect((await app.inject({ method: 'GET', url: `/api/v1/shared/${token}` })).statusCode).toBe(
        200,
      );
      await call('POST', `/api/v1/admin/tenders/${tenderId}/suppress`, {
        as: admin,
        body: { reason: 'Feilaktig kunngjøring fra oppdragsgiver.' },
      });
      expect((await app.inject({ method: 'GET', url: `/api/v1/shared/${token}` })).statusCode).toBe(
        410,
      );
    });

    it('is rate limited against enumeration', async () => {
      const responses = [];
      for (let i = 0; i < 32; i += 1) {
        responses.push(
          await app.inject({ method: 'GET', url: `/api/v1/shared/${'q'.repeat(40)}${i}` }),
        );
      }

      // 30 a minute: a real recipient opens a link once, a prober does not.
      expect(responses.filter((r) => r.statusCode === 429).length).toBeGreaterThan(0);
      expect(responses[31]?.json().error.code).toBe('rate_limited');
      expect(responses[31]?.json().error.message).toMatch(/For mange forespørsler/);
    });

    it('does not return the token again after creation', async () => {
      const { owner, token } = await createShare();
      const list = await call('GET', '/api/v1/shares', { as: owner });

      expect(list.json().items).toHaveLength(1);
      expect(list.body).not.toContain(token);
      expect(list.json().items[0].active).toBe(true);
    });
  });

  // --- MCP tokens ---------------------------------------------------------

  describe('/api/v1/mcp-tokens', () => {
    it('returns the token once and never again', async () => {
      const user = await signIn('mcp@entreprenor.no');
      const created = await call('POST', '/api/v1/mcp-tokens', {
        as: user,
        body: { name: 'Claude Desktop', scopes: ['tenders:read', 'saved:write'] },
      });

      expect(created.statusCode).toBe(201);
      const token: string = created.json().token;
      expect(token).toMatch(/^luma_mcp_/);

      const list = await call('GET', '/api/v1/mcp-tokens', { as: user });
      expect(list.json().items[0]).toMatchObject({ name: 'Claude Desktop' });
      expect(list.body).not.toContain(token);
      expect(list.json().items[0].token).toBeUndefined();
    });

    it('refuses a scope the MVP does not grant', async () => {
      const user = await signIn('scope@entreprenor.no');
      const response = await call('POST', '/api/v1/mcp-tokens', {
        as: user,
        body: { name: 'Skriver', scopes: ['profiles:write'] },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('scope_not_available');
    });

    it('revokes', async () => {
      const user = await signIn('tilbakekall@entreprenor.no');
      const created = await call('POST', '/api/v1/mcp-tokens', {
        as: user,
        body: { name: 'Gammel', scopes: ['tenders:read'] },
      });

      const revoked = await call('POST', `/api/v1/mcp-tokens/${created.json().id}/revoke`, {
        as: user,
      });
      expect(revoked.statusCode).toBe(200);

      const list = await call('GET', '/api/v1/mcp-tokens', { as: user });
      expect(list.json().items[0].revokedAt).not.toBeNull();
    });
  });

  // --- consent ------------------------------------------------------------

  describe('consent is append-only', () => {
    it('records a withdrawal as a new event and leaves the first untouched', async () => {
      const user = await signIn('samtykke@entreprenor.no');

      const granted = await call('POST', '/api/v1/consents', {
        as: user,
        body: { consentType: 'marketing_email', status: 'granted', source: 'signup' },
      });
      expect(granted.statusCode).toBe(201);

      const before = await db.select().from(consentEvents);
      expect(before).toHaveLength(1);
      const firstRow = { ...before[0]! };

      clock = new Date('2026-08-11T09:00:00Z');
      await call('POST', '/api/v1/consents', {
        as: user,
        body: { consentType: 'marketing_email', status: 'withdrawn' },
      });

      const after = await db.select().from(consentEvents).orderBy(consentEvents.occurredAt);
      expect(after).toHaveLength(2);
      // Byte-identical: withdrawal must not have edited the evidence.
      expect(after[0]).toEqual(firstRow);
      expect(after[1]?.status).toBe('withdrawn');

      const state = await call('GET', '/api/v1/consents', { as: user });
      expect(state.json().current.marketing_email).toBe(false);
      expect(state.json().history).toHaveLength(2);
    });

    it('re-granting appends a third event', async () => {
      const user = await signIn('paanytt@entreprenor.no');
      for (const [index, status] of ['granted', 'withdrawn', 'granted'].entries()) {
        clock = new Date(Date.UTC(2026, 7, 10 + index, 9));
        await call('POST', '/api/v1/consents', {
          as: user,
          body: { consentType: 'marketing_email', status },
        });
      }

      expect(await db.$count(consentEvents)).toBe(3);
      expect(
        (await call('GET', '/api/v1/consents', { as: user })).json().current.marketing_email,
      ).toBe(true);
    });

    it('stores the exact text version, the source and the time', async () => {
      const user = await signIn('versjon@entreprenor.no');
      await call('POST', '/api/v1/consents', {
        as: user,
        body: { consentType: 'marketing_email', status: 'granted', source: 'signup' },
      });

      const rows = await db.select().from(consentEvents);
      expect(rows[0]).toMatchObject({
        consentTextVersion: 'v1',
        source: 'signup',
        policyVersion: '2026-01',
        termsVersion: '2026-01',
      });
      expect(rows[0]?.occurredAt.toISOString()).toBe('2026-08-10T09:00:00.000Z');
      // Data minimisation: the address is hashed, never stored (spec §40).
      expect(rows[0]?.ipAddressHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects an unknown consent text version instead of leaking the constraint', async () => {
      const user = await signIn('ukjentversjon@entreprenor.no');
      const response = await call('POST', '/api/v1/consents', {
        as: user,
        body: {
          consentType: 'marketing_email',
          status: 'granted',
          consentTextVersion: 'finnes-ikke',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('consent_text_version_unknown');
      expect(response.body).not.toMatch(/consent_events|foreign key|fk/i);
    });

    it('withdrawing marketing consent does not disable tender alerts', async () => {
      const user = await signIn('varsler@entreprenor.no');
      await call('PATCH', '/api/v1/notification-preferences', {
        as: user,
        body: { marketingEmailConsent: true },
      });

      clock = new Date('2026-08-11T09:00:00Z');
      const after = await call('PATCH', '/api/v1/notification-preferences', {
        as: user,
        body: { marketingEmailConsent: false },
      });

      // The whole point of ADR-0009 rule 6, stated as an assertion.
      expect(after.json().marketingEmailConsent).toBe(false);
      expect(after.json().tenderAlertsEnabled).toBe(true);
      expect(after.json().digestEnabled).toBe(true);

      const stored = await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, user.userId));
      expect(stored[0]?.tenderAlertsEnabled).toBe(true);
    });

    it('turning off tender alerts does not touch marketing consent', async () => {
      const user = await signIn('avmeld@entreprenor.no');
      await call('POST', '/api/v1/consents', {
        as: user,
        body: { consentType: 'marketing_email', status: 'granted', source: 'signup' },
      });

      const after = await call('PATCH', '/api/v1/notification-preferences', {
        as: user,
        body: { tenderAlertsEnabled: false },
      });

      expect(after.json().tenderAlertsEnabled).toBe(false);
      expect(after.json().marketingEmailConsent).toBe(true);
      // No second consent event was written.
      expect(await db.$count(consentEvents)).toBe(1);
    });

    it('does not append an event when the marketing box did not change', async () => {
      const user = await signIn('uendret@entreprenor.no');
      await call('PATCH', '/api/v1/notification-preferences', {
        as: user,
        body: { marketingEmailConsent: false },
      });
      expect(await db.$count(consentEvents)).toBe(0);
    });
  });

  // --- legal acceptances --------------------------------------------------

  describe('/api/v1/legal-acceptances', () => {
    it('reports what is outstanding and records an acceptance', async () => {
      const user = await signIn('vilkaar@entreprenor.no');

      const before = await call('GET', '/api/v1/legal-acceptances', { as: user });
      expect(before.json().items).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'terms', outstanding: true })]),
      );

      const accepted = await call('POST', '/api/v1/legal-acceptances', {
        as: user,
        body: { kind: 'terms' },
      });
      expect(accepted.statusCode).toBe(201);
      expect(accepted.json().version).toBe('2026-01');

      const after = await call('GET', '/api/v1/legal-acceptances', { as: user });
      const terms = after.json().items.find((item: { kind: string }) => item.kind === 'terms');
      expect(terms.outstanding).toBe(false);
    });

    it('rejects an unknown version', async () => {
      const user = await signIn('ukjentvilkaar@entreprenor.no');
      const response = await call('POST', '/api/v1/legal-acceptances', {
        as: user,
        body: { kind: 'terms', version: '1999-01' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('legal_version_unknown');
    });
  });

  // --- order requests -----------------------------------------------------

  describe('/api/v1/order-requests', () => {
    const order = {
      productCode: 'paafyll',
      productName: 'Påfyll',
      billingCompanyName: 'Entreprenør AS',
      organizationNumber: '123456789',
      billingAddress: 'Storgata 1',
      billingPostalCode: '0155',
      billingCity: 'Oslo',
      billingCountry: 'Norge',
      invoiceEmail: 'faktura@entreprenor.no',
      contactPerson: 'Kari Nordmann',
    };

    it('creates the request, confirms it and notifies the billing administrator', async () => {
      const user = await signIn('bestiller@entreprenor.no');
      const response = await call('POST', '/api/v1/order-requests', { as: user, body: order });

      expect(response.statusCode).toBe(201);
      expect(response.json().order.status).toBe('received');
      expect(response.json().copy.paymentMethod).toBe('Betaling med faktura');

      const recipients = email.sent.map((sent) => sent.to);
      expect(recipients).toContain('bestiller@entreprenor.no');
      expect(recipients).toContain(CONFIG.billingAdminEmail);
      expect(email.sent.every((sent) => sent.stream === 'transactional')).toBe(true);
    });

    it('validates the organisation number', async () => {
      const user = await signIn('orgnr@entreprenor.no');
      const response = await call('POST', '/api/v1/order-requests', {
        as: user,
        body: { ...order, organizationNumber: '12345' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('validation_error');
    });

    it('is rate limited well below the global default', async () => {
      const user = await signIn('mangebestillinger@entreprenor.no');
      const statuses = [];
      for (let i = 0; i < 6; i += 1) {
        statuses.push(
          (await call('POST', '/api/v1/order-requests', { as: user, body: order })).statusCode,
        );
      }
      expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
      expect(statuses[5]).toBe(429);
    });

    it('does not show one customer another customer order', async () => {
      const user = await signIn('minbestilling@entreprenor.no');
      const other = await signIn('annenbestilling@entreprenor.no');
      const created = await call('POST', '/api/v1/order-requests', { as: user, body: order });

      const read = await call('GET', `/api/v1/order-requests/${created.json().order.id}`, {
        as: other,
      });
      expect(read.statusCode).toBe(403);
      expect(
        (await call('GET', '/api/v1/order-requests', { as: other })).json().items,
      ).toHaveLength(0);
    });

    describe('admin handling', () => {
      async function placeOrder() {
        const customer = await signIn('kunde@entreprenor.no');
        const created = await call('POST', '/api/v1/order-requests', {
          as: customer,
          body: order,
        });
        email.reset();
        return { customer, orderId: created.json().order.id as string };
      }

      it('moves the order and writes an audit event for the change', async () => {
        const { orderId } = await placeOrder();
        const admin = await signIn(ADMIN_EMAIL);

        const response = await call('PATCH', `/api/v1/admin/order-requests/${orderId}`, {
          as: admin,
          body: { status: 'in_progress', adminNote: 'Faktura sendes i dag.' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().status).toBe('in_progress');

        const audit = await call('GET', '/api/v1/admin/audit-events', { as: admin });
        expect(audit.json().items[0]).toMatchObject({
          action: 'order_request.status_changed',
          entityType: 'order_request',
          entityId: orderId,
        });
      });

      it('refuses a transition the domain forbids', async () => {
        const { orderId } = await placeOrder();
        const admin = await signIn(ADMIN_EMAIL);

        // received -> activated skips handling, so the audit trail could never
        // say who processed it (spec §28.2 step 6).
        const response = await call('PATCH', `/api/v1/admin/order-requests/${orderId}`, {
          as: admin,
          body: { status: 'activated' },
        });

        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe('order_transition_not_allowed');

        const rows = await db.select().from(orderRequests).where(eq(orderRequests.id, orderId));
        expect(rows[0]?.status).toBe('received');
      });

      it('activates through the provider and sends the activation email', async () => {
        const { orderId } = await placeOrder();
        const admin = await signIn(ADMIN_EMAIL);

        await call('PATCH', `/api/v1/admin/order-requests/${orderId}`, {
          as: admin,
          body: { status: 'in_progress' },
        });
        const activated = await call('PATCH', `/api/v1/admin/order-requests/${orderId}`, {
          as: admin,
          body: { status: 'activated' },
        });

        expect(activated.json().status).toBe('activated');
        expect(email.sentWithTemplate('paid-access-activated-v1')).toHaveLength(1);
        expect(email.lastSent()?.to).toBe('kunde@entreprenor.no');

        const rows = await db.select().from(orderRequests).where(eq(orderRequests.id, orderId));
        expect(rows[0]?.handledByAdminId).toBe(
          (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)))[0]?.id,
        );
      });

      it('refuses a non-admin', async () => {
        const { orderId, customer } = await placeOrder();
        const response = await call('PATCH', `/api/v1/admin/order-requests/${orderId}`, {
          as: customer,
          body: { status: 'in_progress' },
        });

        expect(response.statusCode).toBe(403);
        expect(response.json().error.code).toBe('forbidden');
      });
    });
  });

  // --- admin --------------------------------------------------------------

  describe('/api/v1/admin/*', () => {
    const adminRoutes: ReadonlyArray<['GET' | 'POST', string, unknown]> = [
      ['GET', '/api/v1/admin/ingest-status', undefined],
      ['POST', '/api/v1/admin/ingest/run', {}],
      ['POST', '/api/v1/admin/matching/run', {}],
      ['GET', '/api/v1/admin/order-requests', undefined],
      ['GET', '/api/v1/admin/audit-events', undefined],
    ];

    it('refuses every admin route to a signed-in non-admin', async () => {
      const user = await signIn('vanlig@entreprenor.no');
      for (const [method, url, body] of adminRoutes) {
        const response = await call(method, url, {
          as: user,
          ...(body !== undefined ? { body } : {}),
        });
        expect({ url, status: response.statusCode }).toEqual({ url, status: 403 });
        expect(response.json().error.code).toBe('forbidden');
      }
      // Nothing ran.
      expect(jobCalls).toEqual({ ingest: 0, matching: 0 });
    });

    it('refuses every admin route to an anonymous caller', async () => {
      for (const [method, url, body] of adminRoutes) {
        const response = await call(method, url, {
          ...(body !== undefined ? { body } : {}),
        });
        expect(response.statusCode).toBe(401);
      }
    });

    it('reports ingest status', async () => {
      const admin = await signIn(ADMIN_EMAIL);
      await seedTender();

      const response = await call('GET', '/api/v1/admin/ingest-status', { as: admin });
      expect(response.statusCode).toBe(200);
      expect(response.json().counts.tenders).toBe(1);
      expect(response.json().lastRun).toBeNull();
    });

    it('re-runs ingest and matching, auditing both', async () => {
      const admin = await signIn(ADMIN_EMAIL);

      expect(
        (await call('POST', '/api/v1/admin/ingest/run', { as: admin, body: {} })).statusCode,
      ).toBe(200);
      expect(
        (await call('POST', '/api/v1/admin/matching/run', { as: admin, body: {} })).statusCode,
      ).toBe(200);
      expect(jobCalls).toEqual({ ingest: 1, matching: 1 });

      const audit = await call('GET', '/api/v1/admin/audit-events', { as: admin });
      const actions = audit.json().items.map((item: { action: string }) => item.action);
      expect(actions).toContain('ingest.rerun');
      expect(actions).toContain('matching.rerun');
    });

    it('suppresses a tender with a reason, and audits it', async () => {
      const admin = await signIn(ADMIN_EMAIL);
      const tenderId = await seedTender();

      const response = await call('POST', `/api/v1/admin/tenders/${tenderId}/suppress`, {
        as: admin,
        body: { reason: 'Duplikat av 2026-900001.' },
      });
      expect(response.statusCode).toBe(200);

      const rows = await db.select().from(tenders).where(eq(tenders.id, tenderId));
      expect(rows[0]?.suppressedAt).not.toBeNull();
      expect(rows[0]?.suppressedReason).toBe('Duplikat av 2026-900001.');

      const audit = await call('GET', '/api/v1/admin/audit-events?action=tender.suppressed', {
        as: admin,
      });
      expect(audit.json().items).toHaveLength(1);
      expect(audit.json().items[0].reason).toBe('Duplikat av 2026-900001.');
    });

    it('requires a reason for suppression', async () => {
      const admin = await signIn(ADMIN_EMAIL);
      const tenderId = await seedTender();
      const response = await call('POST', `/api/v1/admin/tenders/${tenderId}/suppress`, {
        as: admin,
        body: {},
      });
      expect(response.statusCode).toBe(400);
    });
  });

  // --- the error contract -------------------------------------------------

  describe('error contract', () => {
    it('answers an unknown API path with the Norwegian 404 shape', async () => {
      const response = await call('GET', '/api/v1/finnes-ikke');
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: { code: 'not_found', message: 'Ressursen finnes ikke.' },
      });
    });

    it('rejects a malformed id without touching the database', async () => {
      const user = await signIn('id@entreprenor.no');
      const response = await call('GET', '/api/v1/alert-profiles/ikke-en-uuid', { as: user });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('validation_error');
    });

    it('rejects a tampered pagination cursor', async () => {
      const user = await signIn('markor@entreprenor.no');
      const response = await call('GET', '/api/v1/alert-profiles?cursor=tull', { as: user });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('invalid_cursor');
    });
  });

  // --- roles --------------------------------------------------------------

  describe('the admin support override', () => {
    it('lets an administrator reach a user profile, and records that it happened', async () => {
      const user = await signIn('kunde-support@entreprenor.no');
      const admin = await signIn(ADMIN_EMAIL);
      const profileId = await seedProfile(user);

      const read = await call('GET', `/api/v1/alert-profiles/${profileId}`, { as: admin });
      expect(read.statusCode).toBe(200);

      // `requireOwnership` lets an admin through for support; packages/auth
      // says every such access must be audited. This is that assertion.
      const audit = await call(
        'GET',
        '/api/v1/admin/audit-events?action=alert_profile.accessed_as_admin',
        { as: admin },
      );
      expect(audit.json().items).toHaveLength(1);
      expect(audit.json().items[0]).toMatchObject({
        entityType: 'alert_profile',
        entityId: profileId,
      });
    });

    it('does not audit a user reading their own data', async () => {
      const user = await signIn('egen@entreprenor.no');
      const admin = await signIn(ADMIN_EMAIL);
      const profileId = await seedProfile(user);

      await call('GET', `/api/v1/alert-profiles/${profileId}`, { as: user });

      const audit = await call('GET', '/api/v1/admin/audit-events', { as: admin });
      expect(audit.json().items).toHaveLength(0);
    });
  });

  describe('admin membership', () => {
    it('comes from the allowlist, not from the row', async () => {
      // A row that claims admin without being on the allowlist gets nothing.
      const pretender = await signIn('pretender@entreprenor.no');
      await db
        .update(users)
        .set({ role: 'admin' as Role })
        .where(eq(users.id, pretender.userId));

      const response = await call('GET', '/api/v1/admin/ingest-status', { as: pretender });
      expect(response.statusCode).toBe(403);

      const me = await call('GET', '/api/v1/me', { as: pretender });
      expect(me.json().user.role).toBe('user');
    });
  });
});
