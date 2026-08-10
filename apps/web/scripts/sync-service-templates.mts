/**
 * Bring `service_templates` back in line with the editorial seeds, from a
 * terminal.
 *
 * ## Why this exists
 *
 * `listServiceTemplateChoices` prefers the database over
 * `packages/content/src/service-templates.ts` and falls back to the seeds only
 * when the table is empty. That means editing a seed changes nothing anywhere
 * the table is populated — which is every deployed environment. The seeds are
 * the reviewable source of truth in git; the table is what actually runs.
 *
 * It was written because removing `98300000 Diverse tjenester` from the renhold
 * template in git left the running system untouched, and nobody would have
 * noticed: the page kept serving the old CPV list from a row no diff shows.
 *
 * ## Where the logic lives
 *
 * Not here. The comparison, the owned-field list and the write are all in
 * `src/server/admin-service-templates.ts`, because the same reconciliation is
 * offered as an admin button at `/admin/tjenestemaler` — production marks its
 * environment variables sensitive, so `DATABASE_URL` cannot be pulled to a
 * laptop and this script cannot reach production at all. Two implementations
 * of "what counts as drift" would drift; this file is a terminal front end for
 * dev and nothing more.
 *
 * ## Safety
 *
 * Reports by default and writes only with `--apply`. It updates exactly the
 * fields the seeds own, matched by slug; it never inserts, never deletes, and
 * never touches `active`, `deletedAt`, `id` or the timestamps.
 *
 * **It has no way to tell an editorial change from drift.** Today that is
 * safe — nothing in the app writes to this table. The moment admin editing
 * ships, running `--apply` will discard whatever an editor changed, and the
 * module above needs a real answer before then.
 *
 *   pnpm tsx scripts/sync-service-templates.mts            # report only
 *   pnpm tsx scripts/sync-service-templates.mts --apply    # write
 */
import { createDatabase } from '@luma/db';
import {
  applyServiceTemplateDrift,
  loadServiceTemplateDrift,
  SEED_FIELD_LABELS_NB,
} from '../src/server/admin-service-templates.ts';

const apply = process.argv.includes('--apply');
const { db, close } = createDatabase({ max: 2 });

try {
  const report = apply
    ? await applyServiceTemplateDrift(db)
    : await loadServiceTemplateDrift(db);

  for (const slug of report.missingSlugs) {
    console.log(`MISSING   ${slug} — no row. This script does not insert.`);
  }
  for (const slug of report.unseededSlugs) {
    console.log(`UNSEEDED  ${slug} — row with no seed. This script does not delete.`);
  }
  for (const drift of report.drifted) {
    for (const field of drift.fields) {
      console.log(
        `${apply ? 'APPLIED  ' : 'DRIFT    '} ${drift.slug}.${field.field} (${SEED_FIELD_LABELS_NB[field.field]})\n` +
          `            db:   ${field.before}\n            seed: ${field.after}`,
      );
    }
  }

  const verb = apply ? 'updated' : 'would update';
  console.log(
    `\n${report.rowCount} rows, ${report.seedCount} seeds — ${verb} ${report.drifted.length}` +
      (report.missingSlugs.length > 0 ? `, ${report.missingSlugs.length} missing` : '') +
      (apply || report.drifted.length === 0 ? '' : '\nRe-run with --apply to write.'),
  );
} finally {
  await close();
}
