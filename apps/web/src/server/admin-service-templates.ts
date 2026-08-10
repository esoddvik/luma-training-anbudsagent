import { eq } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { SERVICE_TEMPLATE_SEEDS, type ServiceTemplateSeed } from '@luma/content';
import { getWebDb, type Database } from './db';

/**
 * Reconciling `service_templates` with the editorial seeds (spec section 11.2).
 *
 * ## Why this exists at all
 *
 * `listServiceTemplateChoices` in `profiles.ts` prefers the table and falls
 * back to `packages/content/src/service-templates.ts` only when the table is
 * empty. So editing a seed changes nothing anywhere the table is populated —
 * which is every deployed environment. The seeds are the reviewable source of
 * truth in git; the table is what actually runs, and nothing kept the two in
 * step. Removing `98300000 Diverse tjenester` from the renhold seed left
 * production serving the old CPV list from a row no diff shows.
 *
 * `apps/web/scripts/sync-service-templates.ts` does the same job from a
 * terminal and imports its comparison from here, so the two cannot drift. It
 * is not enough on its own: this project marks its production environment
 * variables sensitive, so `vercel env pull --environment=production` returns
 * `[SENSITIVE]` for `DATABASE_URL` and the script has no way to reach the
 * production database from a laptop. The reconciliation has to run *inside*
 * production, which is what the admin page is for.
 *
 * ## Why this does not follow the Doffin backfill through to `core`
 *
 * The backfill next door posts to `core` because ingest needs the Doffin
 * adapter and spec section 36 forbids running that in a request-bound Vercel
 * function. None of that applies here: this is a handful of `UPDATE`s on eight
 * rows in the web app's own database, comfortably inside a request, and
 * forwarding it to another service would buy a network hop and a second copy
 * of the rules. It stays in `apps/web` and talks to PostgreSQL directly, like
 * every other read and write on these pages.
 *
 * ## Safety
 *
 * Matched by slug. It updates exactly the fields the seeds own; it never
 * inserts, never deletes, and never touches `active`, `deletedAt`, `id` or the
 * timestamps other than `updatedAt`. A seed with no row is reported, never
 * created — the row's `id` is the target of `alert_profiles.service_template_id`
 * and inventing one would attach live profiles to a template nobody reviewed.
 * A row with no seed is reported and left alone, because a template an editor
 * added is not drift.
 *
 * **It has no way to tell an editorial change from drift.** Today that is safe:
 * `/admin/tjenestemaler` shows this and nothing else, and nothing in the app
 * writes to the table. The moment admin editing ships, applying will discard
 * whatever an editor changed, and this file needs a real answer before then.
 * The page says so, in Norwegian, above the button.
 */

/**
 * The columns the seeds are authoritative for. Everything else belongs to the
 * row and is never written by a sync.
 *
 * This list is the whole safety boundary, so it is a `const` tuple rather than
 * a loop over `Object.keys(seed)`: adding a seed field must be a deliberate
 * decision to let a sync overwrite that column, not a side effect of adding it
 * to the schema.
 */
export const SEED_OWNED_FIELDS = [
  'name',
  'description',
  'sortOrder',
  'serviceCategory',
  'supplierForm',
  'onboardingHint',
  'cpvInclude',
  'cpvExclude',
  'keywordsInclude',
  'keywordsExclude',
] as const;

export type SeedOwnedField = (typeof SEED_OWNED_FIELDS)[number];

type ServiceTemplateRow = typeof schema.serviceTemplates.$inferSelect;

/** One column of one template that the row and the seed disagree about. */
export interface FieldDrift {
  readonly field: SeedOwnedField;
  /** What the row holds today, rendered for a screen. */
  readonly before: string;
  /** What applying would write. */
  readonly after: string;
}

export interface TemplateDrift {
  readonly slug: string;
  /** The seed's name, so the page can label the template it is about to change. */
  readonly name: string;
  readonly fields: readonly FieldDrift[];
}

export interface ServiceTemplateDriftReport {
  readonly rowCount: number;
  readonly seedCount: number;
  readonly drifted: readonly TemplateDrift[];
  /** Seeds with no row. Reported only — this never inserts. */
  readonly missingSlugs: readonly string[];
  /** Rows with no seed. Reported only — this never deletes. */
  readonly unseededSlugs: readonly string[];
}

/** Norwegian labels for the columns, so the page never prints a camelCase key. */
export const SEED_FIELD_LABELS_NB: Record<SeedOwnedField, string> = {
  name: 'Navn',
  description: 'Beskrivelse',
  sortOrder: 'Sortering',
  serviceCategory: 'Tjenestekategori',
  supplierForm: 'Leverandørform',
  onboardingHint: 'Onboardingtips',
  cpvInclude: 'CPV-koder (inkluder)',
  cpvExclude: 'CPV-koder (ekskluder)',
  keywordsInclude: 'Nøkkelord (inkluder)',
  keywordsExclude: 'Nøkkelord (ekskluder)',
};

/**
 * The value the seed would write, with readonly arrays copied.
 *
 * Drizzle's insert types want mutable arrays, and the seeds are frozen
 * `readonly` tuples shared by every consumer in the workspace; passing one
 * straight into `.set()` hands the driver a reference to shared state.
 */
function seedValue(seed: ServiceTemplateSeed, field: SeedOwnedField): unknown {
  const value = seed[field];
  return Array.isArray(value) ? [...(value as readonly unknown[])] : value;
}

/**
 * Renders a column value for a human.
 *
 * Comparison never uses this — two different values could render identically
 * and the diff would then hide a change it is meant to show. `JSON.stringify`
 * decides what differs; this only decides how it reads.
 */
function render(value: unknown): string {
  if (value === null || value === undefined) return '(ikke satt)';
  if (Array.isArray(value)) {
    return value.length === 0 ? '(tom liste)' : (value as readonly unknown[]).join(', ');
  }
  if (value === '') return '(tom tekst)';
  return String(value);
}

/**
 * Compares rows against seeds. Pure: no database, no clock, no environment.
 *
 * Kept separate from the read so the comparison can be tested directly and so
 * the page, the action and the terminal script all agree by construction about
 * what counts as drift.
 */
export function computeServiceTemplateDrift(
  rows: readonly ServiceTemplateRow[],
  seeds: readonly ServiceTemplateSeed[] = SERVICE_TEMPLATE_SEEDS,
): ServiceTemplateDriftReport {
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const seedSlugs = new Set(seeds.map((seed) => seed.slug));

  const drifted: TemplateDrift[] = [];
  const missingSlugs: string[] = [];

  for (const seed of seeds) {
    const row = bySlug.get(seed.slug);
    if (!row) {
      missingSlugs.push(seed.slug);
      continue;
    }

    const fields: FieldDrift[] = [];
    for (const field of SEED_OWNED_FIELDS) {
      const current: unknown = row[field];
      const wanted = seedValue(seed, field);
      // `?? null` so a nullable column (`onboarding_hint`) compares equal to a
      // seed that omits it rather than reporting `undefined` against `null`.
      if (JSON.stringify(current ?? null) === JSON.stringify(wanted ?? null)) continue;
      fields.push({ field, before: render(current), after: render(wanted) });
    }

    if (fields.length > 0) drifted.push({ slug: seed.slug, name: seed.name, fields });
  }

  return {
    rowCount: rows.length,
    seedCount: seeds.length,
    drifted,
    missingSlugs,
    unseededSlugs: rows.filter((row) => !seedSlugs.has(row.slug)).map((row) => row.slug),
  };
}

/** Reads the table and reports what a sync would change. Writes nothing. */
export async function loadServiceTemplateDrift(
  db: Database = getWebDb(),
): Promise<ServiceTemplateDriftReport> {
  const rows = await db.select().from(schema.serviceTemplates);
  return computeServiceTemplateDrift(rows);
}

/**
 * Writes the drift, and returns the report it acted on.
 *
 * It recomputes rather than accepting a report from the caller: the page that
 * rendered a diff may have been open for an hour, and applying a stale one
 * would write values nobody looked at. The returned report is therefore what
 * was actually done, not what was previously shown.
 */
export async function applyServiceTemplateDrift(
  db: Database = getWebDb(),
): Promise<ServiceTemplateDriftReport> {
  const rows = await db.select().from(schema.serviceTemplates);
  const report = computeServiceTemplateDrift(rows);
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const seedBySlug = new Map(SERVICE_TEMPLATE_SEEDS.map((seed) => [seed.slug, seed]));

  for (const drift of report.drifted) {
    const row = bySlug.get(drift.slug);
    const seed = seedBySlug.get(drift.slug);
    // Both are present by construction — a template only reaches `drifted`
    // when the row and the seed were compared — but a missing one must skip
    // rather than throw halfway through a loop of independent updates.
    if (!row || !seed) continue;

    // Built from the drifted field names only, so a column outside
    // `SEED_OWNED_FIELDS` cannot appear in the statement even by accident.
    const changes: Record<string, unknown> = {};
    for (const { field } of drift.fields) changes[field] = seedValue(seed, field);

    await db
      .update(schema.serviceTemplates)
      .set({ ...changes, updatedAt: new Date() } as Partial<
        typeof schema.serviceTemplates.$inferInsert
      >)
      .where(eq(schema.serviceTemplates.id, row.id));
  }

  return report;
}
