/**
 * Role and ownership checks (spec section 10: role control for admin;
 * spec section 39: authorisation in the service layer, not in the route).
 */

export type Role = 'user' | 'admin';

/**
 * Admin membership comes from a configured allowlist rather than a database
 * flag, so that gaining admin access requires a deploy or an environment
 * change rather than a row update.
 */
export function resolveRole(email: string, adminAllowlist: readonly string[]): Role {
  const normalized = email.trim().toLowerCase();
  return adminAllowlist.some((entry) => entry.trim().toLowerCase() === normalized)
    ? 'admin'
    : 'user';
}

export class AuthorizationError extends Error {
  readonly statusCode = 403;
  constructor(message = 'Du har ikke tilgang til denne ressursen.') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class AuthenticationError extends Error {
  readonly statusCode = 401;
  constructor(message = 'Du må logge inn for å fortsette.') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export function requireAdmin(role: Role): void {
  if (role !== 'admin') throw new AuthorizationError();
}

/**
 * The single ownership check every service call goes through.
 *
 * Written as a throwing assertion rather than a boolean because a boolean
 * invites a call site that computes the answer and forgets to act on it. Every
 * multi-tenant leak in this codebase would come from exactly that shape, so
 * the check is made hard to ignore.
 */
export function requireOwnership(input: {
  resourceOwnerId: string | undefined;
  actorId: string;
  actorRole: Role;
}): void {
  if (input.resourceOwnerId === undefined) throw new AuthorizationError();
  if (input.resourceOwnerId === input.actorId) return;
  // Administrators can reach a user's data for support, and every such access
  // is written to admin_audit_events by the caller (spec section 45).
  if (input.actorRole === 'admin') return;
  throw new AuthorizationError();
}
