import { describe, expect, it } from 'vitest';
import {
  emailSchema,
  issueMagicLink,
  MAGIC_LINK_GENERIC_RESPONSE_NB,
  redeemMagicLink,
  type MagicLinkRecord,
  type MagicLinkStore,
} from './magic-link.js';
import { hashToken } from './tokens.js';

const PEPPER = 'p'.repeat(32);
const now = new Date('2026-06-01T12:00:00Z');

/**
 * An in-memory store whose `consume` is atomic in the same sense the real one
 * must be: the first caller wins and every later caller is told it was already
 * used. Tests that rely on single-use would pass against a naive store, so the
 * fake deliberately models the race.
 */
function makeStore(seed: MagicLinkRecord[] = []) {
  const records = new Map(seed.map((record) => [record.tokenHash, record]));
  let consumeCalls = 0;
  return {
    consumeCalls: () => consumeCalls,
    store: {
      findByHash: async (hash) => records.get(hash),
      consume: async (id, consumedAt) => {
        consumeCalls += 1;
        for (const record of records.values()) {
          if (record.id !== id) continue;
          if (record.consumedAt) return false;
          record.consumedAt = consumedAt;
          return true;
        }
        return false;
      },
      countRecentForUser: async () => 0,
    } satisfies MagicLinkStore,
  };
}

function record(token: string, overrides: Partial<MagicLinkRecord> = {}): MagicLinkRecord {
  return {
    id: 'link-1',
    userId: 'user-1',
    tokenHash: hashToken(token, PEPPER),
    expiresAt: new Date('2026-06-01T12:10:00Z'),
    createdAt: new Date('2026-06-01T11:55:00Z'),
    ...overrides,
  };
}

describe('emailSchema', () => {
  it('lowercases and trims, so one address cannot become two accounts', () => {
    expect(emailSchema.parse('  Espen@Luma-Training.COM ')).toBe('espen@luma-training.com');
  });

  it.each(['not-an-email', '@luma-training.com', 'espen@', ''])('rejects %s', (value) => {
    expect(emailSchema.safeParse(value).success).toBe(false);
  });

  it('rejects an address beyond the RFC length limit', () => {
    const long = `${'a'.repeat(250)}@luma-training.com`;
    expect(emailSchema.safeParse(long).success).toBe(false);
  });
});

describe('issueMagicLink', () => {
  it('returns a token and a hash that are not the same value', () => {
    const link = issueMagicLink({ pepper: PEPPER, now });
    expect(link.tokenHash).not.toBe(link.token);
    expect(link.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different token every time', () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => issueMagicLink({ pepper: PEPPER, now }).token),
    );
    expect(tokens.size).toBe(50);
  });

  it('expires fifteen minutes out by default', () => {
    const link = issueMagicLink({ pepper: PEPPER, now });
    expect(link.expiresAt.toISOString()).toBe('2026-06-01T12:15:00.000Z');
  });

  it('honours an explicit lifetime', () => {
    const link = issueMagicLink({ pepper: PEPPER, now, ttlMinutes: 5 });
    expect(link.expiresAt.toISOString()).toBe('2026-06-01T12:05:00.000Z');
  });

  it('hashes with the pepper, so a database dump alone cannot verify a guess', () => {
    const link = issueMagicLink({ pepper: PEPPER, now });
    expect(hashToken(link.token, 'a-different-pepper')).not.toBe(link.tokenHash);
  });
});

describe('redeemMagicLink', () => {
  it('accepts a valid, unexpired, unused link', async () => {
    const { store } = makeStore([record('good')]);
    expect(await redeemMagicLink({ token: 'good', pepper: PEPPER, store, now })).toEqual({
      ok: true,
      userId: 'user-1',
    });
  });

  it('rejects an unknown token', async () => {
    const { store } = makeStore([record('good')]);
    expect(await redeemMagicLink({ token: 'wrong', pepper: PEPPER, store, now })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects an expired link', async () => {
    const { store } = makeStore([record('good', { expiresAt: new Date('2026-06-01T11:59:00Z') })]);
    expect(await redeemMagicLink({ token: 'good', pepper: PEPPER, store, now })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('treats the exact expiry instant as expired', async () => {
    const { store } = makeStore([record('good', { expiresAt: now })]);
    expect((await redeemMagicLink({ token: 'good', pepper: PEPPER, store, now })).ok).toBe(false);
  });

  it('is single use: the second redemption fails', async () => {
    const { store } = makeStore([record('good')]);
    const first = await redeemMagicLink({ token: 'good', pepper: PEPPER, store, now });
    const second = await redeemMagicLink({ token: 'good', pepper: PEPPER, store, now });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: 'already_used' });
  });

  it('lets only one of two concurrent redemptions succeed', async () => {
    // The link arrives by email, so a mail scanner prefetching the URL while
    // the user clicks it is a realistic double redemption, not a contrived one.
    const { store } = makeStore([record('good')]);
    const results = await Promise.all([
      redeemMagicLink({ token: 'good', pepper: PEPPER, store, now }),
      redeemMagicLink({ token: 'good', pepper: PEPPER, store, now }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  it('does not attempt to consume a link it already knows is expired', async () => {
    const { store, consumeCalls } = makeStore([
      record('good', { expiresAt: new Date('2026-06-01T11:00:00Z') }),
    ]);
    await redeemMagicLink({ token: 'good', pepper: PEPPER, store, now });
    expect(consumeCalls()).toBe(0);
  });

  it('never passes the raw token to the store', async () => {
    const seen: string[] = [];
    const store: MagicLinkStore = {
      findByHash: async (hash) => {
        seen.push(hash);
        return undefined;
      },
      consume: async () => false,
      countRecentForUser: async () => 0,
    };
    await redeemMagicLink({ token: 'plaintext-secret', pepper: PEPPER, store, now });
    expect(seen[0]).not.toContain('plaintext-secret');
  });
});

describe('the generic login response', () => {
  it('reveals nothing about whether the address exists', () => {
    // Spec section 10: generic responses, to prevent account enumeration.
    expect(MAGIC_LINK_GENERIC_RESPONSE_NB).toMatch(/^Hvis adressen er registrert/);
    expect(MAGIC_LINK_GENERIC_RESPONSE_NB).not.toMatch(/finnes ikke|ukjent|ingen konto/i);
  });
});
