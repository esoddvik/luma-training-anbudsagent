import { readdirSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import type { DependencyCheck } from '@luma/observability';
import type { Database } from './client.js';
import { MIGRATIONS_FOLDER } from './migrate.js';

/**
 * Catching a deploy whose code is newer than its schema.
 *
 * ## Why this exists
 *
 * On 2026-08-09 production ran for several hours with today's code against
 * yesterday's schema. Three migrations had never been applied: the service
 * deployed, started cleanly, answered `/health` and `/ready` with a green
 * PostgreSQL check, and served traffic. The only visible symptom was that
 * signing up threw, because `pending_signups` did not exist — and nobody
 * would have found that except by trying to sign up.
 *
 * The cause was a `preDeployCommand: pnpm db:migrate` that Railway never ran,
 * declared in a config file Railway was not reading. That specific hole is
 * closed, but the *class* of hole is not: any deploy path that skips
 * migrations — a misconfigured platform, a failed pre-deploy step someone
 * marked non-blocking, a rollback that moves code without moving schema —
 * produces exactly the same silent state.
 *
 * So this does not try to prevent the skip. It makes the skip **loud**, which
 * is the property that was missing. A database check that only proves
 * PostgreSQL answers is a check that passes through the whole outage.
 *
 * ## Why it compares counts rather than hashes
 *
 * Drizzle records a hash per applied migration; the folder holds the `.sql`
 * files the build shipped. Comparing counts answers "is the database behind
 * the code", which is the question. Comparing hashes would also answer "did
 * someone edit an applied migration", which is a different and rarer problem,
 * and would make a legitimate re-generation of an old file read as corruption.
 *
 * ## Why `degraded` and not `critical`
 *
 * A pending migration means some features are broken, not that the instance is
 * useless — the tender pipeline, the digests and every existing surface keep
 * working. Marking it critical would pull the instance out of rotation and
 * turn a partial outage into a total one, which is worse for the users who are
 * unaffected. It shows in `/ready` as degraded, which is what a human or an
 * alert reads, and `readinessHttpStatus` keeps returning 200.
 *
 * The opposite failure — being *ahead* — is reported too. A database with more
 * applied migrations than the build ships is a rollback that left the schema
 * where it was, and that is worth knowing before someone concludes the deploy
 * was clean.
 */

export interface SchemaDriftReport {
  readonly shipped: number;
  readonly applied: number;
  /** `behind` is the dangerous one: code expects tables that are absent. */
  readonly state: 'current' | 'behind' | 'ahead';
}

function shippedMigrationCount(folder: string): number {
  return readdirSync(folder).filter((file) => file.endsWith('.sql')).length;
}

export async function checkSchemaDrift(
  db: Database,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<SchemaDriftReport> {
  const shipped = shippedMigrationCount(migrationsFolder);

  // `to_regclass` rather than a bare count: on a database that has never been
  // migrated the table does not exist, and a thrown error here would report as
  // a probe failure rather than as the drift it actually is.
  const rows = await db.execute<{ applied: number }>(
    sql`select case
          when to_regclass('drizzle.__drizzle_migrations') is null then 0
          else (select count(*)::int from drizzle.__drizzle_migrations)
        end as applied`,
  );
  const applied = Number((rows as unknown as { applied: number }[])[0]?.applied ?? 0);

  const state = applied === shipped ? 'current' : applied < shipped ? 'behind' : 'ahead';
  return { shipped, applied, state };
}

/**
 * The readiness check to hand to `runReadinessChecks()`.
 *
 * Returns false when the schema is behind, which surfaces as `degraded`. Being
 * *ahead* passes: it is worth logging, but a schema with extra migrations
 * serves today's code perfectly well.
 */
export function schemaDriftDependencyCheck(db: Database): DependencyCheck {
  return {
    name: 'schema',
    probe: async () => {
      const report = await checkSchemaDrift(db);
      return report.state !== 'behind';
    },
    critical: false,
  };
}
