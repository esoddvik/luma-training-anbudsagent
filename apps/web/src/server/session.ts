import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { SESSION_COOKIE_NAME, validateSession, type SessionStore } from '@luma/auth';
import * as schema from '@luma/db/schema';
import type { Database } from './db';
import { loginPath } from '@/lib/return-path';
import { authPepper, getWebDb } from './db';

/**
 * The authentication boundary for the web app (spec section 10, ADR-16).
 *
 * Sessions are opaque database rows, not signed claims, so validating one is a
 * live read: a revoked session stops working on the next request rather than
 * when a token happens to expire. The API's login and magic-link endpoints
 * live in `apps/core`; this module only *reads* an existing session, and
 * deliberately contains no way to create one.
 *
 * `validateSession` is imported rather than reimplemented so that the three
 * runtimes cannot drift apart on what "expired", "revoked" and "idle" mean.
 */

export interface SignedInUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: 'user' | 'admin';
  readonly sessionId: string;
}

/** A `SessionStore` backed by the `sessions` table. */
export function databaseSessionStore(db: Database): SessionStore {
  return {
    async findByHash(tokenHash) {
      const [row] = await db
        .select({
          id: schema.sessions.id,
          userId: schema.sessions.userId,
          tokenHash: schema.sessions.tokenHash,
          expiresAt: schema.sessions.expiresAt,
          lastUsedAt: schema.sessions.lastUsedAt,
          revokedAt: schema.sessions.revokedAt,
          createdAt: schema.sessions.createdAt,
        })
        .from(schema.sessions)
        .where(eq(schema.sessions.tokenHash, tokenHash))
        .limit(1);

      if (!row) return undefined;
      return {
        id: row.id,
        userId: row.userId,
        tokenHash: row.tokenHash,
        expiresAt: row.expiresAt,
        // A session that has never been used is as fresh as its creation.
        lastUsedAt: row.lastUsedAt ?? row.createdAt,
        revokedAt: row.revokedAt,
        createdAt: row.createdAt,
      };
    },
    async touch(id, lastUsedAt) {
      await db.update(schema.sessions).set({ lastUsedAt }).where(eq(schema.sessions.id, id));
    },
    async revoke(id, revokedAt) {
      await db.update(schema.sessions).set({ revokedAt }).where(eq(schema.sessions.id, id));
    },
    async revokeAllForUser(userId, revokedAt) {
      const revoked = await db
        .update(schema.sessions)
        .set({ revokedAt })
        .where(eq(schema.sessions.userId, userId))
        .returning({ id: schema.sessions.id });
      return revoked.length;
    },
  };
}

/**
 * The signed-in user, or `null`.
 *
 * Returns `null` for every failure mode — no cookie, unknown token, expired,
 * revoked, idle — because none of those distinctions is useful to the caller
 * and telling them apart in the UI would leak whether a token was ever real.
 */
export async function getCurrentUser(): Promise<SignedInUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const db = getWebDb();
  const validation = await validateSession({
    token,
    pepper: authPepper(),
    store: databaseSessionStore(db),
    now: new Date(),
  });

  if (!validation.ok) return null;

  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
    })
    .from(schema.users)
    .where(eq(schema.users.id, validation.userId))
    .limit(1);

  if (!user) return null;
  return { ...user, sessionId: validation.sessionId };
}

/**
 * The signed-in user, or a redirect to the login page.
 *
 * `retur` carries where the user was heading so the magic link can send them
 * back there. It is a path, never an absolute URL: an open redirect through
 * the login page would turn the service's own domain into a phishing hop.
 */
export async function requireUser(returnPath?: string): Promise<SignedInUser> {
  const user = await getCurrentUser();
  if (user) return user;

  redirect(loginPath(returnPath));
}

/**
 * An administrator, or a 404.
 *
 * Spec section 45's admin surface answers with "not found" rather than
 * "forbidden" for everyone else, so its existence is not discoverable by
 * probing.
 */
export async function requireAdmin(): Promise<SignedInUser> {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') notFound();
  return user;
}

/**
 * The user's active alert profile ids, used to scope every match query.
 *
 * Every read of match data goes through this rather than trusting a profile id
 * from the URL: a profile id in a query string is user input, and joining on
 * it without this check would expose another account's matches.
 */
export async function userProfileIds(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.alertProfiles.id })
    .from(schema.alertProfiles)
    .where(and(eq(schema.alertProfiles.userId, userId), isNull(schema.alertProfiles.deletedAt)));
  return rows.map((row) => row.id);
}
