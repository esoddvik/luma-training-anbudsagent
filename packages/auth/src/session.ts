import { generateToken, hashToken } from './tokens.js';

/**
 * Opaque database-backed sessions (ADR-16).
 *
 * The session cookie carries a random identifier, not a signed claim. That is
 * what makes "log out of all sessions" and immediate admin revocation real
 * rather than best-effort: with a self-contained JWT, a stolen token stays
 * valid until it expires no matter what the server does.
 */

export const SESSION_TTL_DAYS = 30;
/** A session that has gone unused this long is treated as abandoned. */
export const SESSION_IDLE_TIMEOUT_DAYS = 14;

export const SESSION_COOKIE_NAME = 'luma_session';

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  lastUsedAt: Date;
  revokedAt?: Date | null;
  createdAt: Date;
}

export interface SessionStore {
  findByHash(tokenHash: string): Promise<SessionRecord | undefined>;
  touch(id: string, lastUsedAt: Date): Promise<void>;
  revoke(id: string, revokedAt: Date): Promise<void>;
  revokeAllForUser(userId: string, revokedAt: Date): Promise<number>;
}

export interface IssuedSession {
  /** Goes into the cookie. Never stored, never logged. */
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export function issueSession(input: {
  pepper: string;
  now: Date;
  ttlDays?: number;
}): IssuedSession {
  const { token, tokenHash } = generateToken(input.pepper);
  const ttl = input.ttlDays ?? SESSION_TTL_DAYS;
  return {
    token,
    tokenHash,
    expiresAt: new Date(input.now.getTime() + ttl * 86_400_000),
  };
}

export type SessionValidation =
  | { readonly ok: true; readonly userId: string; readonly sessionId: string }
  | { readonly ok: false; readonly reason: 'invalid' | 'expired' | 'revoked' | 'idle' };

export async function validateSession(input: {
  token: string | undefined;
  pepper: string;
  store: SessionStore;
  now: Date;
  idleTimeoutDays?: number;
}): Promise<SessionValidation> {
  if (!input.token) return { ok: false, reason: 'invalid' };

  const record = await input.store.findByHash(hashToken(input.token, input.pepper));
  if (!record) return { ok: false, reason: 'invalid' };
  if (record.revokedAt) return { ok: false, reason: 'revoked' };
  if (record.expiresAt <= input.now) return { ok: false, reason: 'expired' };

  const idleDays = input.idleTimeoutDays ?? SESSION_IDLE_TIMEOUT_DAYS;
  const idleSince = input.now.getTime() - record.lastUsedAt.getTime();
  if (idleSince > idleDays * 86_400_000) return { ok: false, reason: 'idle' };

  // Recording use is fire-and-forget from the caller's perspective, but it is
  // awaited here so a store failure surfaces rather than being swallowed.
  await input.store.touch(record.id, input.now);

  return { ok: true, userId: record.userId, sessionId: record.id };
}

export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
}

/**
 * Cookie attributes for the session (spec section 10).
 *
 * `SameSite=Lax` rather than `Strict`: the magic link arrives from an email
 * client, so the first request after clicking it is cross-site, and `Strict`
 * would drop the cookie and bounce the user straight back to the login page.
 * `Lax` still blocks the cross-site POST that CSRF depends on.
 *
 * `secure` is false only outside production, because `localhost` is served
 * over plain HTTP during development.
 */
export function sessionCookieOptions(input: {
  isProduction: boolean;
  ttlDays?: number;
}): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: input.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: (input.ttlDays ?? SESSION_TTL_DAYS) * 86_400,
  };
}

/** Attributes that clear the cookie on logout. */
export function clearedSessionCookieOptions(isProduction: boolean): SessionCookieOptions {
  return { ...sessionCookieOptions({ isProduction }), maxAge: 0 };
}
