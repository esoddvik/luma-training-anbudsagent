import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { and, eq, gte, isNull, type SQL } from 'drizzle-orm';
import {
  emailSchema,
  issueMagicLink,
  issueSession,
  redeemMagicLink,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
  MAGIC_LINK_FAILURE_NB,
  MAGIC_LINK_GENERIC_RESPONSE_NB,
  MAGIC_LINK_RATE_LIMIT,
  MAGIC_LINK_TTL_MINUTES,
  type MagicLinkStore,
} from '@luma/auth';
import { appUrlFor, renderMagicLink } from '@luma/email';
import * as schema from '@luma/db/schema';
import { safeReturnPath } from '@/lib/return-path';
import { BASE_PATH } from '@/lib/site';
import type { Database } from './db';
import { authPepper, getWebDb } from './db';
import { appUrl, baseEmailContext, getWebEmailClient } from './email';

/**
 * Requesting a magic link, redeeming it, and establishing a session.
 *
 * This runs in the web app rather than calling the API, and the reason is
 * cookies. `apps/web` and `apps/core` are deployed to different hosts, so a
 * session cookie set by the API would either not reach the web app at all or
 * would have to be widened to the parent domain — which would hand the cookie
 * to every other host under `luma-training.com`, including the marketing site.
 * The web app already reads the database directly in server components, so
 * redeeming here is consistent with the rest of the app and keeps the cookie
 * host-scoped.
 *
 * The logic itself is not reimplemented: `issueMagicLink`, `redeemMagicLink`
 * and `issueSession` come from `@luma/auth`, so the token lifetime, the
 * single-use guarantee and the session lifetime are identical to the API's,
 * and `MAGIC_LINK_GENERIC_RESPONSE_NB` is the same sentence the API returns.
 */

/** A `MagicLinkStore` backed by the `magic_link_tokens` table. */
export function databaseMagicLinkStore(db: Database): MagicLinkStore {
  return {
    async findByHash(tokenHash) {
      const [row] = await db
        .select()
        .from(schema.magicLinkTokens)
        .where(eq(schema.magicLinkTokens.tokenHash, tokenHash))
        .limit(1);

      if (!row) return undefined;
      // A link may be issued for an address that has no account, because the
      // login response is deliberately identical either way (spec §10). Such a
      // token exists but can never redeem to a session, so it is reported as
      // not found rather than as a record with no user.
      if (!row.userId) return undefined;
      return {
        id: row.id,
        userId: row.userId,
        tokenHash: row.tokenHash,
        expiresAt: row.expiresAt,
        consumedAt: row.consumedAt,
        // The column is `requested_at`; the domain record calls it `createdAt`.
        createdAt: row.requestedAt,
      };
    },

    /**
     * A conditional update whose row count decides the answer.
     *
     * This is what makes the link single use. Reading `consumed_at` and then
     * updating would leave a window in which two requests both succeed, and
     * that window is not hypothetical: mail scanners routinely fetch a link
     * moments before the recipient clicks it.
     */
    async consume(id, consumedAt) {
      const updated = await db
        .update(schema.magicLinkTokens)
        .set({ consumedAt })
        .where(and(eq(schema.magicLinkTokens.id, id), isNull(schema.magicLinkTokens.consumedAt)))
        .returning({ id: schema.magicLinkTokens.id });
      return updated.length === 1;
    },

    async countRecentForUser(userId, since) {
      const rows = await db
        .select({ id: schema.magicLinkTokens.id })
        .from(schema.magicLinkTokens)
        .where(
          and(
            eq(schema.magicLinkTokens.userId, userId),
            gte(schema.magicLinkTokens.requestedAt, since),
          ),
        );
      return rows.length;
    },
  };
}

/** Where the emailed link lands. Must match the route under `app/`. */
const LOGIN_CONFIRM_PATH = '/logg-inn/bekreft';

const HOUR_MS = 3_600_000;

/**
 * The floor on how long a link request takes, in milliseconds.
 *
 * Wording parity is easy and timing parity is not. A request for a known
 * address makes an HTTPS round trip to Postmark; a request for an unknown one
 * does not, and that difference is tens to hundreds of milliseconds — far
 * louder than the database insert both paths share. "A row is written either
 * way" is a true statement that does not, on its own, close the channel.
 *
 * So both answers are held back to a common floor. The number is above a
 * healthy Postmark send from Vercel and imperceptible next to waiting for an
 * email to arrive.
 *
 * Stated honestly, because the weaker version of this claim is the dangerous
 * one: this narrows the channel, it does not delete it. A Postmark call slower
 * than the floor still finishes late, and an attacker with enough samples and
 * a quiet network can still see the tail. Closing it completely means moving
 * the send off the request path entirely — a queue, which the web app does not
 * have. Recorded rather than papered over.
 */
const MIN_RESPONSE_MS = 400;

async function padTo(startedAt: number, floorMs: number): Promise<void> {
  const remaining = floorMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

export interface RequestLoginLinkInput {
  readonly email: string;
  /** Same-origin path the user was heading to, carried through the email. */
  readonly returnPath?: string | undefined;
  readonly ipAddress?: string | undefined;
  readonly userAgent?: string | undefined;
}

export type RequestLoginLinkResult =
  | {
      readonly ok: true;
      /** Always `MAGIC_LINK_GENERIC_RESPONSE_NB`. Never varies. */
      readonly message: string;
      /**
       * Whether an email actually went out. For logs and tests only — no
       * caller may branch on it when producing anything the user can observe.
       */
      readonly emailSent: boolean;
    }
  | { readonly ok: false; readonly reason: 'rate_limited' };

/**
 * A stable, non-reversible identifier for a client address.
 *
 * Spec section 40 requires data minimisation, and `magic_link_tokens` stores
 * `request_ip_hash` rather than an address. The pepper is `AUTH_SECRET`, so
 * the same address hashes differently in every environment and a database dump
 * cannot be joined back against a visitor log. Identical to the API's
 * `hashIpAddress`, deliberately: the two must produce the same value or the
 * per-IP budget would be two separate budgets.
 */
function hashIpAddress(ip: string | undefined, pepper: string): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`${pepper}:${ip}`, 'utf8').digest('hex');
}

/**
 * Issues a login link, or quietly does not.
 *
 * **The one property this function exists to hold: the caller cannot tell
 * whether the address has an account.** Not from the returned message, not
 * from the shape of the result, and — as far as `MIN_RESPONSE_MS` reaches —
 * not from how long the call took. A row is written either way, so the
 * database work is the same on both paths, and both answers are held to a
 * common floor so the Postmark round trip on the known-address path does not
 * announce itself. Spec section 10 requires generic responses; without them
 * the login form is a customer list with a submit button, and Luma's customers
 * are named businesses whose competitors would like to know they are bidding.
 *
 * **What happens when the address has no account.** The token row is written
 * and *no email is sent*. The person is not left stranded: the login page
 * tells everyone, before they type anything, that an address without a profile
 * gets no link and points at the sign-up section on the front page. Three
 * reasons for that over the alternatives:
 *
 * 1. Spec section 9.1 makes registration a separate journey that collects a
 *    business name, an industry template, alert criteria and — sections 20 and
 *    21 — an explicit acceptance of the terms recorded as an append-only
 *    consent event with its exact text version. A link that silently created
 *    an account on redemption would manufacture a user row with no terms
 *    acceptance behind it, which is precisely the record those sections exist
 *    to make impossible. `databaseMagicLinkStore` already refuses to redeem a
 *    token whose `user_id` is null, and that refusal is load bearing.
 * 2. `apps/core`'s `POST /auth/request-link` already made this decision the
 *    same way. Two entry points to one feature that disagree about whether an
 *    address becomes an account is worse than either choice on its own.
 * 3. Telling them by email instead would need a tenth template. Spec section
 *    25 defines nine, `TemplateName` in `@luma/email` is a closed union, and
 *    adding to it means changing `packages/email`. See the report.
 *
 * The refusal is never visible to the requester, which is the point.
 */
export async function requestLoginLink(
  input: RequestLoginLinkInput,
): Promise<RequestLoginLinkResult> {
  const startedAt = Date.now();
  const result = await issueOrNot(input);
  // The rate-limited answer is deliberately distinguishable — it has to be, it
  // asks the user to wait — but it says nothing about whether the address is
  // registered, because the budget is checked before the account is looked up.
  await padTo(startedAt, MIN_RESPONSE_MS);
  return result;
}

async function issueOrNot(input: RequestLoginLinkInput): Promise<RequestLoginLinkResult> {
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) {
    // A malformed address gets the generic answer too. "That is not an email
    // address" is harmless in itself, but the branch is not: it is one more
    // observable difference between inputs, and the form's `type="email"`
    // already catches the honest typo in browsers that run JavaScript.
    return { ok: true, message: MAGIC_LINK_GENERIC_RESPONSE_NB, emailSent: false };
  }

  const email = parsed.data;
  const db = getWebDb();
  const pepper = authPepper();
  const now = new Date();
  const since = new Date(now.getTime() - HOUR_MS);
  const ipHash = hashIpAddress(input.ipAddress, pepper);

  // Per address and per client, because neither budget is sufficient alone:
  // the address budget does nothing against one host walking an address list,
  // and the client budget does nothing against a botnet hammering one address.
  const recentForAddress = await countSince(db, eq(schema.magicLinkTokens.email, email), since);
  if (recentForAddress >= MAGIC_LINK_RATE_LIMIT.maxPerAddressPerHour) {
    return { ok: false, reason: 'rate_limited' };
  }

  if (ipHash) {
    const recentForIp = await countSince(
      db,
      eq(schema.magicLinkTokens.requestIpHash, ipHash),
      since,
    );
    if (recentForIp >= MAGIC_LINK_RATE_LIMIT.maxPerIpPerHour) {
      return { ok: false, reason: 'rate_limited' };
    }
  }

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  const issued = issueMagicLink({ pepper, now });

  // Written whether or not the address is known. Without the row an attacker
  // could separate accounts from strangers by timing the request, and the
  // per-address budget would not apply to unknown addresses at all — so the
  // form could be walked through an address list without limit.
  await db.insert(schema.magicLinkTokens).values({
    email,
    userId: user?.id ?? null,
    // Only the hash is stored. The token itself exists in the sent email and
    // in this function's local scope, and nowhere else (spec section 47).
    tokenHash: issued.tokenHash,
    requestedAt: now,
    expiresAt: issued.expiresAt,
    requestIpHash: ipHash,
    userAgent: input.userAgent ?? null,
  });

  if (!user) {
    return { ok: true, message: MAGIC_LINK_GENERIC_RESPONSE_NB, emailSent: false };
  }

  // Re-sanitised here rather than trusted from the caller: this string ends up
  // in an email that a person will click, so an open redirect smuggled through
  // `retur` would be a phishing hop wearing Luma's domain.
  const safeReturn = safeReturnPath(input.returnPath);

  // `appUrlFor`, not `new URL(LOGIN_CONFIRM_PATH, appUrl())`. The app is served
  // under `/anbudsvarsling` on Luma Training's domain, so `APP_URL` carries
  // that prefix, and resolving a leading-slash path against it throws the
  // prefix away — sending the login link to the marketing site's 404 page with
  // nothing logged anywhere. `appUrlFor`'s own test is the guard on it.
  const magicLinkUrl = appUrlFor(appUrl(), LOGIN_CONFIRM_PATH, {
    token: issued.token,
    ...(safeReturn ? { retur: safeReturn } : {}),
  });

  const rendered = renderMagicLink({
    ...baseEmailContext(email, now),
    magicLinkUrl,
    validForMinutes: MAGIC_LINK_TTL_MINUTES,
  });

  // Transactional stream, always. A login link on the marketing stream would
  // be silenced by an unrelated spam complaint and lock the user out of a
  // service they never meant to leave (ADR-0005).
  await getWebEmailClient().sendTransactional(rendered, { to: email });

  return { ok: true, message: MAGIC_LINK_GENERIC_RESPONSE_NB, emailSent: true };
}

/** Counts magic-link rows matching a predicate since a point in time. */
async function countSince(db: Database, predicate: SQL, since: Date): Promise<number> {
  const rows = await db
    .select({ id: schema.magicLinkTokens.id })
    .from(schema.magicLinkTokens)
    .where(and(predicate, gte(schema.magicLinkTokens.requestedAt, since)));
  return rows.length;
}

export type LoginResult =
  { readonly ok: true; readonly userId: string } | { readonly ok: false; readonly message: string };

/**
 * Redeems a token and sets the session cookie.
 *
 * Every failure returns the same shape and a Norwegian message that tells the
 * user to request a new link. The three reasons are distinguished only in the
 * wording of that message, never in whether the page behaves differently.
 */
export async function completeLogin(token: string | undefined): Promise<LoginResult> {
  if (!token) {
    return { ok: false, message: MAGIC_LINK_FAILURE_NB.invalid };
  }

  const db = getWebDb();
  const now = new Date();

  const redemption = await redeemMagicLink({
    token,
    pepper: authPepper(),
    store: databaseMagicLinkStore(db),
    now,
  });

  if (!redemption.ok) {
    return { ok: false, message: MAGIC_LINK_FAILURE_NB[redemption.reason] };
  }

  const session = issueSession({ pepper: authPepper(), now });

  await db.insert(schema.sessions).values({
    userId: redemption.userId,
    tokenHash: session.tokenHash,
    expiresAt: session.expiresAt,
    lastUsedAt: now,
  });

  const jar = await cookies();
  jar.set(
    SESSION_COOKIE_NAME,
    session.token,
    // Scoped to the base path. This app shares `luma-training.com` with Luma
    // Training's marketing site, so a cookie at `/` would be sent with every
    // request for every page of that site. `SameSite=Lax` still lets the click
    // from the login email carry it, because the landing page is inside the
    // prefix; deleting the cookie has to name the same path (see
    // `deleteAccountAction`).
    sessionCookieOptions({
      isProduction: process.env.NODE_ENV === 'production',
      path: BASE_PATH,
    }),
  );

  return { ok: true, userId: redemption.userId };
}
