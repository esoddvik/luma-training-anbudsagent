import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * How a machine authenticates to this app.
 *
 * Two routes accept calls with no session — `/revalider`, which the ingest
 * worker calls when notices change, and `/synk-tjenestemaler`, which
 * reconciles the template table with the seeds. Both sign the request body with
 * `CRON_SECRET` and send the digest in `x-luma-signature`.
 *
 * ## Why a signature rather than a bearer token
 *
 * A shared secret in a query string ends up in access logs, in browser history
 * the moment anyone pastes it, and in every proxy between the caller and the
 * app. Signing the body keeps the secret out of the URL entirely, and ties the
 * request to its payload: a captured call cannot be edited and re-sent.
 *
 * It does **not** prevent replay of the identical request. Neither caller needs
 * that — revalidation is idempotent, and so is a template sync, which finds no
 * drift the second time and writes nothing. A route where replay mattered would
 * need a nonce or a timestamp, and would have to say so.
 *
 * ## Why it lives here rather than in the routes
 *
 * It was written twice, identically, and the second copy is how the first one
 * drifts. It also could not be tested where it was: the web vitest project
 * collects `src/**` only, so a comparison that must be constant-time had no
 * coverage at all while it sat in `app/`.
 */
export const MACHINE_SIGNATURE_HEADER = 'x-luma-signature';

/**
 * Constant-time check of an HMAC-SHA256 digest over `raw`.
 *
 * Returns false for a missing or malformed signature rather than throwing.
 * `timingSafeEqual` throws when the two buffers differ in length, and a thrown
 * 500 is itself an oracle — it tells an attacker their guess was the wrong
 * *shape*, which a 401 would not. Hence the length check first.
 */
export function machineSignatureMatches(
  raw: string,
  provided: string | null | undefined,
  secret: string,
): boolean {
  if (!provided) return false;
  const expected = createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The digest a caller sends. Exported so tests and tooling sign the same way. */
export function signMachineRequest(raw: string, secret: string): string {
  return createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
}
