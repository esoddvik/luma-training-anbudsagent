import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { hashToken, SESSION_COOKIE_NAME } from '@luma/auth';
import { extractUrls, FakePostmarkClient } from '@luma/email';
import * as schema from '@luma/db/schema';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import type { DraftProfile } from './draft-profile';
import type {
  confirmSignup as ConfirmSignup,
  requestSignupConfirmation as RequestSignupConfirmation,
} from './registration';
import type { getWebEmailClient as GetWebEmailClient } from './email';

/**
 * The search-first entry door, against a real database
 * (IDE Agent Spec v3, section 3.1).
 *
 * Two things are being protected here and they pull in opposite directions.
 *
 * The first is that **an observer must not be able to tell whether an address
 * already has an account.** This form is public, indexed, and sits at the end
 * of a funnel built to attract exactly the businesses whose competitors would
 * pay for a customer list. Every assertion in `indistinguishable branches`
 * exists because the cheap version of this feature — send an email only to new
 * addresses, or say "welcome back" — turns the form into that list.
 *
 * The second is that **confirming must be all-or-nothing.** The transaction
 * creates a user, records a terms acceptance, mirrors it into the consent log
 * and writes a profile with its criteria. Every partial outcome is a named bug:
 * an account nobody agreed to terms for (which spec section 20.1 exists to
 * prevent), an orphaned legal record, an empty dashboard, or a profile with no
 * criteria that matches everything and floods the person who just signed up.
 */

const describeDb = hasDatabase ? describe : describe.skip;
const PEPPER = 'p'.repeat(32);
const KNOWN = 'anbud@entreprenor.no';
const UNKNOWN = 'ingen-konto@ukjent-firma.no';
const APP_URL = 'https://luma-training.com/anbudsvarsling';
const TERMS_VERSION = '2026-01-utkast';

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

function draft(overrides?: Partial<DraftProfile>): DraftProfile {
  return {
    name: 'Renhold i Viken',
    active: false,
    cpvInclude: ['90910000'],
    cpvExclude: [],
    keywordsInclude: ['renhold', 'rengjøring'],
    keywordsExclude: ['vindusvask'],
    regionsInclude: ['NO082'],
    municipalitiesInclude: [],
    buyerInclude: [],
    buyerExclude: ['Forsvaret'],
    noticeTypes: [],
    includePlannedProcurements: true,
    procedureTypes: [],
    frequency: 'daily',
    digestHourLocal: 7,
    timezone: 'Europe/Oslo',
    minimumMatchScore: 0,
    ...overrides,
  };
}

/** The token out of the emailed link, the way the recipient's browser gets it. */
function tokenFromEmail(email: FakePostmarkClient, index = 0): string {
  const sent = email.sent[index];
  if (!sent) throw new Error('no email was sent');
  const url = extractUrls(sent.html).find((candidate) =>
    candidate.includes('/registrering/bekreft'),
  );
  if (!url) throw new Error('no confirmation link in the email');
  const token = new URL(url).searchParams.get('token');
  if (!token) throw new Error('confirmation link carries no token');
  return token;
}

describeDb('the search-first entry door', () => {
  let harness: TestDatabase;
  let db: TestDatabase['db'];
  let email: FakePostmarkClient;
  let requestSignupConfirmation: typeof RequestSignupConfirmation;
  let confirmSignup: typeof ConfirmSignup;

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db;
    email = new FakePostmarkClient();

    process.env.AUTH_SECRET = PEPPER;
    process.env.APP_URL = APP_URL;
    process.env.LUMA_PRIVACY_POLICY_URL = 'https://luma-training.com/personvern';
    process.env.TENDER_SERVICE_TERMS_URL = 'https://luma-training.com/vilkar-anbudsvarsling';
    process.env.AUTH_EMAIL_FROM = 'anbudsvarsling@luma-training.com';

    vi.doMock('./db', async () => {
      const actual = await vi.importActual<Record<string, unknown>>('./db');
      return { ...actual, getWebDb: () => db, authPepper: () => PEPPER };
    });
    // Only the client is replaced. `baseEmailContext` and `appUrl` run for
    // real, so a missing footer link or a wrong host fails here rather than in
    // production.
    vi.doMock('./email', async () => {
      const actual = await vi.importActual<
        Record<string, unknown> & { getWebEmailClient: typeof GetWebEmailClient }
      >('./email');
      return { ...actual, getWebEmailClient: () => email };
    });

    ({ requestSignupConfirmation, confirmSignup } = await import('./registration'));
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  beforeEach(async () => {
    email.reset();
    cookieJar.clear();
    await db.execute(sql`truncate table ${schema.pendingSignups}`);
    await db.execute(sql`truncate table ${schema.legalDocuments} restart identity cascade`);
    // `users` cascades into profiles, sessions and acceptances; consent events
    // sever rather than cascade, so they are cleared explicitly. The
    // append-only trigger permits truncate, which is how the suite resets a
    // table it can never delete a row from.
    await db.execute(sql`truncate table ${schema.users} restart identity cascade`);
    await db.execute(
      sql`truncate table ${schema.consentEvents}, ${schema.consentTextVersions} restart identity cascade`,
    );

    const [document] = await db
      .insert(schema.legalDocuments)
      .values({ kind: 'terms', title: 'Bruksvilkår for Luma Anbudsvarsling' })
      .returning({ id: schema.legalDocuments.id });
    await db.insert(schema.legalDocumentVersions).values({
      legalDocumentId: document!.id,
      kind: 'terms',
      version: TERMS_VERSION,
      body: 'Utkast til bruksvilkår.',
      isPlaceholder: true,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  describe('indistinguishable branches', () => {
    it('sends an email and answers identically whether or not the address is known', async () => {
      await db.insert(schema.users).values({ email: KNOWN });

      const known = await requestSignupConfirmation({ email: KNOWN, draft: draft() });
      const knownEmails = email.sent.length;
      email.reset();
      const unknown = await requestSignupConfirmation({ email: UNKNOWN, draft: draft() });

      // Both branches send exactly one transactional email on the same
      // template. A branch that sent nothing would be measurable from the
      // outside within one round trip.
      expect(knownEmails).toBe(1);
      expect(email.sent).toHaveLength(1);
      expect(email.sent[0]!.template).toBe('signup-confirmation-v1');
      expect(email.sent[0]!.stream).toBe('transactional');

      // The results differ in exactly one field, and it is the one documented
      // as being for tests and logs only. Everything a caller could turn into
      // an observable response is identical.
      expect(known).toEqual({ ...unknown, hadExistingAccount: true });
      expect(unknown).toMatchObject({ ok: true, hadExistingAccount: false });
      if (!known.ok || !unknown.ok) throw new Error('both branches must succeed');
      expect(known.message).toBe(unknown.message);
    });

    it('gives a malformed address the same answer as a well-formed one', async () => {
      const good = await requestSignupConfirmation({ email: UNKNOWN, draft: draft() });
      const bad = await requestSignupConfirmation({ email: 'ikke-en-adresse', draft: draft() });

      if (!good.ok || !bad.ok) throw new Error('neither branch may fail');
      expect(bad.message).toBe(good.message);
      // No row and no email for the malformed one: the answer is a shape, not
      // a side effect.
      expect(email.sent).toHaveLength(1);
    });

    it('says nothing about the account in the email the requester cannot read', async () => {
      await db.insert(schema.users).values({ email: KNOWN });
      await requestSignupConfirmation({ email: KNOWN, draft: draft() });
      const toExisting = email.sent[0]!.text;

      email.reset();
      await requestSignupConfirmation({ email: UNKNOWN, draft: draft() });
      const toNew = email.sent[0]!.text;

      // The bodies *do* differ — that is the point of the two variants, and it
      // is safe because only the address owner can read them.
      expect(toExisting).not.toBe(toNew);
      expect(toExisting).toContain('logge inn');
      expect(toNew).toContain('oppretter vi kontoen');
    });
  });

  describe('confirming', () => {
    it('creates the account, the acceptance, the consent event and the paused profile', async () => {
      await requestSignupConfirmation({
        email: UNKNOWN,
        draft: draft(),
        serviceTemplateSlug: 'renhold-og-renholdstjenester',
      });
      const result = await confirmSignup(tokenFromEmail(email));

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const [user] = await db.select().from(schema.users).where(eq(schema.users.email, UNKNOWN));
      expect(user!.id).toBe(result.userId);
      // The whole point of the round trip: they proved the address is theirs.
      expect(user!.emailVerifiedAt).not.toBeNull();

      const acceptances = await db
        .select()
        .from(schema.userLegalAcceptances)
        .where(eq(schema.userLegalAcceptances.userId, user!.id));
      expect(acceptances).toHaveLength(1);
      expect(acceptances[0]!.version).toBe(TERMS_VERSION);

      // Spec section 21 lists terms_acceptance as a consent type, and core's
      // `acceptLegalDocument` mirrors it. A second entry door that skipped the
      // mirror would make `GET /consents` report false for someone who just
      // accepted — two tables disagreeing about a fact with legal weight.
      const consents = await db
        .select()
        .from(schema.consentEvents)
        .where(eq(schema.consentEvents.userId, user!.id));
      expect(consents).toHaveLength(1);
      expect(consents[0]!.consentType).toBe('terms_acceptance');
      expect(consents[0]!.status).toBe('accepted');
      expect(consents[0]!.source).toBe('signup');
      expect(consents[0]!.consentTextVersion).toBe(TERMS_VERSION);

      // Accepting the terms must not grant marketing consent (section 20.2).
      const marketing = consents.filter((row) => row.consentType === 'marketing_email');
      expect(marketing).toHaveLength(0);

      const [profile] = await db
        .select()
        .from(schema.alertProfiles)
        .where(eq(schema.alertProfiles.id, result.profileId));
      expect(profile!.userId).toBe(user!.id);
      expect(profile!.name).toBe('Renhold i Viken');
      // Paused on create, an explicit launch decision rather than a default.
      expect(profile!.active).toBe(false);

      const keywords = await db
        .select()
        .from(schema.alertProfileKeywords)
        .where(eq(schema.alertProfileKeywords.alertProfileId, result.profileId));
      // Two includes and one exclude, with the Norwegian folding applied by
      // the writer rather than by SQL.
      expect(keywords).toHaveLength(3);
      // `ø` folds to `oe`, not to `o` — the rule `normalizeSearchText` applies
      // and the reason the writer supplies the normalised form rather than SQL.
      expect(keywords.find((row) => row.keyword === 'rengjøring')!.normalizedKeyword).toBe(
        'rengjoering',
      );

      const cpv = await db
        .select()
        .from(schema.alertProfileCpvCodes)
        .where(eq(schema.alertProfileCpvCodes.alertProfileId, result.profileId));
      expect(cpv.map((row) => row.cpvCode)).toEqual(['90910000']);

      // The session cookie is set, so the confirmed user lands signed in.
      expect(cookieJar.get(SESSION_COOKIE_NAME)).toBeDefined();
    });

    it('is single use: a second click changes nothing and creates no second account', async () => {
      await requestSignupConfirmation({ email: UNKNOWN, draft: draft() });
      const token = tokenFromEmail(email);

      const first = await confirmSignup(token);
      const second = await confirmSignup(token);

      expect(first.ok).toBe(true);
      expect(second).toMatchObject({ ok: false, reason: 'already_used' });

      const users = await db.select().from(schema.users).where(eq(schema.users.email, UNKNOWN));
      expect(users).toHaveLength(1);
      const profiles = await db.select().from(schema.alertProfiles);
      expect(profiles).toHaveLength(1);
    });

    it('adds a profile to an existing account without a second acceptance or consent event', async () => {
      const [existing] = await db
        .insert(schema.users)
        .values({ email: KNOWN, emailVerifiedAt: new Date('2026-02-01T00:00:00.000Z') })
        .returning({ id: schema.users.id });

      await requestSignupConfirmation({ email: KNOWN, draft: draft({ name: 'Andre profil' }) });
      const result = await confirmSignup(tokenFromEmail(email));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.userId).toBe(existing!.id);

      const users = await db.select().from(schema.users).where(eq(schema.users.email, KNOWN));
      expect(users).toHaveLength(1);
      // The first verification timestamp records when the address was first
      // proven. Moving it forward would destroy that fact for no gain.
      expect(users[0]!.emailVerifiedAt).toEqual(new Date('2026-02-01T00:00:00.000Z'));

      // The consent log is append-only, so a spurious duplicate could never be
      // cleaned up afterwards — the sequence is the evidence.
      const consents = await db
        .select()
        .from(schema.consentEvents)
        .where(eq(schema.consentEvents.userId, existing!.id));
      expect(consents).toHaveLength(1);
    });

    it('refuses an expired link and leaves no account behind', async () => {
      await requestSignupConfirmation({ email: UNKNOWN, draft: draft() });
      const token = tokenFromEmail(email);

      await db
        .update(schema.pendingSignups)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.pendingSignups.tokenHash, hashToken(token, PEPPER)));

      expect(await confirmSignup(token)).toMatchObject({ ok: false, reason: 'expired' });
      expect(await db.select().from(schema.users)).toHaveLength(0);
    });

    it('refuses an unknown token', async () => {
      expect(await confirmSignup('nonsense')).toMatchObject({ ok: false, reason: 'invalid' });
      expect(await confirmSignup(undefined)).toMatchObject({ ok: false, reason: 'invalid' });
    });

    /**
     * The reason `parseDraftProfile` validates on the way out.
     *
     * Rows outlive deploys: a draft written before a schema change is confirmed
     * after it. The failure has to be one Norwegian message, not a constraint
     * violation halfway through creating somebody's account.
     */
    it('refuses a draft that is no longer valid, without creating anything', async () => {
      await requestSignupConfirmation({ email: UNKNOWN, draft: draft() });
      const token = tokenFromEmail(email);

      await db
        .update(schema.pendingSignups)
        .set({ draftProfile: { name: '', frequency: 'yearly' } })
        .where(eq(schema.pendingSignups.tokenHash, hashToken(token, PEPPER)));

      expect(await confirmSignup(token)).toMatchObject({ ok: false, reason: 'draft_invalid' });
      expect(await db.select().from(schema.users)).toHaveLength(0);
      // The row is not consumed, so fixing the draft and retrying is possible
      // rather than the link being burnt by a failure that was not the user's.
      const [row] = await db.select().from(schema.pendingSignups);
      expect(row!.consumedAt).toBeNull();
    });

    /**
     * Spec section 20.1 makes acceptance of the terms a precondition of the
     * account existing. With no terms version in force there is no lawful way
     * to create one, so the answer is a refusal rather than an account with a
     * missing acceptance.
     */
    it('refuses to create an account when no terms version is in force', async () => {
      await requestSignupConfirmation({ email: UNKNOWN, draft: draft() });
      const token = tokenFromEmail(email);
      await db.execute(sql`truncate table ${schema.legalDocuments} restart identity cascade`);

      expect(await confirmSignup(token)).toMatchObject({ ok: false, reason: 'no_terms' });
      expect(await db.select().from(schema.users)).toHaveLength(0);
    });

    it('ignores an active flag smuggled into the stored draft', async () => {
      await requestSignupConfirmation({ email: UNKNOWN, draft: draft() });
      const token = tokenFromEmail(email);

      const [row] = await db.select().from(schema.pendingSignups);
      await db
        .update(schema.pendingSignups)
        .set({ draftProfile: { ...(row!.draftProfile as object), active: true } })
        .where(eq(schema.pendingSignups.id, row!.id));

      const result = await confirmSignup(token);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const [profile] = await db
        .select()
        .from(schema.alertProfiles)
        .where(eq(schema.alertProfiles.id, result.profileId));
      // Paused regardless. A stored draft is the one input that could start a
      // profile sending without the user asking at confirmation time.
      expect(profile!.active).toBe(false);
    });
  });

  describe('the emailed link', () => {
    it('keeps the app path prefix and carries a sanitised return path', async () => {
      await requestSignupConfirmation({
        email: UNKNOWN,
        draft: draft(),
        returnPath: '/varsler',
      });

      const url = extractUrls(email.sent[0]!.html).find((candidate) =>
        candidate.includes('/registrering/bekreft'),
      )!;
      // The prefix is the bug this guards: resolving a leading-slash path
      // against APP_URL throws `/anbudsvarsling` away and sends the link to
      // the marketing site's 404 page with nothing logged anywhere.
      expect(url).toContain('/anbudsvarsling/registrering/bekreft');
      expect(new URL(url).searchParams.get('retur')).toBe('/varsler');
    });

    it('drops an off-site return path rather than emailing a phishing hop', async () => {
      await requestSignupConfirmation({
        email: UNKNOWN,
        draft: draft(),
        returnPath: 'https://angriper.example/konto',
      });

      const [row] = await db.select().from(schema.pendingSignups);
      expect(row!.returnPath).toBeNull();
      const url = extractUrls(email.sent[0]!.html).find((candidate) =>
        candidate.includes('/registrering/bekreft'),
      )!;
      expect(new URL(url).searchParams.get('retur')).toBeNull();
    });

    it('stores only the hash of the token, never the token', async () => {
      await requestSignupConfirmation({ email: UNKNOWN, draft: draft() });
      const token = tokenFromEmail(email);

      const [row] = await db.select().from(schema.pendingSignups);
      expect(row!.tokenHash).toBe(hashToken(token, PEPPER));
      expect(JSON.stringify(row)).not.toContain(token);
    });
  });

  describe('rate limiting', () => {
    it('stops one address being walked through the form', async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const result = await requestSignupConfirmation({ email: UNKNOWN, draft: draft() });
        expect(result.ok).toBe(true);
      }

      expect(await requestSignupConfirmation({ email: UNKNOWN, draft: draft() })).toEqual({
        ok: false,
        reason: 'rate_limited',
      });
    });

    it('checks the budget before looking the account up, so it leaks nothing either', async () => {
      await db.insert(schema.users).values({ email: KNOWN });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await requestSignupConfirmation({ email: KNOWN, draft: draft() });
      }
      const knownLimited = await requestSignupConfirmation({ email: KNOWN, draft: draft() });

      await db.execute(sql`truncate table ${schema.pendingSignups}`);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await requestSignupConfirmation({ email: UNKNOWN, draft: draft() });
      }
      const unknownLimited = await requestSignupConfirmation({ email: UNKNOWN, draft: draft() });

      expect(knownLimited).toEqual(unknownLimited);
    });
  });

  describe('cleanup eligibility', () => {
    it('marks an abandoned row expired so signup.cleanup can remove it', async () => {
      await requestSignupConfirmation({ email: UNKNOWN, draft: draft() });
      const [row] = await db.select().from(schema.pendingSignups);

      // An unconsumed row is an address somebody typed and walked away from.
      // Its lawful basis is completing the signup, and that expires with the
      // token — which is what makes the nightly sweep a deletion obligation
      // rather than housekeeping.
      expect(row!.consumedAt).toBeNull();
      expect(row!.expiresAt.getTime()).toBeGreaterThan(row!.requestedAt.getTime());
      expect(row!.expiresAt.getTime() - row!.requestedAt.getTime()).toBe(60 * 60_000);
    });
  });
});
