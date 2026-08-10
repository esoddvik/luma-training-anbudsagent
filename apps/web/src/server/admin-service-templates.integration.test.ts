import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { SERVICE_TEMPLATE_SEEDS, type ServiceTemplateSeed } from '@luma/content';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import {
  applyServiceTemplateDrift,
  loadServiceTemplateDrift,
  SEED_OWNED_FIELDS,
} from './admin-service-templates';

/**
 * The sync writes what the seeds own, and nothing else.
 *
 * The bug this guards is the one that made the sync necessary in the first
 * place: `listServiceTemplateChoices` prefers the table over the seeds, so a
 * row that has fallen behind git is invisible — every page renders, every test
 * passes, and production serves a CPV list that was deleted weeks ago. The
 * only thing standing between that and an operator is this comparison.
 *
 * The fourth test is the one that matters most. `active`, `deletedAt`, `id`
 * and `createdAt` are the row's own: `active` is how a template is retired,
 * `deletedAt` is a soft delete profiles still point at, and `id` is the target
 * of `alert_profiles.service_template_id`. A sync that reset any of them would
 * do it silently and look like a successful reconciliation.
 */

const describeDb = hasDatabase ? describe : describe.skip;

function rowFromSeed(seed: ServiceTemplateSeed) {
  return {
    slug: seed.slug,
    name: seed.name,
    description: seed.description,
    sortOrder: seed.sortOrder,
    serviceCategory: seed.serviceCategory,
    supplierForm: seed.supplierForm,
    onboardingHint: seed.onboardingHint,
    cpvInclude: [...seed.cpvInclude],
    cpvExclude: [...seed.cpvExclude],
    keywordsInclude: [...seed.keywordsInclude],
    keywordsExclude: [...seed.keywordsExclude],
  };
}

describeDb('service template sync', () => {
  let harness: TestDatabase;
  let db: TestDatabase['db'];
  const first = SERVICE_TEMPLATE_SEEDS[0]!;

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db;
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table ${schema.serviceTemplates} restart identity cascade`);
  });

  /** Seeds every template verbatim, so the table starts with zero drift. */
  async function seedTableExactly(): Promise<void> {
    await db.insert(schema.serviceTemplates).values(SERVICE_TEMPLATE_SEEDS.map(rowFromSeed));
  }

  it('reports nothing when every row already matches its seed', async () => {
    await seedTableExactly();

    const report = await loadServiceTemplateDrift(db);

    expect(report.drifted).toEqual([]);
    expect(report.missingSlugs).toEqual([]);
    expect(report.unseededSlugs).toEqual([]);
    expect(report.rowCount).toBe(SERVICE_TEMPLATE_SEEDS.length);
  });

  it('reports the field, the current value and the new one', async () => {
    await seedTableExactly();
    // Two fields on one template, one of them an array — the shape the real
    // incident had: `98300000` was removed from a seed's `cpvInclude` and the
    // row kept serving it.
    await db
      .update(schema.serviceTemplates)
      .set({ name: 'Gammelt navn', cpvInclude: [...first.cpvInclude, '98300000'] })
      .where(eq(schema.serviceTemplates.slug, first.slug));

    const report = await loadServiceTemplateDrift(db);

    expect(report.drifted).toHaveLength(1);
    const drift = report.drifted[0]!;
    expect(drift.slug).toBe(first.slug);
    expect(drift.name).toBe(first.name);
    expect(drift.fields.map((field) => field.field).sort()).toEqual(['cpvInclude', 'name']);

    const nameDrift = drift.fields.find((field) => field.field === 'name')!;
    expect(nameDrift.before).toBe('Gammelt navn');
    expect(nameDrift.after).toBe(first.name);

    // The operator has to be able to see the code that disappears, not just
    // that "the list changed".
    const cpvDrift = drift.fields.find((field) => field.field === 'cpvInclude')!;
    expect(cpvDrift.before).toContain('98300000');
    expect(cpvDrift.after).not.toContain('98300000');
  });

  it('applies the drift, and reports nothing on a second run', async () => {
    await seedTableExactly();
    await db
      .update(schema.serviceTemplates)
      .set({ name: 'Gammelt navn', keywordsExclude: ['noe-en-redaktør-aldri-skrev'] })
      .where(eq(schema.serviceTemplates.slug, first.slug));

    const applied = await applyServiceTemplateDrift(db);
    expect(applied.drifted).toHaveLength(1);

    const [row] = await db
      .select()
      .from(schema.serviceTemplates)
      .where(eq(schema.serviceTemplates.slug, first.slug));
    expect(row!.name).toBe(first.name);
    expect(row!.keywordsExclude).toEqual([...first.keywordsExclude]);

    // Idempotence, checked through both entry points: a second apply must be a
    // no-op, and the page must show nothing left to do.
    const second = await applyServiceTemplateDrift(db);
    expect(second.drifted).toEqual([]);
    expect((await loadServiceTemplateDrift(db)).drifted).toEqual([]);
  });

  it('never writes a field outside the owned list', async () => {
    await seedTableExactly();

    const retired = new Date('2026-01-02T03:04:05.000Z');
    await db
      .update(schema.serviceTemplates)
      .set({ name: 'Gammelt navn', active: false, deletedAt: retired })
      .where(eq(schema.serviceTemplates.slug, first.slug));

    const [before] = await db
      .select()
      .from(schema.serviceTemplates)
      .where(eq(schema.serviceTemplates.slug, first.slug));

    await applyServiceTemplateDrift(db);

    const [after] = await db
      .select()
      .from(schema.serviceTemplates)
      .where(eq(schema.serviceTemplates.slug, first.slug));

    // The owned field was written…
    expect(after!.name).toBe(first.name);
    // …and none of the row's own columns were.
    expect(after!.active).toBe(false);
    expect(after!.deletedAt?.getTime()).toBe(retired.getTime());
    expect(after!.id).toBe(before!.id);
    expect(after!.createdAt.getTime()).toBe(before!.createdAt.getTime());

    // A soft-deleted, retired row still drifts and is still reported. Skipping
    // it would mean git and the table disagree about a template that can be
    // reactivated with one click.
    expect(SEED_OWNED_FIELDS).not.toContain('active');
    expect(SEED_OWNED_FIELDS).not.toContain('deletedAt');
    expect(SEED_OWNED_FIELDS).not.toContain('id');
    expect(SEED_OWNED_FIELDS).not.toContain('createdAt');
  });

  it('neither inserts a missing template nor deletes an unknown one', async () => {
    // One seed present, one row that no seed knows about.
    await db
      .insert(schema.serviceTemplates)
      .values([
        rowFromSeed(first),
        { ...rowFromSeed(first), slug: 'lagt-inn-i-admin', name: 'Lagt inn i admin' },
      ]);

    const report = await applyServiceTemplateDrift(db);

    expect(report.missingSlugs).toEqual(SERVICE_TEMPLATE_SEEDS.slice(1).map((seed) => seed.slug));
    expect(report.unseededSlugs).toEqual(['lagt-inn-i-admin']);

    // Two rows before, two rows after: the missing seeds were not created and
    // the extra row was not removed.
    expect(await db.$count(schema.serviceTemplates)).toBe(2);
    const [extra] = await db
      .select()
      .from(schema.serviceTemplates)
      .where(eq(schema.serviceTemplates.slug, 'lagt-inn-i-admin'));
    expect(extra!.name).toBe('Lagt inn i admin');
  });
});
