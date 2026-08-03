import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Webhook authentication (spec section 27, ADR-0005).
 *
 * Postmark posts to a URL that is, from the internet's point of view, a public
 * endpoint that writes to our database. HTTP basic auth against configured
 * credentials is what the specification calls for.
 *
 * The comparison is constant time, and it compares SHA-256 digests rather than
 * the raw strings. Digests are fixed length, which matters twice:
 * `timingSafeEqual` throws on a length mismatch, and comparing raw values
 * would leak the credential's length through that very exception.
 */

export interface WebhookCredentials {
  readonly username: string;
  readonly password: string;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function constantTimeEquals(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export type WebhookAuthResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'missing_header' | 'malformed_header' | 'bad_credentials';
    };

/**
 * Verifies an `Authorization: Basic …` header.
 *
 * Both halves are always compared, even when the username is already wrong, so
 * the running time does not depend on which half failed.
 */
export function authenticateWebhook(
  authorizationHeader: string | undefined | null,
  credentials: WebhookCredentials,
): WebhookAuthResult {
  if (!authorizationHeader) return { ok: false, reason: 'missing_header' };

  const match = /^Basic\s+(?<encoded>[A-Za-z0-9+/=]+)$/.exec(authorizationHeader.trim());
  const encoded = match?.groups?.['encoded'];
  if (!encoded) return { ok: false, reason: 'malformed_header' };

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return { ok: false, reason: 'malformed_header' };
  }

  const separator = decoded.indexOf(':');
  if (separator < 0) return { ok: false, reason: 'malformed_header' };

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  const usernameMatches = constantTimeEquals(username, credentials.username);
  const passwordMatches = constantTimeEquals(password, credentials.password);

  return usernameMatches && passwordMatches
    ? { ok: true }
    : { ok: false, reason: 'bad_credentials' };
}

/** Builds the header Postmark should be configured with. Used in tests and admin. */
export function basicAuthHeader(credentials: WebhookCredentials): string {
  const encoded = Buffer.from(`${credentials.username}:${credentials.password}`, 'utf8').toString(
    'base64',
  );
  return `Basic ${encoded}`;
}
