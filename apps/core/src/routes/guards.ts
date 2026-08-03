import type { FastifyRequest } from 'fastify';
import { AuthenticationError } from '@luma/auth';
import { ApiError } from './errors.js';
import type { Actor } from '../services/context.js';

/**
 * Request-level guards: who is calling, and is this a cross-site write.
 *
 * ## The CSRF decision
 *
 * The session cookie is `SameSite=Lax` (ADR-0016), which already blocks the
 * cross-site form POST that classic CSRF depends on. `Lax` cannot be `Strict`,
 * because the magic link arrives from an email client and the first request
 * after clicking it is cross-site — `Strict` would drop the cookie and bounce
 * the user straight back to the login form.
 *
 * `Lax` alone is not the whole answer, though. It is a browser behaviour, not
 * a server check: an older browser, a `<link rel=prerender>`, or a future
 * top-level navigation that a browser decides to treat as safe all fall
 * outside it, and the server would have no idea. So state-changing requests
 * additionally have to prove they came from our own front end.
 *
 * On authority, precisely: §39 requires "CSRF-beskyttelse" and stops there. It
 * names no mechanism and offers no menu — an earlier version of this comment
 * said it "offers two options", which it does not. The two below are an
 * engineering choice made here, and requiring both rather than either is part
 * of that choice, not compliance with a spec sentence:
 *
 * 1. **A custom header, `x-luma-csrf`.** A cross-origin request cannot set a
 *    non-safelisted header without first passing a CORS preflight, and the
 *    CORS configuration in `server.ts` allows only the web app's origin. An
 *    HTML form — the classic CSRF vehicle — cannot set headers at all.
 * 2. **An `Origin` check when the header is present.** Browsers send `Origin`
 *    on every state-changing request. A mismatch is refused outright rather
 *    than merely unpreflighted.
 *
 * Requiring both rather than either is deliberate: the header alone would be
 * defeated by a permissive CORS change made elsewhere, and the origin check
 * alone does nothing against a client that omits `Origin`.
 *
 * Read requests are exempt. So is anything under an exempt prefix — the
 * Postmark webhook authenticates with its own credentials and is not a
 * browser (spec §27), so a header requirement there would be nonsense rather
 * than security.
 */

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const CSRF_HEADER = 'x-luma-csrf';

/** Paths that authenticate by other means and must not be held to the header. */
export const CSRF_EXEMPT_PREFIXES: readonly string[] = ['/api/v1/postmark/webhooks'];

export function checkCsrf(request: FastifyRequest, allowedOrigins: readonly string[]): void {
  if (!STATE_CHANGING.has(request.method)) return;

  const path = request.url.split('?')[0] ?? request.url;
  if (CSRF_EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) return;

  const origin = request.headers.origin;
  if (typeof origin === 'string' && origin.length > 0 && !allowedOrigins.includes(origin)) {
    throw new ApiError(
      'csrf_origin_rejected',
      403,
      'Forespørselen kom fra et ukjent nettsted og ble avvist.',
    );
  }

  const header = request.headers[CSRF_HEADER];
  if (typeof header !== 'string' || header.length === 0) {
    throw new ApiError(
      'csrf_header_missing',
      403,
      `Forespørselen mangler ${CSRF_HEADER}-hodet og ble avvist.`,
    );
  }
}

/** The actor, or a 401. Used by every route that needs a signed-in user. */
export function actorOf(request: FastifyRequest): Actor {
  if (!request.actor) throw new AuthenticationError();
  return request.actor;
}

/** The client address, already trusted through Fastify's proxy handling. */
export function clientIp(request: FastifyRequest): string | undefined {
  return request.ip;
}

export function userAgentOf(request: FastifyRequest): string | undefined {
  const value = request.headers['user-agent'];
  return typeof value === 'string' ? value.slice(0, 500) : undefined;
}
