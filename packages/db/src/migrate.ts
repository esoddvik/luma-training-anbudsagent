import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { loadDotEnv } from '@luma/config';
import { createDatabase } from './client.js';

/**
 * Applies pending migrations.
 *
 * Run as a script by `pnpm --filter @luma/db db:migrate`, and importable so a
 * test can migrate a throwaway database.
 *
 * The migration pool is separate from the application pool and is opened with
 * `max: 1`. Two connections replaying migrations concurrently is the classic
 * way to get half a schema, and drizzle's own lock only helps if everyone
 * competing for it is drizzle.
 */

/**
 * The generated SQL lives at the package root, one level above both `src/`
 * (when run with tsx) and `dist/` (when run from a build), so the same
 * relative URL resolves correctly either way.
 */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

export interface RunMigrationsOptions {
  connectionString?: string;
  migrationsFolder?: string;
}

/**
 * Resolves `DATABASE_URL` for a migration run, and *only* `DATABASE_URL`.
 *
 * Deliberately not `getCoreEnv()`, which validates the whole service
 * environment. A migration needs a connection string and nothing else, and
 * routing it through the full parser would make `db:migrate` fail with
 * "POSTMARK_SERVER_TOKEN: expected string, received undefined" — in a release
 * step whose job is to change the schema, in an environment that has no reason
 * to hold a Postmark token. The application client in `client.ts` does use
 * `getCoreEnv()`, because a running service needs the rest of it anyway.
 */
export function resolveMigrationDatabaseUrl(): string {
  loadDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Migrations need a connection string.');
  }
  if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must be a postgres:// or postgresql:// connection string.');
  }
  return url;
}

export async function runMigrations(options: RunMigrationsOptions = {}): Promise<void> {
  const { db, close } = createDatabase({
    connectionString: options.connectionString ?? resolveMigrationDatabaseUrl(),
    max: 1,
  });
  try {
    await migrate(db, { migrationsFolder: options.migrationsFolder ?? MIGRATIONS_FOLDER });
  } finally {
    await close();
  }
}

/**
 * True when this module is the process entry point.
 *
 * `pathToFileURL`, not string concatenation: on Windows `process.argv[1]` is
 * `G:\...`, and `new URL('file://G:/...')` parses the drive letter as a host.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isEntryPoint()) {
  runMigrations()
    .then(() => {
      // eslint-disable-next-line no-console -- a CLI must say what it did.
      console.log('Migrations applied.');
    })
    .catch((error: unknown) => {
      console.error('Migration failed:', error);
      process.exitCode = 1;
    });
}
