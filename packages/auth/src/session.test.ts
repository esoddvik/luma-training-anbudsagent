import { describe, expect, it } from 'vitest';
import {
  clearedSessionCookieOptions,
  issueSession,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
  validateSession,
  type SessionRecord,
  type SessionStore,
} from './session.js';
import { hashToken } from './tokens.js';

const PEPPER = 'p'.repeat(32);
const now = new Date('2026-06-01T12:00:00Z');

function makeStore(seed: SessionRecord[] = []) {
  const records = [...seed];
  const touched: string[] = [];
  return {
    touched,
    records,
    store: {
      findByHash: async (hash) => records.find((r) => r.tokenHash === hash),
      touch: async (id, lastUsedAt) => {
        touched.push(id);
        const found = records.find((r) => r.id === id);
        if (found) found.lastUsedAt = lastUsedAt;
      },
      revoke: async (id, revokedAt) => {
        const found = records.find((r) => r.id === id);
        if (found) found.revokedAt = revokedAt;
      },
      revokeAllForUser: async (userId, revokedAt) => {
        let count = 0;
        for (const r of records) {
          if (r.userId === userId && !r.revokedAt) {
            r.revokedAt = revokedAt;
            count += 1;
          }
        }
        return count;
      },
    } satisfies SessionStore,
  };
}

function session(token: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session-1',
    userId: 'user-1',
    tokenHash: hashToken(token, PEPPER),
    expiresAt: new Date('2026-06-20T12:00:00Z'),
    lastUsedAt: new Date('2026-06-01T11:00:00Z'),
    createdAt: new Date('2026-05-25T12:00:00Z'),
    ...overrides,
  };
}

describe('issueSession', () => {
  it('stores a hash rather than the cookie value', () => {
    const issued = issueSession({ pepper: PEPPER, now });
    expect(issued.tokenHash).not.toBe(issued.token);
    expect(issued.tokenHash).toBe(hashToken(issued.token, PEPPER));
  });

  it('expires thirty days out by default', () => {
    expect(issueSession({ pepper: PEPPER, now }).expiresAt.toISOString()).toBe(
      '2026-07-01T12:00:00.000Z',
    );
  });

  it('produces unguessable, distinct tokens', () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => issueSession({ pepper: PEPPER, now }).token),
    );
    expect(tokens.size).toBe(50);
    expect([...tokens][0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('validateSession', () => {
  it('accepts a live session and reports the user', async () => {
    const { store } = makeStore([session('good')]);
    expect(await validateSession({ token: 'good', pepper: PEPPER, store, now })).toEqual({
      ok: true,
      userId: 'user-1',
      sessionId: 'session-1',
    });
  });

  it('rejects a missing cookie', async () => {
    const { store } = makeStore([session('good')]);
    expect(await validateSession({ token: undefined, pepper: PEPPER, store, now })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects an unknown token', async () => {
    const { store } = makeStore([session('good')]);
    expect((await validateSession({ token: 'other', pepper: PEPPER, store, now })).reason).toBe(
      'invalid',
    );
  });

  it('rejects an expired session', async () => {
    const { store } = makeStore([session('good', { expiresAt: new Date('2026-05-01T12:00:00Z') })]);
    expect((await validateSession({ token: 'good', pepper: PEPPER, store, now })).reason).toBe(
      'expired',
    );
  });

  it('rejects a revoked session immediately', async () => {
    // This is the property an opaque session buys over a signed token: the
    // server can end a session the moment the user asks, not at expiry.
    const { store } = makeStore([session('good', { revokedAt: new Date('2026-05-30T00:00:00Z') })]);
    expect((await validateSession({ token: 'good', pepper: PEPPER, store, now })).reason).toBe(
      'revoked',
    );
  });

  it('rejects a session left idle past the timeout', async () => {
    const { store } = makeStore([
      session('good', { lastUsedAt: new Date('2026-05-01T12:00:00Z') }),
    ]);
    expect((await validateSession({ token: 'good', pepper: PEPPER, store, now })).reason).toBe(
      'idle',
    );
  });

  it('records use so an active session does not fall to the idle timeout', async () => {
    const { store, touched } = makeStore([session('good')]);
    await validateSession({ token: 'good', pepper: PEPPER, store, now });
    expect(touched).toEqual(['session-1']);
  });

  it('does not record use for a session it rejected', async () => {
    const { store, touched } = makeStore([session('good', { revokedAt: now })]);
    await validateSession({ token: 'good', pepper: PEPPER, store, now });
    expect(touched).toEqual([]);
  });
});

describe('revokeAllForUser', () => {
  it('ends every live session for that user and no one else', async () => {
    const { store } = makeStore([
      session('a', { id: 's1', userId: 'user-1', tokenHash: hashToken('a', PEPPER) }),
      session('b', { id: 's2', userId: 'user-1', tokenHash: hashToken('b', PEPPER) }),
      session('c', { id: 's3', userId: 'user-2', tokenHash: hashToken('c', PEPPER) }),
    ]);

    expect(await store.revokeAllForUser('user-1', now)).toBe(2);
    expect((await validateSession({ token: 'a', pepper: PEPPER, store, now })).ok).toBe(false);
    expect((await validateSession({ token: 'b', pepper: PEPPER, store, now })).ok).toBe(false);
    expect((await validateSession({ token: 'c', pepper: PEPPER, store, now })).ok).toBe(true);
  });
});

describe('session cookie', () => {
  it('is HttpOnly so script cannot read it', () => {
    expect(sessionCookieOptions({ isProduction: true }).httpOnly).toBe(true);
  });

  it('is Secure in production', () => {
    expect(sessionCookieOptions({ isProduction: true }).secure).toBe(true);
  });

  it('drops Secure outside production, because local development is plain HTTP', () => {
    expect(sessionCookieOptions({ isProduction: false }).secure).toBe(false);
  });

  it('uses SameSite=Lax so the click from the login email still carries it', () => {
    // Strict would drop the cookie on the cross-site navigation from the email
    // client and bounce the user back to the login page.
    expect(sessionCookieOptions({ isProduction: true }).sameSite).toBe('lax');
  });

  it('matches the session lifetime', () => {
    expect(sessionCookieOptions({ isProduction: true }).maxAge).toBe(30 * 86_400);
  });

  it('is cleared with a zero lifetime on logout', () => {
    expect(clearedSessionCookieOptions({ isProduction: true }).maxAge).toBe(0);
  });

  it('defaults to the root path, which is what apps/core needs on its own host', () => {
    expect(sessionCookieOptions({ isProduction: true }).path).toBe('/');
  });

  it('scopes to a base path when one is given, so a shared origin gets no copy', () => {
    // apps/web shares luma-training.com with the marketing site. At `/` the
    // browser would attach this credential to every page of that site.
    expect(sessionCookieOptions({ isProduction: true, path: '/anbudsvarsling' }).path).toBe(
      '/anbudsvarsling',
    );
  });

  it('clears on the same path it was set on', () => {
    // A cookie set at `/anbudsvarsling` and deleted at `/` is not deleted. The
    // logout reports success and the browser stays signed in.
    const set = sessionCookieOptions({ isProduction: true, path: '/anbudsvarsling' });
    const cleared = clearedSessionCookieOptions({
      isProduction: true,
      path: '/anbudsvarsling',
    });
    expect(cleared.path).toBe(set.path);
  });

  it('uses a stable, non-descriptive cookie name', () => {
    expect(SESSION_COOKIE_NAME).toBe('luma_session');
  });
});
