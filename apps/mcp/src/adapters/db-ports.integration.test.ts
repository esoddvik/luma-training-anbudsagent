import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { alertProfiles, mcpAuditEvents, mcpTokens, tenders, users } from '@luma/db';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import { hashToken, invokeTool, type AuthenticatedCaller } from '@luma/mcp-tools';
import { createTokenLookup, createToolPorts } from './db-ports.js';
import { authenticate } from '@luma/mcp-tools';

/**
 * The database adapter for the MCP tool ports, against a real PostgreSQL.
 *
 * The property worth proving here cannot be proven with the in-memory ports:
 * that the SQL itself is scoped to the caller. The in-memory implementation
 * filters correctly because it was written to; this checks the queries do.
 */

const describeDb = hasDatabase ? describe : describe.skip;
const PEPPER = 'p'.repeat(32);
const now = new Date('2026-08-10T09:00:00Z');

describeDb('the database adapter', () => {
  let harness: TestDatabase;
  let db: TestDatabase['db'];
  let alice: { userId: string; profileId: string; caller: AuthenticatedCaller };
  let bob: { userId: string; profileId: string; caller: AuthenticatedCaller };
  let tenderId: string;

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db;
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  async function makeUser(email: string, token: string) {
    const userRows = await db.insert(users).values({ email }).returning({ id: users.id });
    const userId = userRows[0]!.id;

    const profileRows = await db
      .insert(alertProfiles)
      .values({ userId, name: `Profil for ${email}`, minimumMatchScore: 20 })
      .returning({ id: alertProfiles.id });

    const tokenRows = await db
      .insert(mcpTokens)
      .values({
        userId,
        name: 'Testtoken',
        prefix: token.slice(0, 8),
        tokenHash: hashToken(token, PEPPER),
        scopes: ['tenders:read', 'profiles:read', 'saved:read', 'saved:write'],
      })
      .returning({ id: mcpTokens.id });

    return {
      userId,
      profileId: profileRows[0]!.id,
      caller: {
        userId,
        tokenId: tokenRows[0]!.id,
        scopes: ['tenders:read', 'profiles:read', 'saved:read', 'saved:write'],
      } as AuthenticatedCaller,
    };
  }

  beforeEach(async () => {
    await db.execute(sql`truncate table ${users}, ${tenders} restart identity cascade`);

    alice = await makeUser('alice@entreprenor.no', 'alice-token-value');
    bob = await makeUser('bob@radgiver.no', 'bob-token-value');

    const tenderRows = await db
      .insert(tenders)
      .values({
        source: 'doffin',
        sourceId: '2026-900100',
        sourceUrl: 'https://www.doffin.no/notices/2026-900100',
        title: 'Rammeavtale for renhold',
        buyerName: 'Bærum kommune',
        noticeCategory: 'competition',
        status: 'open',
        publishedAt: new Date('2026-08-09T00:00:00Z'),
        sourcePayloadHash: 'hash-1',
        rawPayload: {},
      })
      .returning({ id: tenders.id });
    tenderId = tenderRows[0]!.id;
  });

  describe('user isolation', () => {
    it('lists only the caller’s own profiles', async () => {
      const ports = createToolPorts(db);
      const forAlice = await ports.profiles.listProfiles(alice.userId);
      const forBob = await ports.profiles.listProfiles(bob.userId);

      expect(forAlice).toHaveLength(1);
      expect(forBob).toHaveLength(1);
      expect(forAlice[0]?.id).not.toBe(forBob[0]?.id);
    });

    it('refuses to resolve another user’s profile by id', async () => {
      // Scoped in SQL, so Bob's profile is simply not found for Alice rather
      // than found and then rejected in application code.
      const ports = createToolPorts(db);
      expect(await ports.profiles.getProfile(alice.userId, bob.profileId)).toBeUndefined();
      expect(await ports.profiles.getProfile(alice.userId, alice.profileId)).toBeDefined();
    });

    it('keeps saved state separate between users', async () => {
      const ports = createToolPorts(db);
      await ports.userTenderState.saveTender(alice.userId, tenderId, now);

      expect((await ports.userTenderState.getState(alice.userId, tenderId))?.saved).toBe(true);
      expect(await ports.userTenderState.getState(bob.userId, tenderId)).toBeUndefined();
    });

    it('does not leak another user’s profile through the tool layer', async () => {
      const result = await invokeTool(
        'get_alert_profile',
        { profileId: bob.profileId },
        { caller: alice.caller, ports: createToolPorts(db), now },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('not_found');
    });
  });

  describe('saved and dismissed state', () => {
    it('records a save and then a dismiss without losing either timestamp', async () => {
      // A user who saves something they previously dismissed should not erase
      // the record of having dismissed it; support reads both.
      const ports = createToolPorts(db);
      await ports.userTenderState.dismissTender(alice.userId, tenderId, now);
      const after = await ports.userTenderState.saveTender(
        alice.userId,
        tenderId,
        new Date('2026-08-11T09:00:00Z'),
      );

      expect(after.saved).toBe(true);
      expect(after.dismissedAt).not.toBeNull();
    });

    it('is idempotent when the same tender is saved twice', async () => {
      const ports = createToolPorts(db);
      await ports.userTenderState.saveTender(alice.userId, tenderId, now);
      await ports.userTenderState.saveTender(alice.userId, tenderId, now);

      const states = await ports.userTenderState.listStates(alice.userId, [tenderId]);
      expect(states).toHaveLength(1);
    });
  });

  describe('tender reads', () => {
    it('finds a tender by free text against the real query', async () => {
      const ports = createToolPorts(db);
      const page = await ports.tenders.searchTenders({ text: 'renhold' }, { limit: 10, offset: 0 });
      expect(page.items.map((item) => item.sourceId)).toEqual(['2026-900100']);
    });

    it('hides a suppressed tender from every read', async () => {
      // Spec §45: an administrator suppressing an invalid notice must remove
      // it from every product surface, not only the dashboard.
      await db.update(tenders).set({ suppressedAt: now });
      const ports = createToolPorts(db);

      expect((await ports.tenders.searchTenders({}, { limit: 10, offset: 0 })).items).toEqual([]);
      expect(await ports.tenders.getTender(tenderId)).toBeUndefined();
    });

    it('never offers an award notice as a match candidate', async () => {
      await db.update(tenders).set({ noticeCategory: 'award' });
      const ports = createToolPorts(db);

      const candidates = await ports.tenders.listMatchCandidates({ includePlanned: true }, 100);
      expect(candidates).toEqual([]);
    });

    it('reports hasMore without counting the whole result set', async () => {
      await db.insert(tenders).values(
        Array.from({ length: 5 }, (_unused, i) => ({
          source: 'doffin' as const,
          sourceId: `2026-9002${i}`,
          sourceUrl: `https://www.doffin.no/notices/2026-9002${i}`,
          title: `Anbud ${i}`,
          buyerName: 'Oslo kommune',
          noticeCategory: 'competition' as const,
          status: 'open' as const,
          publishedAt: new Date('2026-08-08T00:00:00Z'),
          sourcePayloadHash: `hash-${i}`,
          rawPayload: {},
        })),
      );

      const ports = createToolPorts(db);
      const page = await ports.tenders.searchTenders({}, { limit: 2, offset: 0 });
      expect(page.items).toHaveLength(2);
      expect(page.hasMore).toBe(true);
    });
  });

  describe('token lookup', () => {
    it('resolves a valid token to its user and scopes', async () => {
      const result = await authenticate({
        authorizationHeader: 'Bearer alice-token-value',
        pepper: PEPPER,
        lookup: createTokenLookup(db),
        now,
      });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.caller.userId).toBe(alice.userId);
    });

    it('refuses a revoked token', async () => {
      await db.update(mcpTokens).set({ revokedAt: now });
      const result = await authenticate({
        authorizationHeader: 'Bearer alice-token-value',
        pepper: PEPPER,
        lookup: createTokenLookup(db),
        now,
      });

      expect(result).toEqual({ ok: false, reason: 'revoked' });
    });

    it('refuses a token that was never issued', async () => {
      const result = await authenticate({
        authorizationHeader: 'Bearer not-a-real-token',
        pepper: PEPPER,
        lookup: createTokenLookup(db),
        now,
      });
      expect(result).toEqual({ ok: false, reason: 'invalid' });
    });

    it('stores no cleartext token anywhere', async () => {
      const rows = await db.select().from(mcpTokens);
      for (const row of rows) {
        expect(row.tokenHash).not.toContain('token-value');
        expect(JSON.stringify(row)).not.toContain('alice-token-value');
      }
    });
  });

  describe('audit', () => {
    it('records a successful call', async () => {
      const ports = createToolPorts(db);
      await invokeTool('list_alert_profiles', {}, { caller: alice.caller, ports, now });

      const events = await db.select().from(mcpAuditEvents);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ tool: 'list_alert_profiles', outcome: 'ok' });
    });

    it('records a refused call as denied rather than as an error', async () => {
      // A spike in denials is a scope or revocation problem; a spike in errors
      // is a bug. Collapsing them would hide both.
      const readOnly: AuthenticatedCaller = { ...alice.caller, scopes: ['tenders:read'] };
      const ports = createToolPorts(db);
      await invokeTool('save_tender', { tenderId }, { caller: readOnly, ports, now });

      const events = await db.select().from(mcpAuditEvents);
      expect(events[0]?.outcome).toBe('denied');
    });

    it('stores no free text from the call', async () => {
      // Spec §9.5: conversation content is not stored. The audit event type
      // has no field for it, and this proves the row agrees.
      const ports = createToolPorts(db);
      await invokeTool(
        'search_tenders',
        { query: 'hemmelig forretningsstrategi' },
        { caller: alice.caller, ports, now },
      );

      const events = await db.select().from(mcpAuditEvents);
      expect(JSON.stringify(events)).not.toContain('hemmelig');
    });
  });
});
