import { eq } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { LEGAL_DOCUMENT_SEEDS, type LegalDocumentSeed } from '@luma/content';
import { getWebDb, type Database } from './db';

/**
 * Reconciling `legal_document_versions` with the committed content
 * (spec section 19, ADR-11).
 *
 * The sibling of `admin-service-templates.ts`, and deliberately weaker than it
 * in the one way that matters. That file *updates* drifted rows, because a
 * service template is editorial content nobody has agreed to. This one must
 * never update and never delete: `user_legal_acceptances` carries a composite
 * foreign key onto `(kind, version)`, so rewriting a published body changes
 * what people already agreed to, which is exactly what ADR-11 exists to
 * prevent.
 *
 * The three outcomes:
 *
 * - a seed with no row is **inserted**;
 * - a row whose body differs from its seed is a **conflict** — reported and
 *   refused, because it means published legal text was edited in place, and
 *   the correction is to publish a new version rather than to make the table
 *   agree;
 * - a row with no seed is **reported**, never deleted. A retired version still
 *   has acceptances pointing at it, and those name it by version string.
 *
 * ## Why a sync at all
 *
 * Production marks its environment variables sensitive, so nobody can reach
 * the production database from a laptop to insert a version by hand. The
 * reconciliation has to run inside production — which is what the admin page
 * and the signed route are for. The same argument `admin-service-templates.ts`
 * makes at more length.
 */

/** The subset of a version row the comparison needs. */
export interface LegalVersionRowish {
  readonly kind: string;
  readonly version: string;
  readonly body: string;
}

export interface LegalDocumentRef {
  readonly kind: string;
  readonly version: string;
}

export interface LegalDocumentDriftReport {
  /** Seeds with no row. These, and only these, are what `apply` writes. */
  readonly insertable: readonly LegalDocumentSeed[];
  /** Published versions whose body no longer matches the seed. Never written. */
  readonly conflicts: readonly LegalDocumentRef[];
  /** Rows with no seed. Never removed. */
  readonly unseeded: readonly LegalDocumentRef[];
}

const refKey = (ref: LegalDocumentRef): string => `${ref.kind}:${ref.version}`;

/**
 * Compares rows against the committed content. Pure: no database, no clock,
 * no environment.
 *
 * Kept separate from the read so the page, the action and the signed route all
 * agree by construction about what counts as publishable and what counts as a
 * conflict.
 */
export function computeLegalDocumentDrift(
  rows: readonly LegalVersionRowish[],
  seeds: readonly LegalDocumentSeed[] = LEGAL_DOCUMENT_SEEDS,
): LegalDocumentDriftReport {
  const byKey = new Map(rows.map((row) => [refKey(row), row]));
  const seedKeys = new Set(seeds.map((seed) => refKey(seed)));

  const insertable: LegalDocumentSeed[] = [];
  const conflicts: LegalDocumentRef[] = [];

  for (const seed of seeds) {
    const row = byKey.get(refKey(seed));
    if (!row) {
      insertable.push(seed);
      continue;
    }
    if (row.body !== seed.body) conflicts.push({ kind: seed.kind, version: seed.version });
  }

  return {
    insertable,
    conflicts,
    unseeded: rows
      .filter((row) => !seedKeys.has(refKey(row)))
      .map((row) => ({ kind: row.kind, version: row.version })),
  };
}

/**
 * Reads the table and reports what a sync would publish. Writes nothing.
 *
 * `seeds` is injectable so the insert path can be driven by a test against a
 * version the committed content does not carry. Without it the only publish
 * this module could ever perform in a test is one the migration has already
 * done, and the insert would be covered by nothing.
 */
export async function loadLegalDocumentDrift(
  db: Database = getWebDb(),
  seeds: readonly LegalDocumentSeed[] = LEGAL_DOCUMENT_SEEDS,
): Promise<LegalDocumentDriftReport> {
  const rows = await db
    .select({
      kind: schema.legalDocumentVersions.kind,
      version: schema.legalDocumentVersions.version,
      body: schema.legalDocumentVersions.body,
    })
    .from(schema.legalDocumentVersions);
  return computeLegalDocumentDrift(rows, seeds);
}

/**
 * Inserts the missing versions and returns the report it acted on.
 *
 * Recomputed rather than taking a report from the caller: a page that rendered
 * a diff may have been open for an hour, and acting on a stale one would
 * publish something nobody looked at.
 */
export async function applyLegalDocumentDrift(
  db: Database = getWebDb(),
  seeds: readonly LegalDocumentSeed[] = LEGAL_DOCUMENT_SEEDS,
): Promise<LegalDocumentDriftReport> {
  const report = await loadLegalDocumentDrift(db, seeds);

  for (const seed of report.insertable) {
    const [existing] = await db
      .select({ id: schema.legalDocuments.id })
      .from(schema.legalDocuments)
      .where(eq(schema.legalDocuments.kind, seed.kind))
      .limit(1);

    // The parent row is a foreign-key target, and unlike a service template
    // nothing points at it until its first version exists — so it is created
    // rather than reported missing. `legal_documents` is unique on `kind`, so
    // there is at most one per kind and later versions reuse it.
    const legalDocumentId =
      existing?.id ??
      (
        await db
          .insert(schema.legalDocuments)
          .values({
            kind: seed.kind,
            // NOT NULL, and customer-facing, so Norwegian (spec section 6).
            title: seed.kind === 'terms' ? 'Vilkår for bruk' : 'Personvernerklæring',
          })
          .returning({ id: schema.legalDocuments.id })
      )[0]!.id;

    await db
      .insert(schema.legalDocumentVersions)
      .values({
        legalDocumentId,
        kind: seed.kind,
        version: seed.version,
        body: seed.body,
        isPlaceholder: seed.isPlaceholder,
        effectiveFrom: seed.effectiveFrom,
      })
      // Two operators pressing the button at once is the same publication
      // twice, not two publications. The existing row is never rewritten.
      .onConflictDoNothing({
        target: [schema.legalDocumentVersions.kind, schema.legalDocumentVersions.version],
      });
  }

  return report;
}
