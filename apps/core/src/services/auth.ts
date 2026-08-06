import { eq } from 'drizzle-orm';
import {
  emailSchema,
  hashToken,
  issueMagicLink,
  issueSession,
  redeemMagicLink,
  resolveRole,
  validateSession,
  AuthenticationError,
  MAGIC_LINK_FAILURE_NB,
  MAGIC_LINK_RATE_LIMIT,
  MAGIC_LINK_TTL_MINUTES,
  SESSION_TTL_DAYS,
} from '@luma/auth';
import { sessions, users, magicLinkTokens, notificationPreferences } from '@luma/db';
import { appUrlFor, renderMagicLink } from '@luma/email';
import { maskEmail } from '@luma/observability';
import { ApiError, tooManyRequests } from '../routes/errors.js';
import { DbMagicLinkStore, DbSessionStore } from './auth-stores.js';
import { baseEmailContext, hashIpAddress } from './email-context.js';
import type { Actor, ApiContext } from './context.js';

/**
 * Passwordless login (spec §10, ADR-0016).
 *
 * The rules live in `@luma/auth`; this module is the part that touches the
 * database, sends the email and mints the cookie. Three properties are load
 * bearing and each is enforced here rather than in the route:
 *
 * - **The response never depends on whether the account exists.** Not the
 *   body, not the status code, and not — importantly — whether the endpoint
 *   was fast or slow, because a row is written either way.
 * - **Rate limiting is per address as well as per client**, so an attacker who
 *   rotates addresses is limited by the IP budget and one who rotates IPs is
 *   limited by the address budget.
 * - **Redemption is single use**, decided by a conditional UPDATE.
 */

/**
 * Where the emailed link lands in the web app.
 *
 * This is a contract with `apps/web`, not a local detail: the page at this path
 * must read `?token=` and POST it to `/api/v1/auth/redeem` (with the
 * `x-luma-csrf` header), which is what sets the session cookie. Changing the
 * string here without creating the page there breaks login silently — the
 * email sends, the link arrives, and the user lands on a 404.
 *
 * Spec §16 does not list this route, so it is easy to miss when scaffolding
 * the web app from the spec alone.
 */
const LOGIN_CONFIRM_PATH = '/logg-inn/bekreft';

const HOUR_MS = 3_600_000;

export interface RequestMagicLinkInput {
  readonly email: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface RequestMagicLinkResult {
  /** Whether an email actually went out. For logs and tests only. */
  readonly emailSent: boolean;
}

/**
 * Issues a login link, or quietly does not.
 *
 * The caller gets the same value shape regardless. Spec §10 requires generic
 * responses so the login form cannot be turned into a customer list, and the
 * route ignores `emailSent` when building its reply.
 */
export async function requestMagicLink(
  ctx: ApiContext,
  input: RequestMagicLinkInput,
): Promise<RequestMagicLinkResult> {
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) {
    // Even a malformed address gets the generic answer. "That is not an email
    // address" is harmless, but the branch is not: it is one more observable
    // difference between inputs, and the form validates the shape anyway.
    return { emailSent: false };
  }
  const email = parsed.data;
  const now = ctx.now();
  const store = new DbMagicLinkStore(ctx.db);

  const recent = await store.countRecentForEmail(email, new Date(now.getTime() - HOUR_MS));
  if (recent >= MAGIC_LINK_RATE_LIMIT.maxPerAddressPerHour) {
    throw tooManyRequests(
      'Vi har allerede sendt flere innloggingslenker til denne adressen. Vent litt før du prøver igjen.',
    );
  }

  const userRows = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = userRows[0];

  const issued = issueMagicLink({ pepper: ctx.config.authSecret, now });

  // The row is written whether or not the address is known. Without it, an
  // attacker could distinguish accounts by timing the endpoint, and the
  // per-address rate limit would not apply to unknown addresses at all.
  await ctx.db.insert(magicLinkTokens).values({
    email,
    userId: user?.id ?? null,
    tokenHash: issued.tokenHash,
    requestedAt: now,
    expiresAt: issued.expiresAt,
    requestIpHash: hashIpAddress(input.ipAddress, ctx.config.authSecret),
    userAgent: input.userAgent ?? null,
  });

  if (!user) {
    ctx.logger.info(
      { recipient: maskEmail(email) },
      'innloggingslenke etterspurt for ukjent adresse',
    );
    return { emailSent: false };
  }

  // `appUrlFor`, not `new URL(LOGIN_CONFIRM_PATH, appUrl)`. The service is
  // served under `/anbudsvarsling` on Luma Training's domain, so `APP_URL`
  // carries that prefix, and resolving a leading-slash path against it throws
  // the prefix away — producing a login link to the marketing site's 404 page,
  // with nothing logged anywhere. Nobody could log in and nothing would say so.
  const magicLinkUrl = appUrlFor(ctx.config.appUrl, LOGIN_CONFIRM_PATH, {
    token: issued.token,
  });

  const rendered = renderMagicLink({
    ...baseEmailContext(ctx, email),
    magicLinkUrl,
    validForMinutes: MAGIC_LINK_TTL_MINUTES,
  });

  // Transactional stream, always. A login link on the marketing stream would
  // be silenced by an unrelated spam complaint (ADR-0005).
  await ctx.email.sendTransactional(rendered, { to: email });

  // Deliberately no token, no URL, no full address in the log (spec §40).
  ctx.logger.info({ recipient: maskEmail(email) }, 'innloggingslenke sendt');
  return { emailSent: true };
}

export interface RedeemedSession {
  readonly token: string;
  readonly expiresAt: Date;
  readonly actor: Actor;
}

/**
 * Redeems a link and opens a session.
 *
 * Also the moment the account's admin status is refreshed from
 * `ADMIN_EMAIL_ALLOWLIST`. The allowlist is authoritative; the `users.role`
 * column is a cached projection of it so that an admin listing does not have to
 * re-read configuration.
 */
export async function redeemLoginToken(
  ctx: ApiContext,
  input: { token: string; ipAddress?: string; userAgent?: string },
): Promise<RedeemedSession> {
  const now = ctx.now();
  const result = await redeemMagicLink({
    token: input.token,
    pepper: ctx.config.authSecret,
    store: new DbMagicLinkStore(ctx.db),
    now,
  });

  if (!result.ok) {
    throw new ApiError(`magic_link_${result.reason}`, 401, MAGIC_LINK_FAILURE_NB[result.reason]);
  }

  const userRows = await ctx.db.select().from(users).where(eq(users.id, result.userId)).limit(1);
  const user = userRows[0];
  if (!user) throw new ApiError('magic_link_invalid', 401, MAGIC_LINK_FAILURE_NB.invalid);

  const role = resolveRole(user.email, ctx.config.adminEmails);

  await ctx.db
    .update(users)
    .set({
      role,
      emailVerifiedAt: user.emailVerifiedAt ?? now,
      lastLoginAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, user.id));

  // Every account has preferences from its first login, so the digest job
  // never has to guess a default for a user it has not met before.
  await ctx.db
    .insert(notificationPreferences)
    .values({ userId: user.id })
    .onConflictDoNothing({ target: notificationPreferences.userId });

  const session = issueSession({ pepper: ctx.config.authSecret, now });
  const inserted = await ctx.db
    .insert(sessions)
    .values({
      userId: user.id,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
      lastUsedAt: now,
      userAgent: input.userAgent ?? null,
      ipAddressHash: hashIpAddress(input.ipAddress, ctx.config.authSecret),
    })
    .returning({ id: sessions.id });

  const sessionId = inserted[0]?.id;
  if (!sessionId) throw new ApiError('internal_error', 500, 'Det oppsto en uventet feil.');

  return {
    token: session.token,
    expiresAt: session.expiresAt,
    actor: { userId: user.id, email: user.email, role, sessionId },
  };
}

/** Resolves the caller from the session cookie, or returns undefined. */
export async function resolveActor(
  ctx: ApiContext,
  cookieValue: string | undefined,
): Promise<Actor | undefined> {
  const validation = await validateSession({
    token: cookieValue,
    pepper: ctx.config.authSecret,
    store: new DbSessionStore(ctx.db),
    now: ctx.now(),
  });
  if (!validation.ok) return undefined;

  const rows = await ctx.db.select().from(users).where(eq(users.id, validation.userId)).limit(1);
  const user = rows[0];
  if (!user) return undefined;

  return {
    userId: user.id,
    email: user.email,
    // Recomputed per request rather than read from the row: revoking admin
    // rights must take effect on the next request, not on the next login.
    role: resolveRole(user.email, ctx.config.adminEmails),
    sessionId: validation.sessionId,
  };
}

/** Throws the 401 every authenticated route shares. */
export function requireActor(actor: Actor | undefined): Actor {
  if (!actor) throw new AuthenticationError();
  return actor;
}

export async function logout(ctx: ApiContext, actor: Actor): Promise<void> {
  await new DbSessionStore(ctx.db).revoke(actor.sessionId, ctx.now());
}

/** Spec §10: the user can end every session, not only this one. */
export async function logoutAllSessions(ctx: ApiContext, actor: Actor): Promise<number> {
  return new DbSessionStore(ctx.db).revokeAllForUser(actor.userId, ctx.now());
}

export const SESSION_LIFETIME_DAYS = SESSION_TTL_DAYS;

/** Exposed for tests that need to assert on a stored hash without the token. */
export function sessionTokenHash(token: string, pepper: string): string {
  return hashToken(token, pepper);
}
