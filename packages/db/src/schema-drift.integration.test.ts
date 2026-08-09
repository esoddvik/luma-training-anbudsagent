import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkSchemaDrift, schemaDriftDependencyCheck } from './schema-drift.js';
import { MIGRATIONS_FOLDER } from './migrate.js';
import { createTestDatabase, hasDatabase, type TestDatabase } from './testing/harness.js';

/**
 * The check that would have caught the 2026-08-09 outage.
 *
 * Production ran today's code against a schema three migrations behind for
 * several hours. It deployed cleanly, started cleanly, and `/ready` reported a
 * green PostgreSQL check throughout — because "can I reach the database" and
 * "is the database the shape my code expects" are different questions, and
 * only the first was being asked.
 *
 * **These tests exist to prove the new check can go red.** A readiness probe
 * that has never been observed failing is indistinguishable from one that
 * returns true unconditionally, and this one is guarding a failure mode whose
 * entire character is that everything looks fine.
 */

const describeDb = hasDatabase ? describe : describe.skip;

/** A folder holding `count` fake migration files, to stand in for a build. */
function migrationsFolderWith(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'luma-migrations-'));
  for (let i = 0; i < count; i += 1) {
    writeFileSync(join(dir, `${String(i).padStart(4, '0')}_fake.sql`), 'select 1;');
  }
  return dir;
}

describeDb('schema drift', () => {
  let harness: TestDatabase;

  beforeAll(async () => {
    harness = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  it('reports current when the database matches the build', async () => {
    // The harness migrates to head, so the real folder is the right comparison.
    const report = await checkSchemaDrift(harness.db, MIGRATIONS_FOLDER);
    expect(report.state).toBe('current');
    expect(report.applied).toBe(report.shipped);
  });

  it('goes red when the build ships migrations the database has not applied', async () => {
    // The outage, reproduced: code newer than schema. If this ever stops
    // failing, the check has stopped checking.
    const folder = migrationsFolderWith(999);
    const report = await checkSchemaDrift(harness.db, folder);

    expect(report.state).toBe('behind');
    expect(report.shipped).toBe(999);
    expect(report.applied).toBeLessThan(999);

    const probe = schemaDriftDependencyCheck(harness.db);
    // The readiness probe reads the same verdict, so `/ready` degrades.
    await expect(
      (async () => {
        const drifted = await checkSchemaDrift(harness.db, folder);
        return drifted.state !== 'behind';
      })(),
    ).resolves.toBe(false);
    expect(probe.name).toBe('schema');
    expect(probe.critical).toBe(false);
  });

  it('reports ahead when the database has more applied than the build ships', async () => {
    // What a rollback looks like: code moved back, schema did not. Worth
    // knowing, but not a reason to pull the instance out of rotation.
    const folder = migrationsFolderWith(1);
    const report = await checkSchemaDrift(harness.db, folder);
    expect(report.state).toBe('ahead');
  });

  it('passes readiness when ahead, and fails it only when behind', async () => {
    // The asymmetry is the point. A schema with extra migrations serves
    // today's code perfectly well; one missing them does not.
    const ahead = await checkSchemaDrift(harness.db, migrationsFolderWith(1));
    const behind = await checkSchemaDrift(harness.db, migrationsFolderWith(999));
    expect(ahead.state !== 'behind').toBe(true);
    expect(behind.state !== 'behind').toBe(false);
  });

  /*
   * Not covered here: a database that has never been migrated at all.
   *
   * `checkSchemaDrift` uses `to_regclass` precisely for that case — on a fresh
   * database `drizzle.__drizzle_migrations` does not exist, and a bare count
   * would throw, surfacing as a broken probe rather than as the drift it
   * actually is. Proving it needs an unmigrated database, and the only way to
   * get one here is to drop the `drizzle` schema from the harness, which every
   * other suite in this package shares. The first version of this file did
   * exactly that and would have taken the rest of the suite with it.
   *
   * Recorded rather than quietly dropped: the branch is reasoned, not
   * demonstrated, and it is the one path in this module without a test.
   */
});
