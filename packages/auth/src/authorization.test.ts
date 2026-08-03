import { describe, expect, it } from 'vitest';
import {
  AuthorizationError,
  requireAdmin,
  requireOwnership,
  resolveRole,
} from './authorization.js';

describe('resolveRole', () => {
  const allowlist = ['espen@luma-training.com', 'admin@luma-training.com'];

  it('grants admin to an allowlisted address', () => {
    expect(resolveRole('espen@luma-training.com', allowlist)).toBe('admin');
  });

  it('compares case-insensitively and ignores whitespace', () => {
    expect(resolveRole('  Espen@Luma-Training.com ', allowlist)).toBe('admin');
  });

  it('gives an ordinary user the user role', () => {
    expect(resolveRole('kunde@entreprenor.no', allowlist)).toBe('user');
  });

  it('grants nobody admin when the allowlist is empty', () => {
    expect(resolveRole('espen@luma-training.com', [])).toBe('user');
  });

  it('does not treat a substring of an allowlisted address as a match', () => {
    expect(resolveRole('not-espen@luma-training.com.evil.no', allowlist)).toBe('user');
  });
});

describe('requireAdmin', () => {
  it('allows an admin', () => {
    expect(() => requireAdmin('admin')).not.toThrow();
  });

  it('refuses a user, in Norwegian', () => {
    expect(() => requireAdmin('user')).toThrow('Du har ikke tilgang til denne ressursen.');
  });

  it('throws a 403-carrying error', () => {
    try {
      requireAdmin('user');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthorizationError);
      expect((error as AuthorizationError).statusCode).toBe(403);
    }
  });
});

describe('requireOwnership', () => {
  it('allows the owner', () => {
    expect(() =>
      requireOwnership({ resourceOwnerId: 'u1', actorId: 'u1', actorRole: 'user' }),
    ).not.toThrow();
  });

  it('refuses a different user', () => {
    // The multi-tenant boundary: one customer must never read another's data.
    expect(() =>
      requireOwnership({ resourceOwnerId: 'u1', actorId: 'u2', actorRole: 'user' }),
    ).toThrow(AuthorizationError);
  });

  it('allows an administrator, for support access', () => {
    expect(() =>
      requireOwnership({ resourceOwnerId: 'u1', actorId: 'admin-1', actorRole: 'admin' }),
    ).not.toThrow();
  });

  it('refuses when the resource has no owner, rather than defaulting to allow', () => {
    // A missing owner usually means the row was not found. Treating that as
    // permitted would turn a lookup miss into an authorisation bypass.
    expect(() =>
      requireOwnership({ resourceOwnerId: undefined, actorId: 'u1', actorRole: 'user' }),
    ).toThrow(AuthorizationError);
  });

  it('refuses an unowned resource even for an administrator', () => {
    expect(() =>
      requireOwnership({ resourceOwnerId: undefined, actorId: 'a1', actorRole: 'admin' }),
    ).toThrow(AuthorizationError);
  });

  it('does not treat an empty string owner as a match for an empty actor', () => {
    expect(() =>
      requireOwnership({ resourceOwnerId: '', actorId: 'u1', actorRole: 'user' }),
    ).toThrow(AuthorizationError);
  });
});
