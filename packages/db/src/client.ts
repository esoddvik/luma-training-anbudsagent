import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import type { DependencyCheck } from '@luma/observability';
import * as schema from './schema/index.js';

/**
 * The Drizzle client.
 *
 * One pool per process, created lazily. Lazily, because importing this module
 * for a type must not open a socket, and because a missing `DATABASE_URL`
 * throws — a validation failure at import time would surface as an unrelated
 * module-loading error somewhere far from the cause.
 */

export type Database = PostgresJsDatabase<typeof schema>;

export interface CreateDatabaseOptions {
  /** Overrides `DATABASE_URL`. Integration tests use it; nothing else should. */
  connectionString?: string;
  /**
   * Maximum pooled connections.
   *
   * The default is 10, and it is deliberately not larger. Three services share
   * one PostgreSQL instance and pg-boss opens its own connections in the same
   * database (ADR-8), so a generous per-process pool multiplied by replicas is
   * how a small application runs out of `max_connections` in production while
   * looking idle in every dashboard.
   */
  max?: number;
  /** Seconds an idle connection is kept before being closed. */
  idleTimeoutSeconds?: number;
  /** Seconds to wait for a connection before failing the query. */
  connectTimeoutSeconds?: number;
  /** Logs every statement. Never enable in production: parameters are values. */
  logger?: boolean;
}

interface Pooled {
  db: Database;
  sql: Sql;
}

let pooled: Pooled | undefined;

/**
 * The connection string, without demanding an environment this package does
 * not use.
 *
 * `getCoreEnv()` validates the *whole* core schema — Postmark tokens, the cron
 * secret, the billing address, the Doffin key. Calling it here meant any
 * service that opened a database connection had to carry all of it. `apps/mcp`
 * needs a database and none of those secrets, and it crashed on boot listing
 * `CRON_SECRET`, `POSTMARK_WEBHOOK_PASSWORD` and `API_URL` as missing.
 *
 * The tempting fix was to copy those variables onto the MCP service. That
 * would have put the Postmark tokens and the cron secret on a process with no
 * use for them, purely to satisfy a validation call — spreading credentials to
 * make a schema check pass, which is invisible the moment it is done.
 *
 * So this reads the one variable it actually needs. The error message is
 * deliberately specific: a bare "undefined connection string" from inside a
 * pool constructor is the kind of thing that gets debugged for an hour.
 */
function resolveConnectionString(explicit?: string): string {
  if (explicit) return explicit;

  const fromEnv = process.env['DATABASE_URL'];
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv;

  throw new Error(
    'DATABASE_URL mangler. @luma/db trenger bare denne variabelen — ' +
      'ikke hele miljøet til én bestemt tjeneste.',
  );
}

function createPool(options: CreateDatabaseOptions): Pooled {
  const connectionString = resolveConnectionString(options.connectionString);

  const client = postgres(connectionString, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeoutSeconds ?? 30,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    // `postgres` prints notices to stdout by default. ESLint bans bare console
    // in this repository for the same reason: output that bypasses the logger
    // also bypasses redaction (spec section 40).
    onnotice: () => {},
    // Prepared statements are per-connection, and a transaction pooler in
    // front of PostgreSQL would hand the second half of a prepared exchange to
    // a different backend. Disabling them costs a little planning time and
    // removes a failure mode that only appears once a pooler is introduced.
    prepare: false,
  });

  return { db: drizzle(client, { schema, logger: options.logger ?? false }), sql: client };
}

/**
 * The process-wide client. Repeated calls return the same pool; the options
 * are read only on the first call.
 */
export function getDb(options: CreateDatabaseOptions = {}): Database {
  pooled ??= createPool(options);
  return pooled.db;
}

/**
 * An independent client with its own pool.
 *
 * For tests and one-shot scripts that must not disturb, or be disturbed by,
 * the process-wide pool. The caller owns it and must close it.
 */
export function createDatabase(options: CreateDatabaseOptions = {}): {
  db: Database;
  close: () => Promise<void>;
} {
  const created = createPool(options);
  return {
    db: created.db,
    close: async () => {
      await created.sql.end({ timeout: 5 });
    },
  };
}

/**
 * Closes the process-wide pool.
 *
 * Spec section 38 requires jobs to shut down cleanly and close their database
 * connections; a worker that exits with sockets open leaves the server holding
 * backends until its own timeout, which is how a rolling deploy exhausts
 * `max_connections`. Safe to call when no pool was ever created, and safe to
 * call twice, so a `SIGTERM` handler needs no guard of its own.
 */
export async function closeDb(timeoutSeconds = 5): Promise<void> {
  const current = pooled;
  if (!current) return;
  pooled = undefined;
  await current.sql.end({ timeout: timeoutSeconds });
}

/**
 * Whether the database answers.
 *
 * Returns `false` rather than throwing, because it feeds
 * `@luma/observability`'s readiness probe, which treats a rejection and a
 * `false` the same way but reports the former with a stack trace nobody needs
 * for "the database is down".
 */
export async function checkDatabaseHealth(db: Database = getDb()): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * The readiness check to hand to `runReadinessChecks()`.
 *
 * Critical by default: none of the three services can serve a useful response
 * without PostgreSQL, so a failure should take the instance out of rotation
 * rather than merely degrade it.
 */
export function databaseDependencyCheck(db?: Database): DependencyCheck {
  return {
    name: 'postgres',
    probe: () => checkDatabaseHealth(db ?? getDb()),
    critical: true,
  };
}

export { schema };
