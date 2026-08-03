import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Bearer-token authentication for the MCP server (spec section 30).
 *
 * This module lives in `@luma/mcp-tools` rather than in `apps/mcp` because
 * every tool has to call `requireScope` before it touches data, and a package
 * must not depend on an app. `apps/mcp/src/auth.ts` re-exports it, so the
 * transport layer keeps its familiar import path and its tests are unchanged.
 *
 * Constraints from the spec that shape this module:
 *   - only a hash of the token is ever stored
 *   - the token must never appear in a URL and never in a log
 *   - tokens can be revoked and rotated, and scope is checked on every call
 *
 * The hash is peppered with a server-side secret so that a leaked database
 * dump alone does not let an attacker verify guessed tokens offline.
 */

export const MCP_SCOPES = [
  'tenders:read',
  'profiles:read',
  'profiles:write',
  'saved:read',
  'saved:write',
  'feedback:write',
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

/** Tokens are issued with this prefix so a leaked string is recognisable. */
export const TOKEN_PREFIX = 'lum_mcp_';

export interface AuthenticatedCaller {
  userId: string;
  tokenId: string;
  scopes: readonly McpScope[];
}

/** Looks up a token by its hash. Implemented by the database layer. */
export type TokenLookup = (tokenHash: string) => Promise<
  | {
      tokenId: string;
      userId: string;
      scopes: readonly McpScope[];
      revokedAt?: Date | null;
      expiresAt?: Date | null;
    }
  | undefined
>;

export function hashToken(token: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}:${token}`).digest('hex');
}

/**
 * Extracts a bearer token from an Authorization header.
 *
 * Returns undefined rather than throwing, so that a malformed header and a
 * missing header produce the same outcome and cannot be distinguished by a
 * caller probing for valid formats.
 */
export function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

export type AuthResult =
  | { readonly ok: true; readonly caller: AuthenticatedCaller }
  | { readonly ok: false; readonly reason: 'missing' | 'invalid' | 'revoked' | 'expired' };

export async function authenticate(input: {
  authorizationHeader: string | undefined;
  pepper: string;
  lookup: TokenLookup;
  now: Date;
}): Promise<AuthResult> {
  const token = extractBearerToken(input.authorizationHeader);
  if (!token) return { ok: false, reason: 'missing' };

  const record = await input.lookup(hashToken(token, input.pepper));
  if (!record) return { ok: false, reason: 'invalid' };
  if (record.revokedAt) return { ok: false, reason: 'revoked' };
  if (record.expiresAt && record.expiresAt <= input.now) return { ok: false, reason: 'expired' };

  return {
    ok: true,
    caller: { userId: record.userId, tokenId: record.tokenId, scopes: record.scopes },
  };
}

/** Compares two secrets without leaking their relationship through timing. */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export class ScopeError extends Error {
  constructor(readonly required: McpScope) {
    super(`Mangler tilgang: ${required}`);
    this.name = 'ScopeError';
  }
}

/**
 * Every tool calls this before touching data (spec section 40: verify scope on
 * every call; a read tool cannot write).
 */
export function requireScope(caller: AuthenticatedCaller, scope: McpScope): void {
  if (!caller.scopes.includes(scope)) throw new ScopeError(scope);
}
