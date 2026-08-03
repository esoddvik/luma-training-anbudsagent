import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@luma/db/schema';

/**
 * The web app's handle on PostgreSQL.
 *
 * Spec section 36 deploys the web app to Vercel and the API to Railway; the
 * pages read PostgreSQL directly rather than going through the Fastify API,
 * because a server component that fetches its own API adds a network hop and a
 * second copy of the authorisation rules for no gain.
 *
 * **Why this builds its own pool instead of calling `getDb()` from `@luma/db`.**
 * Two reasons, and the second one is a hard blocker:
 *
 * 1. `getDb()` falls back to `getCoreEnv()`, which validates the *core*
 *    service's entire environment — Doffin key, Postmark tokens, billing
 *    address — none of which the web app has, so the first query would fail
 *    with a list of unrelated missing variables.
 * 2. The `@luma/db` package root re-exports the migration runner, which
 *    resolves its SQL folder with `new URL('../drizzle', import.meta.url)`. A
 *    bundler reads that as an import of a module named `../drizzle` and fails
 *    the build. Importing `@luma/db/schema` — the schema and nothing else —
 *    keeps the migration runner out of the web bundle entirely.
 *
 * The schema itself still comes from `@luma/db`, so there is exactly one
 * definition of every table in the workspace.
 *
 * Nothing under `src/server/` may be imported from a client component. There is
 * no `server-only` guard because that package is not a dependency here; the
 * boundary holds because no file in this app carries a `'use client'`
 * directive.
 */

export type Database = PostgresJsDatabase<typeof schema>;

let cached: Database | undefined;

export function getWebDb(): Database {
  if (cached) return cached;

  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString || connectionString.length === 0) {
    throw new Error('DATABASE_URL mangler. Nettjenesten kan ikke lese data uten databasen.');
  }

  const client = postgres(connectionString, {
    // Small on purpose. Three services share one PostgreSQL instance and the
    // web app runs on serverless functions, where every instance opens its own
    // pool; a generous per-process pool multiplied by replicas is how
    // `max_connections` runs out.
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    // `postgres` prints notices to stdout by default, which bypasses the
    // logger and therefore bypasses redaction (spec section 40).
    onnotice: () => {},
    // Prepared statements are per-connection, and a transaction pooler would
    // hand the second half of a prepared exchange to a different backend.
    prepare: false,
  });

  cached = drizzle(client, { schema });
  return cached;
}

/**
 * The pepper for session token hashing (`AUTH_SECRET`, spec section 48).
 *
 * Read at call time, not at module load: a missing value must surface as a
 * failed request with a clear message rather than as a build-time crash in a
 * preview deployment that never serves an authenticated page.
 */
export function authPepper(): string {
  const secret = process.env['AUTH_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET mangler eller er for kort. Innlogging kan ikke valideres.');
  }
  return secret;
}

/** Default lifetime of a share link in days (spec section 17). */
export function shareTtlDays(): number {
  const raw = process.env['SHARE_DEFAULT_TTL_DAYS'];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

/**
 * The version identifier of the marketing consent wording currently shown.
 * Spec section 21 requires every consent event to name the exact text version.
 */
export function marketingConsentTextVersion(): string {
  const version = process.env['CURRENT_MARKETING_CONSENT_TEXT_VERSION'];
  return version && version.length > 0 ? version : '1.0';
}

/** Configured privacy policy version, stamped on consent events (spec 21). */
export function privacyPolicyVersion(): string | undefined {
  const version = process.env['CURRENT_PRIVACY_POLICY_VERSION'];
  return version && version.length > 0 ? version : undefined;
}
