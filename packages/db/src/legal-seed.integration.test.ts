import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from './schema/index.js';
import { createTestDatabase, hasDatabase, type TestDatabase } from './testing/harness.js';

const describeDb = hasDatabase ? describe : describe.skip;

/**
 * The migration seeds a terms version (spec section 19, section 51 blocker 2).
 *
 * `legal_document_versions` was created in `0000` and populated by nothing —
 * no seed, no migration, no admin surface, no script. `confirmSignup` returns
 * `no_terms` when the table is empty, so **registration was impossible on
 * every clean deploy** and only tests that insert their own row ever saw it
 * work. This suite is the standing proof that a fresh database can accept a
 * signup.
 *
 * The assertion that the seeded row matches `@luma/content` lives in
 * `apps/web`, not here: this package does not depend on `@luma/content`, and
 * adding that edge to compare one string would buy a package boundary for a
 * test's convenience.
 */
describeDb('placeholder terms seed', () => {
  let harness: TestDatabase;

  beforeAll(async () => {
    harness = await createTestDatabase();
  });

  afterAll(async () => {
    await harness.destroy();
  });

  it('leaves exactly one terms version in force on a fresh database', async () => {
    const rows = await harness.db
      .select()
      .from(schema.legalDocumentVersions)
      .where(eq(schema.legalDocumentVersions.kind, 'terms'));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.version).toBe('2026-01-utkast');
  });

  // Section 51 item 8 blocks launch while a document in force is a
  // placeholder. Seeding it as anything else would quietly unblock a launch
  // gate by way of a migration.
  it('marks the seeded version as a placeholder', async () => {
    const [row] = await harness.db
      .select({ isPlaceholder: schema.legalDocumentVersions.isPlaceholder })
      .from(schema.legalDocumentVersions)
      .where(eq(schema.legalDocumentVersions.kind, 'terms'));

    expect(row!.isPlaceholder).toBe(true);
  });

  it('hangs the version off a parent document row', async () => {
    const [version] = await harness.db
      .select({ legalDocumentId: schema.legalDocumentVersions.legalDocumentId })
      .from(schema.legalDocumentVersions)
      .where(eq(schema.legalDocumentVersions.kind, 'terms'));

    const parents = await harness.db
      .select({ id: schema.legalDocuments.id, title: schema.legalDocuments.title })
      .from(schema.legalDocuments)
      .where(eq(schema.legalDocuments.id, version!.legalDocumentId));

    expect(parents).toHaveLength(1);
    // Spec section 6: no English reaches a customer-facing document title.
    expect(parents[0]!.title).toBe('Vilkår for bruk');
  });
});
