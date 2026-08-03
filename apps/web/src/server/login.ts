import { cookies } from 'next/headers';
import { and, eq, gte, isNull } from 'drizzle-orm';
import {
  issueSession,
  redeemMagicLink,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
  MAGIC_LINK_FAILURE_NB,
  type MagicLinkStore,
} from '@luma/auth';
import * as schema from '@luma/db/schema';
import type { Database } from './db';
import { authPepper, getWebDb } from './db';

/**
 * Redeeming a magic link and establishing a session.
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
 * The logic itself is not reimplemented: `redeemMagicLink` and `issueSession`
 * come from `@luma/auth`, so the single-use guarantee, the expiry rule and the
 * session lifetime are identical to the API's.
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
    sessionCookieOptions({ isProduction: process.env.NODE_ENV === 'production' }),
  );

  return { ok: true, userId: redemption.userId };
}
