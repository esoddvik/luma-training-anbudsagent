import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { SERVICE_TEMPLATE_SEEDS } from '@luma/content';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import type {
  listServiceTemplateChoices as ListChoices,
  loadTemplateChoice as LoadChoice,
} from './profiles';

/**
 * The form and the action must agree about which trades exist.
 *
 * This is a regression test for a live production bug. `service_templates` was
 * empty in production, so:
 *
 * - the pages rendered their picker from `listServiceTemplateChoices`, which
 *   falls back to the editorial seeds, and offered eight trades;
 * - `requestSignupAction` resolved the posted slug against the *table*, found
 *   nothing, and rejected every submission as `ugyldig`.
 *
 * The signup flow rendered perfectly and could not be completed. Nothing was
 * broken in a way any existing test could see, because each half was correct
 * on its own — they simply read different sources.
 *
 * So the property under test is not "seeds work" or "the database works". It
 * is that **whatever the picker offers, the action accepts**, with the table
 * full or empty.
 */

const describeDb = hasDatabase ? describe : describe.skip;

describeDb('service template resolution', () => {
  let harness: TestDatabase;
  let db: TestDatabase['db'];
  let listServiceTemplateChoices: typeof ListChoices;
  let loadTemplateChoice: typeof LoadChoice;

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db;
    vi.doMock('./db', async () => {
      const actual = await vi.importActual<Record<string, unknown>>('./db');
      return { ...actual, getWebDb: () => db };
    });
    ({ listServiceTemplateChoices, loadTemplateChoice } = await import('./profiles'));
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table ${schema.serviceTemplates} restart identity cascade`);
  });

  it('offers the seeds when the table is empty, and accepts every one of them', async () => {
    // The production state exactly: nothing seeded.
    expect(await db.$count(schema.serviceTemplates)).toBe(0);

    const offered = await listServiceTemplateChoices();
    expect(offered.length).toBe(SERVICE_TEMPLATE_SEEDS.length);

    // Every trade the picker renders must resolve. One that does not is a
    // submit button that always fails.
    for (const choice of offered) {
      const resolved = await loadTemplateChoice(choice.slug);
      expect(resolved, `slug ${choice.slug} did not resolve`).not.toBeNull();
      expect(resolved!.cpvInclude.length).toBeGreaterThan(0);
    }
  });

  it('prefers the table once it is seeded, and still accepts everything it offers', async () => {
    const seed = SERVICE_TEMPLATE_SEEDS[0]!;
    await db.insert(schema.serviceTemplates).values({
      slug: seed.slug,
      name: 'Redigert i admin',
      description: seed.description,
      sortOrder: seed.sortOrder,
      serviceCategory: seed.serviceCategory,
      supplierForm: seed.supplierForm,
      cpvInclude: [...seed.cpvInclude],
      cpvExclude: [...seed.cpvExclude],
      keywordsInclude: [...seed.keywordsInclude],
      keywordsExclude: [...seed.keywordsExclude],
    });

    const offered = await listServiceTemplateChoices();
    // The table wins whole, not merged: editorial content is maintained in
    // admin without a deploy (spec section 11.2), and merging would resurrect
    // a template an editor had deliberately removed.
    expect(offered).toHaveLength(1);
    expect(offered[0]!.name).toBe('Redigert i admin');

    for (const choice of offered) {
      expect(await loadTemplateChoice(choice.slug)).not.toBeNull();
    }
  });

  it('rejects a slug that was never offered', async () => {
    // The other half of the contract: resolution is not a rubber stamp.
    expect(await loadTemplateChoice('ikke-en-tjenestemal')).toBeNull();
  });
});
