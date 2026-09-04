import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import { currentLegalDocumentSeed } from '@luma/content';
import { applyLegalDocumentDrift, loadLegalDocumentDrift } from './legal-documents';

const describeDb = hasDatabase ? describe : describe.skip;

/**
 * Publishing terms versions against a real database (spec section 19, ADR-11).
 *
 * The property under test is not "the sync writes rows" but **what it refuses
 * to write**. A published version's body is the text somebody agreed to; an
 * acceptance names it by `(kind, version)`. So a sync that helpfully corrected
 * a drifted body would silently rewrite the evidence of a legal agreement,
 * which is the failure this module is shaped to prevent.
 */
describeDb('legal document sync', () => {
  let harness: TestDatabase;

  beforeAll(async () => {
    harness = await createTestDatabase();
  });

  afterAll(async () => {
    await harness.destroy();
  });

  /**
   * Also the assertion that migration 0008 and `@luma/content` agree.
   *
   * It lives here rather than in `packages/db` because that package does not
   * depend on `@luma/content`, and adding the edge to compare one string would
   * buy a package boundary for a test's convenience. Two hand-maintained
   * copies of a version string is the two-sources-of-truth problem this work
   * exists to remove, reappearing between a migration and a content module.
   */
  it('finds nothing to publish, because the migration already seeded it', async () => {
    const report = await loadLegalDocumentDrift(harness.db);
    expect(report.insertable).toEqual([]);
    expect(report.conflicts).toEqual([]);
    expect(report.unseeded).toEqual([]);

    const [row] = await harness.db
      .select({
        version: schema.legalDocumentVersions.version,
        body: schema.legalDocumentVersions.body,
      })
      .from(schema.legalDocumentVersions)
      .where(eq(schema.legalDocumentVersions.kind, 'terms'));

    const seed = currentLegalDocumentSeed('terms');
    expect(row!.version).toBe(seed!.version);
    expect(row!.body).toBe(seed!.body);
  });

  it('publishes a version the table does not have yet, and keeps the old one', async () => {
    const nextVersion = {
      kind: 'terms' as const,
      version: '2026-06-test',
      body: 'Nye vilkår for tjenesten.',
      isPlaceholder: false,
      effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
    };

    const report = await applyLegalDocumentDrift(harness.db, [nextVersion]);
    expect(report.insertable.map((entry) => entry.version)).toEqual(['2026-06-test']);

    const rows = await harness.db
      .select()
      .from(schema.legalDocumentVersions)
      .where(eq(schema.legalDocumentVersions.kind, 'terms'));

    const published = rows.find((row) => row.version === '2026-06-test');
    expect(published).toBeDefined();
    expect(published!.body).toBe(nextVersion.body);
    expect(published!.isPlaceholder).toBe(false);

    // Publishing adds; it never replaces. The version people already accepted
    // is still there, and their acceptances still resolve.
    expect(rows.map((row) => row.version)).toContain('2026-01-utkast');
  });

  it('publishes the same version twice without creating a second row', async () => {
    const nextVersion = {
      kind: 'terms' as const,
      version: '2026-06-test',
      body: 'Nye vilkår for tjenesten.',
      isPlaceholder: false,
      effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
    };

    const second = await applyLegalDocumentDrift(harness.db, [nextVersion]);
    expect(second.insertable).toEqual([]);

    const rows = await harness.db
      .select()
      .from(schema.legalDocumentVersions)
      .where(eq(schema.legalDocumentVersions.version, '2026-06-test'));
    expect(rows).toHaveLength(1);
  });

  it('refuses to rewrite a published body that was edited in place', async () => {
    const tampered = 'Noen har endret denne teksten direkte i databasen.';
    await harness.db
      .update(schema.legalDocumentVersions)
      .set({ body: tampered })
      .where(eq(schema.legalDocumentVersions.version, '2026-01-utkast'));

    const report = await applyLegalDocumentDrift(harness.db);
    expect(report.conflicts).toEqual([{ kind: 'terms', version: '2026-01-utkast' }]);
    expect(report.insertable).toEqual([]);

    const [row] = await harness.db
      .select({ body: schema.legalDocumentVersions.body })
      .from(schema.legalDocumentVersions)
      .where(eq(schema.legalDocumentVersions.version, '2026-01-utkast'));

    // Unchanged. The sync reported the problem and wrote nothing.
    expect(row!.body).toBe(tampered);
  });

  it('never deletes a version the content module no longer carries', async () => {
    const before = await harness.db.select().from(schema.legalDocumentVersions);
    await applyLegalDocumentDrift(harness.db);
    const after = await harness.db.select().from(schema.legalDocumentVersions);

    expect(after).toHaveLength(before.length);
    expect(after.map((row) => row.version).sort()).toEqual(before.map((row) => row.version).sort());
  });
});
