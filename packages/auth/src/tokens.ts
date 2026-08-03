import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Token generation and verification.
 *
 * The rule this module exists to enforce: a secret is generated once, shown
 * once, and only ever stored as a peppered SHA-256 hash. Nothing here returns
 * a stored secret, and nothing here accepts a stored secret for comparison.
 *
 * SHA-256 rather than a password hash such as argon2 is the right choice for
 * these particular secrets, and the reason is worth stating because it looks
 * wrong at a glance. Password hashes are slow on purpose because passwords are
 * low-entropy and guessable. These tokens are 256 bits of output from the
 * system CSPRNG, so brute force is not a threat model, and a slow hash on the
 * session-validation path would tax every authenticated request. The pepper
 * covers the remaining risk, that someone with a database dump could confirm a
 * guessed token offline.
 */

/** 32 bytes: 256 bits of entropy, base64url-encoded to 43 characters. */
const TOKEN_BYTES = 32;

export interface GeneratedToken {
  /** Shown to the user exactly once. Never persisted. */
  token: string;
  /** Persisted in place of the token. */
  tokenHash: string;
}

export function generateToken(pepper: string, prefix = ''): GeneratedToken {
  const token = `${prefix}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
  return { token, tokenHash: hashToken(token, pepper) };
}

export function hashToken(token: string, pepper: string): string {
  if (pepper.length === 0) {
    // An empty pepper would silently reduce this to a plain unsalted hash, so
    // it is a programming error rather than a configuration fallback.
    throw new Error('a pepper is required to hash a token');
  }
  return createHash('sha256').update(`${pepper}:${token}`, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of two hex hashes.
 *
 * Both operands here are hashes rather than secrets, so a timing leak would be
 * mild, but the function is also the one a future caller will reach for when
 * comparing something more sensitive.
 */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * A short, non-secret prefix stored alongside the hash so a user can tell two
 * of their tokens apart in a list without the full value being recoverable.
 */
export function tokenDisplayPrefix(token: string, length = 8): string {
  return token.slice(0, length);
}
