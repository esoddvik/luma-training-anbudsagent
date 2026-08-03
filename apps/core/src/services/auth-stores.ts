import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import type { MagicLinkRecord, MagicLinkStore, SessionRecord, SessionStore } from '@luma/auth';
import type { Database } from '@luma/db';
import { magicLinkTokens, sessions } from '@luma/db';

/**
 * The database implementations of the two ports `@luma/auth` declares.
 *
 * `packages/auth` owns the login *rules* and knows nothing about storage; this
 * file is the other half. Nothing here decides whether a link is valid — it
 * only reads and writes rows, so the rules stay in one tested place (ADR-0016).
 */

export class DbMagicLinkStore implements MagicLinkStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async findByHash(tokenHash: string): Promise<MagicLinkRecord | undefined> {
    const rows = await this.#db
      .select()
      .from(magicLinkTokens)
      .where(eq(magicLinkTokens.tokenHash, tokenHash))
      .limit(1);
    const row = rows[0];
    // A link issued for an address with no account has no user id. It is not a
    // redeemable link, and treating it as "not found" keeps the redeem
    // endpoint from distinguishing the two cases.
    if (!row?.userId) return undefined;
    return {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
      createdAt: row.requestedAt,
    };
  }

  /**
   * Single-use redemption, decided by the database rather than by the caller.
   *
   * The `IS NULL` guard is inside the UPDATE, so two clicks of the same link
   * race in PostgreSQL and exactly one of them gets a row count of 1. Reading
   * `consumedAt` first and updating second would leave a window in which both
   * succeed.
   */
  async consume(id: string, consumedAt: Date): Promise<boolean> {
    const updated = await this.#db
      .update(magicLinkTokens)
      .set({ consumedAt })
      .where(and(eq(magicLinkTokens.id, id), isNull(magicLinkTokens.consumedAt)))
      .returning({ id: magicLinkTokens.id });
    return updated.length === 1;
  }

  async countRecentForUser(userId: string, since: Date): Promise<number> {
    const rows = await this.#db
      .select({ count: sql<number>`count(*)::int` })
      .from(magicLinkTokens)
      .where(and(eq(magicLinkTokens.userId, userId), gte(magicLinkTokens.requestedAt, since)));
    return rows[0]?.count ?? 0;
  }

  /**
   * Requests for one address in a window, whether or not an account exists.
   *
   * Counting by address rather than by user is what makes the per-address
   * limit in spec §10 real: a limit keyed on the user id would not apply at all
   * to the addresses an attacker is probing.
   */
  async countRecentForEmail(email: string, since: Date): Promise<number> {
    const rows = await this.#db
      .select({ count: sql<number>`count(*)::int` })
      .from(magicLinkTokens)
      .where(and(eq(magicLinkTokens.email, email), gte(magicLinkTokens.requestedAt, since)));
    return rows[0]?.count ?? 0;
  }
}

export class DbSessionStore implements SessionStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async findByHash(tokenHash: string): Promise<SessionRecord | undefined> {
    const rows = await this.#db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    const row = rows[0];
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
  }

  async touch(id: string, lastUsedAt: Date): Promise<void> {
    await this.#db.update(sessions).set({ lastUsedAt }).where(eq(sessions.id, id));
  }

  async revoke(id: string, revokedAt: Date): Promise<void> {
    await this.#db.update(sessions).set({ revokedAt }).where(eq(sessions.id, id));
  }

  /** "Log out everywhere" (spec §10). Returns how many sessions were live. */
  async revokeAllForUser(userId: string, revokedAt: Date): Promise<number> {
    const revoked = await this.#db
      .update(sessions)
      .set({ revokedAt })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return revoked.length;
  }
}
