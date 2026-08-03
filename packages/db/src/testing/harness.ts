import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase, type Database } from '../client.js';
import { MIGRATIONS_FOLDER } from '../migrate.js';

/**
 * Integration-test plumbing.
 *
 * Every integration suite gets its **own PostgreSQL database**, created empty
 * and dropped afterwards. A database rather than a schema, for a reason worth
 * recording: drizzle-kit emits `CREATE TYPE "public"."notice_category"` — the
 * enums are schema-qualified to `public` while the column definitions that use
 * them are not. A per-schema harness therefore creates the types in `public`
 * on the first run and fails on the second with "type already exists", and the
 * tables in the isolated schema cannot see them anyway.
 *
 * Isolation also buys three things that matter here:
 *
 * - "migrations apply to an empty database" is literally what is tested, not
 *   "apply to whatever the last run left behind";
 * - a suite that inserts a user cannot break another suite's count assertion;
 * - a developer's local database is never truncated by running the tests.
 *
 * The name is random, so a crashed run leaves a `luma_test_*` database behind
 * rather than corrupting the next one. The README explains how to clear those.
 */

export const DATABASE_URL = process.env.DATABASE_URL;

/**
 * Whether this process is running in CI.
 *
 * `CI` is read as a flag, not as a string, because `CI=false` is a real thing
 * people export — it is the documented way to stop a Next.js or CRA build
 * treating warnings as errors, and this repository has a Next app. Plain
 * truthiness would read `'false'` as "we are in CI" and hard-fail a laptop run
 * that was correct to skip.
 *
 * **Exported so nothing parses `CI` twice.** That is not hypothetical
 * tidiness: `apps/core` grew its own `Boolean(process.env.CI)` copy an hour
 * apart from this one and reintroduced exactly the `CI=false` bug the parsing
 * above removes. Two files independently interpreting one environment variable
 * will drift. Import this instead of writing another.
 */
export const isCi = !['', '0', 'false'].includes((process.env.CI ?? '').toLowerCase());

/**
 * In CI, a missing database is a broken pipeline, not a reason to skip.
 *
 * Every integration suite in the repository skips itself when `DATABASE_URL`
 * is absent, which is right on a laptop and dangerous in CI: the run would go
 * green having verified nothing about cross-user isolation, the shared view,
 * the consent trigger, or idempotent re-ingest — the tests most worth having.
 * A gate that reports success while skipping its own subject is worse than no
 * gate, because it is trusted.
 *
 * This throws at import time rather than failing one assertion, and it lives
 * here rather than being copied into each suite, because every one of them
 * imports this module. A new integration test added tomorrow is covered
 * without its author having to remember anything.
 *
 * Because it throws during module evaluation, it **preempts collection**: a
 * suite that also asserts on this condition will never get as far as running
 * that assertion while this guard is intact. Such an assertion is still worth
 * keeping, but its purpose is to survive *this* guard being weakened or
 * removed — not to produce a prettier message alongside it.
 */
if (isCi && !DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set, but CI is. Integration tests would silently skip and the ' +
      'run would report success having verified nothing. Set DATABASE_URL on the test job ' +
      '(see the postgres service in .github/workflows/ci.yml), or unset CI to run locally.',
  );
}

/** Integration suites are skipped without a database. See the README. */
export const hasDatabase = Boolean(DATABASE_URL);

export interface TestDatabase {
  db: Database;
  databaseName: string;
  /** Drops the database and closes the pool. */
  destroy: () => Promise<void>;
}

/**
 * Creates an empty database, runs every migration into it, and returns a
 * client connected to it.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  if (!DATABASE_URL) {
    throw new Error('createTestDatabase() requires DATABASE_URL');
  }

  const databaseName = `luma_test_${randomUUID().replace(/-/g, '')}`;

  // CREATE DATABASE cannot run inside a transaction, and it has to run against
  // some other database, so this is a throwaway connection to the configured
  // one that is closed immediately.
  await withAdmin(async (db) => {
    await db.execute(sql.raw(`CREATE DATABASE "${databaseName}"`));
  });

  const created = createDatabase({
    connectionString: replaceDatabase(DATABASE_URL, databaseName),
    max: 2,
  });

  try {
    await migrate(created.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } catch (error) {
    await created.close();
    await dropDatabase(databaseName);
    throw error;
  }

  return {
    db: created.db,
    databaseName,
    destroy: async () => {
      await created.close();
      await dropDatabase(databaseName);
    },
  };
}

/** The schema the tables live in. Kept as a helper so tests read clearly. */
export const TEST_SCHEMA = 'public';

async function withAdmin(work: (db: Database) => Promise<void>): Promise<void> {
  if (!DATABASE_URL) return;
  const admin = createDatabase({ connectionString: DATABASE_URL, max: 1 });
  try {
    await work(admin.db);
  } finally {
    await admin.close();
  }
}

async function dropDatabase(databaseName: string): Promise<void> {
  await withAdmin(async (db) => {
    // FORCE terminates any connection the pool did not manage to close, so a
    // failed test cannot leave a database that nothing can drop.
    await db.execute(sql.raw(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`));
  });
}

function replaceDatabase(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/**
 * Asserts that a database operation is rejected *for the stated reason*.
 *
 * Drizzle wraps a driver failure in `Error: Failed query: <sql>` and hangs the
 * real `PostgresError` off `cause`, so `expect(...).rejects.toThrow(/x/)` only
 * ever sees the SQL text. It would pass for any failure at all — a typo in the
 * table name, a missing column, a connection drop — which makes it useless as
 * evidence that a *constraint* fired.
 *
 * This flattens the whole cause chain, including the driver's structured
 * fields (`constraint_name` lives there and not in the message), and matches
 * against that. It also fails when nothing is thrown, which is the case that
 * actually matters: a constraint quietly missing from a migration.
 */
export async function expectRejection(
  operation: PromiseLike<unknown>,
  pattern: RegExp,
): Promise<void> {
  let thrown: unknown;
  try {
    await operation;
  } catch (error) {
    thrown = error;
  }

  if (thrown === undefined) {
    throw new Error(
      `Expected the operation to be rejected by ${pattern}, but it succeeded. ` +
        'A constraint that does not fire is a constraint that is not there.',
    );
  }

  const text = flattenError(thrown);
  if (!pattern.test(text)) {
    throw new Error(`Expected rejection matching ${pattern}, got:\n${text}`);
  }
}

function flattenError(error: unknown, depth = 0): string {
  if (depth > 5 || error === null || error === undefined) return String(error);
  if (!(error instanceof Error)) return String(error);

  // `PostgresError` carries `constraint_name`, `code` and `detail` as own
  // enumerable properties rather than in the message.
  const own = Object.entries(error as unknown as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');

  const cause = 'cause' in error ? flattenError(error.cause, depth + 1) : '';
  return [error.message, own, cause].filter(Boolean).join('\n');
}
