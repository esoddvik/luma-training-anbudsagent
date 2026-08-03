import { describe, expect, it } from 'vitest';
import {
  authenticate,
  extractBearerToken,
  hashToken,
  requireScope,
  ScopeError,
  secretsMatch,
  type McpScope,
  type TokenLookup,
} from './auth.js';

const PEPPER = 'p'.repeat(32);
const now = new Date('2026-06-01T00:00:00Z');

function lookupFor(
  token: string,
  record: Partial<Awaited<ReturnType<TokenLookup>>> = {},
): TokenLookup {
  const expected = hashToken(token, PEPPER);
  return async (hash) =>
    hash === expected
      ? {
          tokenId: 'token-1',
          userId: 'user-1',
          scopes: ['tenders:read'] as McpScope[],
          ...record,
        }
      : undefined;
}

describe('hashToken', () => {
  it('is stable for the same token and pepper', () => {
    expect(hashToken('abc', PEPPER)).toBe(hashToken('abc', PEPPER));
  });

  it('differs for different tokens', () => {
    expect(hashToken('abc', PEPPER)).not.toBe(hashToken('abd', PEPPER));
  });

  it('differs under a different pepper, so a stolen database is not enough', () => {
    expect(hashToken('abc', PEPPER)).not.toBe(hashToken('abc', 'q'.repeat(32)));
  });

  it('never returns the token itself', () => {
    expect(hashToken('lum_mcp_secret', PEPPER)).not.toContain('secret');
  });
});

describe('extractBearerToken', () => {
  it('reads a well-formed header', () => {
    expect(extractBearerToken('Bearer lum_mcp_abc')).toBe('lum_mcp_abc');
  });

  it('is case-insensitive on the scheme', () => {
    expect(extractBearerToken('bearer lum_mcp_abc')).toBe('lum_mcp_abc');
  });

  it('tolerates surrounding whitespace', () => {
    expect(extractBearerToken('  Bearer lum_mcp_abc  ')).toBe('lum_mcp_abc');
  });

  it.each([undefined, '', 'lum_mcp_abc', 'Basic abc', 'Bearer', 'Bearer a b'])(
    'returns undefined for %s',
    (header) => {
      expect(extractBearerToken(header)).toBeUndefined();
    },
  );
});

describe('authenticate', () => {
  it('accepts a valid token and returns the caller', async () => {
    const result = await authenticate({
      authorizationHeader: 'Bearer good-token',
      pepper: PEPPER,
      lookup: lookupFor('good-token'),
      now,
    });
    expect(result).toEqual({
      ok: true,
      caller: { userId: 'user-1', tokenId: 'token-1', scopes: ['tenders:read'] },
    });
  });

  it('rejects a missing header', async () => {
    const result = await authenticate({
      authorizationHeader: undefined,
      pepper: PEPPER,
      lookup: lookupFor('good-token'),
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects an unknown token', async () => {
    const result = await authenticate({
      authorizationHeader: 'Bearer wrong-token',
      pepper: PEPPER,
      lookup: lookupFor('good-token'),
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects a revoked token', async () => {
    const result = await authenticate({
      authorizationHeader: 'Bearer good-token',
      pepper: PEPPER,
      lookup: lookupFor('good-token', { revokedAt: new Date('2026-05-01') }),
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'revoked' });
  });

  it('rejects an expired token', async () => {
    const result = await authenticate({
      authorizationHeader: 'Bearer good-token',
      pepper: PEPPER,
      lookup: lookupFor('good-token', { expiresAt: new Date('2026-05-01') }),
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('accepts a token whose expiry is still ahead', async () => {
    const result = await authenticate({
      authorizationHeader: 'Bearer good-token',
      pepper: PEPPER,
      lookup: lookupFor('good-token', { expiresAt: new Date('2027-01-01') }),
      now,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects revocation ahead of expiry when both apply', async () => {
    const result = await authenticate({
      authorizationHeader: 'Bearer good-token',
      pepper: PEPPER,
      lookup: lookupFor('good-token', {
        revokedAt: new Date('2026-05-01'),
        expiresAt: new Date('2026-05-15'),
      }),
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'revoked' });
  });

  it('never passes the raw token to the lookup', async () => {
    const seen: string[] = [];
    await authenticate({
      authorizationHeader: 'Bearer plaintext-secret',
      pepper: PEPPER,
      lookup: async (hash) => {
        seen.push(hash);
        return undefined;
      },
      now,
    });
    expect(seen[0]).not.toContain('plaintext-secret');
    expect(seen[0]).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('requireScope', () => {
  const caller = { userId: 'u', tokenId: 't', scopes: ['tenders:read'] as McpScope[] };

  it('allows a granted scope', () => {
    expect(() => requireScope(caller, 'tenders:read')).not.toThrow();
  });

  it('refuses a scope the token does not carry', () => {
    // A read-only token must not be able to reach a write tool.
    expect(() => requireScope(caller, 'profiles:write')).toThrow(ScopeError);
  });

  it('reports which scope was missing, in Norwegian', () => {
    expect(() => requireScope(caller, 'saved:write')).toThrow('Mangler tilgang: saved:write');
  });
});

describe('secretsMatch', () => {
  it('is true for identical secrets', () => {
    expect(secretsMatch('abc123', 'abc123')).toBe(true);
  });

  it('is false for different secrets of equal length', () => {
    expect(secretsMatch('abc123', 'abc124')).toBe(false);
  });

  it('is false for different lengths without throwing', () => {
    expect(secretsMatch('abc', 'abcdef')).toBe(false);
  });
});
