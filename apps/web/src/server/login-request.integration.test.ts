import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  hashToken,
  MAGIC_LINK_GENERIC_RESPONSE_NB,
  MAGIC_LINK_RATE_LIMIT,
  MAGIC_LINK_TTL_MINUTES,
} from '@luma/auth';
import { extractUrls, FakePostmarkClient, MARKERS } from '@luma/email';
import { PROMOTION_LABEL } from '@/content/copy';
import * as schema from '@luma/db/schema';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import type { requestLoginLink as RequestLoginLink } from './login';
import type { getWebEmailClient as GetWebEmailClient } from './email';

/**
 * Requesting a magic link, against a real database.
 *
 * The half of login that a person actually starts. `completeLogin` is covered
 * in `login.integration.test.ts`; this covers the half that can leak Luma's
 * customer list, so the assertions are about what an *observer* can tell rather
 * than only about what a legitimate user gets.
 */

const describeDb = hasDatabase ? describe : describe.skip;
const PEPPER = 'p'.repeat(32);
const KNOWN = 'anbud@entreprenor.no';
const UNKNOWN = 'ingen-konto@ukjent-firma.no';

describeDb('requestLoginLink', () => {
  let harness: TestDatabase;
  let db: TestDatabase['db'];
  let userId: string;
  let email: FakePostmarkClient;
  let requestLoginLink: typeof RequestLoginLink;

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db;
    email = new FakePostmarkClient();

    process.env.AUTH_SECRET = PEPPER;
    process.env.APP_URL = 'https://anbudsvarsling.luma-training.com';
    process.env.LUMA_PRIVACY_POLICY_URL = 'https://luma-training.com/personvern';
    process.env.TENDER_SERVICE_TERMS_URL = 'https://luma-training.com/vilkar-anbudsvarsling';
    process.env.AUTH_EMAIL_FROM = 'anbudsvarsling@luma-training.com';

    vi.doMock('./db', () => ({
      getWebDb: () => db,
      authPepper: () => PEPPER,
    }));
    // Only the client is replaced. `baseEmailContext` and `appUrl` run for
    // real, so a missing footer link or a wrong host would fail here rather
    // than in production.
    vi.doMock('./email', async () => {
      const actual = await vi.importActual<
        Record<string, unknown> & { getWebEmailClient: typeof GetWebEmailClient }
      >('./email');
      return { ...actual, getWebEmailClient: () => email };
    });

    ({ requestLoginLink } = await import('./login'));
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  beforeEach(async () => {
    email.reset();
    await db.execute(sql`truncate table ${schema.users} restart identity cascade`);
    await db.execute(sql`truncate table ${schema.magicLinkTokens}`);
    const [user] = await db.insert(schema.users).values({ email: KNOWN }).returning({
      id: schema.users.id,
    });
    userId = user!.id;
  });

  it('issues a link and sends one transactional email for a known address', async () => {
    const result = await requestLoginLink({ email: KNOWN });

    expect(result).toEqual({
      ok: true,
      message: MAGIC_LINK_GENERIC_RESPONSE_NB,
      emailSent: true,
    });

    const [row] = await db.select().from(schema.magicLinkTokens);
    expect(row!.email).toBe(KNOWN);
    expect(row!.userId).toBe(userId);
    expect(row!.consumedAt).toBeNull();

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.stream).toBe('transactional');
    expect(email.sent[0]!.template).toBe('auth-magic-link-v1');
    expect(email.sent[0]!.to).toBe(KNOWN);
  });

  it('normalises the address before looking it up', async () => {
    // `emailSchema` trims and lowercases, so a pasted "  Anbud@Entreprenor.NO "
    // must find the same account rather than creating a second identity.
    const result = await requestLoginLink({ email: `  ${KNOWN.toUpperCase()} ` });

    expect(result.ok && result.emailSent).toBe(true);
    const [row] = await db.select().from(schema.magicLinkTokens);
    expect(row!.email).toBe(KNOWN);
  });

  /**
   * Spec section 10's account-enumeration defence, and the most important test
   * in this file.
   *
   * The two answers are compared as whole values, not field by field, so a new
   * field added to only one branch fails here rather than shipping. Proved able
   * to fail: returning a different sentence for the unknown address turns this
   * red (see the report).
   */
  it('answers a registered and an unregistered address identically', async () => {
    const known = await requestLoginLink({ email: KNOWN });
    const unknown = await requestLoginLink({ email: UNKNOWN });

    expect(unknown.ok && unknown.message).toBe(known.ok && known.message);
    expect(unknown.ok && unknown.message).toBe(MAGIC_LINK_GENERIC_RESPONSE_NB);
    expect(unknown.ok).toBe(known.ok);
    // Byte for byte, including any field a later change might add.
    expect({ ...unknown, emailSent: false }).toEqual({ ...known, emailSent: false });
    // Nothing in the sentence hints at the difference.
    expect(MAGIC_LINK_GENERIC_RESPONSE_NB).not.toMatch(
      /finnes ikke|ukjent|ingen konto|ikke funnet/i,
    );
  });

  it('writes a token row for an unknown address, but sends nothing', async () => {
    // The row is what makes the two paths cost the same and what makes the
    // per-address budget apply to strangers as well as to customers.
    await requestLoginLink({ email: UNKNOWN });

    const [row] = await db.select().from(schema.magicLinkTokens);
    expect(row!.email).toBe(UNKNOWN);
    expect(row!.userId).toBeNull();
    expect(email.sent).toHaveLength(0);
  });

  it('takes a comparable amount of time for a known and an unknown address', async () => {
    // A lower bound, not an equality: the point is that neither answer returns
    // before the floor, so the Postmark round trip on the known path does not
    // announce itself. See MIN_RESPONSE_MS in login.ts for what this does and
    // does not buy.
    const timed = async (address: string) => {
      const start = Date.now();
      await requestLoginLink({ email: address });
      return Date.now() - start;
    };

    expect(await timed(UNKNOWN)).toBeGreaterThanOrEqual(350);
    expect(await timed(KNOWN)).toBeGreaterThanOrEqual(350);
  });

  it('refuses the sixth request for one address within the hour', async () => {
    const limit = MAGIC_LINK_RATE_LIMIT.maxPerAddressPerHour;
    expect(limit).toBe(5);

    for (let attempt = 0; attempt < limit; attempt += 1) {
      expect((await requestLoginLink({ email: KNOWN })).ok).toBe(true);
    }

    const refused = await requestLoginLink({ email: KNOWN });
    expect(refused).toEqual({ ok: false, reason: 'rate_limited' });
    // No sixth row, no sixth email.
    expect(await db.$count(schema.magicLinkTokens)).toBe(limit);
    expect(email.sent).toHaveLength(limit);
  }, 20_000);

  it('does not let one address spend another address’s budget', async () => {
    for (let attempt = 0; attempt < MAGIC_LINK_RATE_LIMIT.maxPerAddressPerHour; attempt += 1) {
      await requestLoginLink({ email: UNKNOWN });
    }

    expect((await requestLoginLink({ email: KNOWN })).ok).toBe(true);
  }, 20_000);

  it('ignores requests older than the hour when counting', async () => {
    for (let attempt = 0; attempt < MAGIC_LINK_RATE_LIMIT.maxPerAddressPerHour; attempt += 1) {
      await requestLoginLink({ email: KNOWN });
    }
    await db.execute(
      sql`update ${schema.magicLinkTokens} set requested_at = now() - interval '2 hours'`,
    );

    expect((await requestLoginLink({ email: KNOWN })).ok).toBe(true);
  }, 20_000);

  it('refuses one client that walks an address list, on the per-IP budget', async () => {
    const perIp = MAGIC_LINK_RATE_LIMIT.maxPerIpPerHour;

    for (let attempt = 0; attempt < perIp; attempt += 1) {
      // A different address every time, so the per-address budget never fires.
      await requestLoginLink({ email: `kandidat-${attempt}@ukjent.no`, ipAddress: '198.51.100.7' });
    }

    const refused = await requestLoginLink({ email: 'neste@ukjent.no', ipAddress: '198.51.100.7' });
    expect(refused).toEqual({ ok: false, reason: 'rate_limited' });
    // Another client is unaffected.
    expect(
      (await requestLoginLink({ email: 'neste@ukjent.no', ipAddress: '203.0.113.9' })).ok,
    ).toBe(true);
  }, 60_000);

  it('stores a hash of the token and never the token itself', async () => {
    await requestLoginLink({ email: KNOWN });

    const token = tokenFromEmail(email.lastSent()!.text);
    const [row] = await db.select().from(schema.magicLinkTokens);

    expect(row!.tokenHash).toBe(hashToken(token, PEPPER));
    expect(row!.tokenHash).not.toBe(token);

    // Nothing anywhere in the row is the token. Column by column, because the
    // interesting failure is a new column added later that happens to carry it.
    for (const [column, value] of Object.entries(row!)) {
      if (typeof value === 'string') {
        expect(value, `${column} inneholder tokenet i klartekst`).not.toContain(token);
      }
    }
  });

  it('stores the client address as a hash, never in the clear', async () => {
    await requestLoginLink({ email: KNOWN, ipAddress: '198.51.100.7', userAgent: 'Firefox' });

    const [row] = await db.select().from(schema.magicLinkTokens);
    expect(row!.requestIpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.requestIpHash).not.toContain('198.51.100.7');
    expect(row!.userAgent).toBe('Firefox');
  });

  it('emails a link to /logg-inn/bekreft carrying the token', async () => {
    await requestLoginLink({ email: KNOWN });

    const sent = email.lastSent()!;
    const url = new URL(confirmUrlFrom(sent.text));

    expect(url.origin).toBe('https://anbudsvarsling.luma-training.com');
    expect(url.pathname).toBe('/logg-inn/bekreft');
    expect(url.searchParams.get('token')).toBeTruthy();
    // The HTML part must carry the same URL: a link that only works in one
    // part is a link that fails for half the recipients.
    expect(extractUrls(sent.html)).toContain(url.toString());

    const [row] = await db.select().from(schema.magicLinkTokens);
    expect(row!.tokenHash).toBe(hashToken(url.searchParams.get('token')!, PEPPER));
  });

  it('sets the link to expire within the configured lifetime', async () => {
    // Bracketed rather than compared against a single instant. The token is
    // issued at some point *during* the call, so measuring from `before` alone
    // always overshoots the TTL by however long the call took — which made the
    // old `<= TTL` assertion fail whenever that was more than a rounding
    // error. Expiry must land TTL minutes after an issue time somewhere inside
    // the bracket, which is exact and cannot flake.
    const before = Date.now();
    await requestLoginLink({ email: KNOWN });
    const after = Date.now();

    const [row] = await db.select().from(schema.magicLinkTokens);
    const expiresAt = row!.expiresAt.getTime();
    const ttlMs = MAGIC_LINK_TTL_MINUTES * 60_000;

    expect(expiresAt).toBeGreaterThanOrEqual(before + ttlMs);
    expect(expiresAt).toBeLessThanOrEqual(after + ttlMs);
  });

  it('carries a safe return path through to the emailed link', async () => {
    await requestLoginLink({ email: KNOWN, returnPath: '/anbud/abc-123' });

    const url = new URL(confirmUrlFrom(email.lastSent()!.text));
    expect(url.searchParams.get('retur')).toBe('/anbud/abc-123');
  });

  it('drops a return path that points off-site', async () => {
    // An emailed link is the most credible phishing hop there is: it arrives
    // from Luma, on Luma's domain, and forwards wherever the attacker said.
    await requestLoginLink({ email: KNOWN, returnPath: '//ondsinnet.example/host' });

    const url = new URL(confirmUrlFrom(email.lastSent()!.text));
    expect(url.searchParams.has('retur')).toBe(false);
  });

  it('answers a malformed address the same way, and writes nothing', async () => {
    const result = await requestLoginLink({ email: 'ikke-en-adresse' });

    expect(result).toEqual({
      ok: true,
      message: MAGIC_LINK_GENERIC_RESPONSE_NB,
      emailSent: false,
    });
    expect(await db.$count(schema.magicLinkTokens)).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it('sends Norwegian copy with no promotion in it', async () => {
    // Spec section 25: account-critical mail carries no promotion and no
    // unsubscribe. Section 6: every customer-facing string is bokmål.
    await requestLoginLink({ email: KNOWN });

    const sent = email.lastSent()!;
    expect(sent.subject).toMatch(/[æøåÆØÅ]|innlogging|Logg inn/i);
    expect(sent.unsubscribeUrl).toBeUndefined();
    // The section marker, not a CSS class name: the shared dark-mode stylesheet
    // in every template declares `.luma-promotion-cell`, so a substring search
    // for "luma-promotion" matches an email that carries no promotion at all.
    // An assertion that fires on the wrong thing is worse than none.
    expect(sent.html).not.toContain(MARKERS.promotionStart);
    expect(sent.text).not.toContain(PROMOTION_LABEL);
    expect(sent.text).not.toMatch(/\bSign in\b|\bClick here\b/i);
  });
});

/** The confirmation URL from the plain-text part of the email. */
function confirmUrlFrom(text: string): string {
  const found = extractUrls(text).find((url) => url.includes('/logg-inn/bekreft'));
  if (!found) throw new Error(`Fant ingen innloggingslenke i e-posten:\n${text}`);
  return found;
}

function tokenFromEmail(text: string): string {
  const token = new URL(confirmUrlFrom(text)).searchParams.get('token');
  if (!token) throw new Error('Innloggingslenken mangler token');
  return token;
}
