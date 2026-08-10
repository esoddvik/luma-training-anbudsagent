/**
 * Call `/synk-tjenestemaler` on a deployed environment.
 *
 * The sibling script, `sync-service-templates.ts`, talks to a database
 * directly. That works for dev and for anything whose `DATABASE_URL` you hold.
 * It does not work for production: this project marks its production
 * environment variables sensitive, so `vercel env pull --environment
 * production` returns `[SENSITIVE]` for every value. The connection string is
 * genuinely unavailable outside Vercel, by design.
 *
 * So this one goes over HTTP instead and proves who it is with `CRON_SECRET`,
 * signing the body exactly as the ingest worker signs `/revalider`.
 *
 * Reports by default; writes only with `--apply`, the same shape as the script,
 * the admin page and the route.
 *
 *   CRON_SECRET=… pnpm tsx scripts/sync-service-templates-remote.ts \
 *     --url https://www.luma-training.com/anbudsvarsling
 *
 *   CRON_SECRET=… pnpm tsx scripts/sync-service-templates-remote.ts \
 *     --url https://www.luma-training.com/anbudsvarsling --apply
 *
 * `CRON_SECRET` is read from the environment and never accepted as an
 * argument: a secret on the command line lands in shell history and in the
 * process list, where anyone on the machine can read it.
 */
import { signMachineRequest, MACHINE_SIGNATURE_HEADER } from '../src/server/machine-signature';
import type { ServiceTemplateDriftReport } from '../src/server/admin-service-templates';

/**
 * The route's JSON, typed from the server's own interface rather than restated.
 *
 * The first version of this file declared the shape by hand and gave `FieldDrift`
 * a `label` the server never sends. It typechecked — a hand-written type cannot
 * disagree with itself — and printed `(undefined)` for every field on the first
 * real run. A **type-only** import is erased at compile time, so binding to the
 * real interface costs nothing at runtime: this script never loads the database
 * client, which is the point, since it exists to be run where `DATABASE_URL` is
 * unavailable.
 */
type SyncResponse = ServiceTemplateDriftReport & { readonly applied: boolean };

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const base = argValue('--url');
const apply = process.argv.includes('--apply');
const secret = process.env['CRON_SECRET'];

if (!base) {
  console.error('Mangler --url, for eksempel https://www.luma-training.com/anbudsvarsling');
  process.exit(2);
}
if (!secret) {
  console.error('Mangler CRON_SECRET i miljøet.');
  process.exit(2);
}

const raw = JSON.stringify({ apply });
const response = await fetch(`${base.replace(/\/$/, '')}/synk-tjenestemaler`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    [MACHINE_SIGNATURE_HEADER]: signMachineRequest(raw, secret),
  },
  body: raw,
});

if (!response.ok) {
  // The route answers 401 for a bad signature, 503 when CRON_SECRET is unset
  // in the environment being called, 400 for a malformed body.
  console.error(`HTTP ${response.status}: ${await response.text()}`);
  process.exit(1);
}

const report = (await response.json()) as SyncResponse;

for (const slug of report.missingSlugs) {
  console.log(`MANGLER   ${slug} — ingen rad. Ruten setter aldri inn.`);
}
for (const slug of report.unseededSlugs) {
  console.log(`USÅDD     ${slug} — rad uten seed. Ruten sletter aldri.`);
}
for (const drift of report.drifted) {
  for (const field of drift.fields) {
    // The field name, not a Norwegian label: `SEED_FIELD_LABELS_NB` lives in a
    // module that also imports the database client, and this script has to run
    // where there is no `DATABASE_URL`. The column name is unambiguous in a
    // terminal; the label is for the admin page, which has a database anyway.
    console.log(
      `AVVIK     ${drift.slug}.${field.field}\n` +
        `            db:   ${field.before}\n` +
        `            seed: ${field.after}`,
    );
  }
  if (report.applied) console.log(`SKREVET   ${drift.slug}`);
}

const verb = report.applied ? 'oppdaterte' : 'ville oppdatert';
console.log(
  `\n${report.rowCount} rader, ${report.seedCount} seeds — ${verb} ${report.drifted.length}` +
    (report.applied || report.drifted.length === 0
      ? ''
      : '\nKjør på nytt med --apply for å skrive.'),
);
