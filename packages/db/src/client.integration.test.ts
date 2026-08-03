import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runReadinessChecks } from '@luma/observability';
import { checkDatabaseHealth, createDatabase, databaseDependencyCheck } from './client.js';
import { createTestDatabase, hasDatabase, type TestDatabase } from './testing/harness.js';

describe.skipIf(!hasDatabase)('client', () => {
  let harness: TestDatabase;

  beforeAll(async () => {
    harness = await createTestDatabase();
  });

  afterAll(async () => {
    await harness?.destroy();
  });

  it('reports healthy against a live database', async () => {
    expect(await checkDatabaseHealth(harness.db)).toBe(true);
  });

  it('reports unhealthy rather than throwing when the database is unreachable', async () => {
    // Readiness must never reject: `runReadinessChecks` would report it as an
    // error with a stack trace nobody needs for "the database is down".
    const unreachable = createDatabase({
      connectionString: 'postgres://nobody:nobody@127.0.0.1:1/nothing',
      connectTimeoutSeconds: 1,
      max: 1,
    });
    try {
      await expect(checkDatabaseHealth(unreachable.db)).resolves.toBe(false);
    } finally {
      await unreachable.close().catch(() => {});
    }
  });

  it('plugs into the observability readiness report', async () => {
    const report = await runReadinessChecks('core', [databaseDependencyCheck(harness.db)]);
    expect(report.status).toBe('ok');
    expect(report.checks.map((check) => check.name)).toEqual(['postgres']);
  });

  it('closing an independent pool twice does not throw', async () => {
    // A SIGTERM handler and a `finally` block will both call close; spec
    // section 38 requires graceful shutdown, not a shutdown that needs a guard.
    const created = createDatabase({ connectionString: dbUrlFor(harness), max: 1 });
    await created.close();
    await expect(created.close()).resolves.toBeUndefined();
  });
});

function dbUrlFor(harness: TestDatabase): string {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.pathname = `/${harness.databaseName}`;
  return url.toString();
}
