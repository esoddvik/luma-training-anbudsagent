import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  applyServiceTemplateDrift,
  loadServiceTemplateDrift,
} from '@/server/admin-service-templates';
import { MACHINE_SIGNATURE_HEADER, machineSignatureMatches } from '@/server/machine-signature';

/**
 * Reconcile `service_templates` with the editorial seeds, without a session
 * (relevance spec R1; the sibling of `/admin/tjenestemaler`).
 *
 * ## Why this exists at all
 *
 * `listServiceTemplateChoices` prefers the database and falls back to the seeds
 * only when the table is empty, so editing a seed changes nothing in any
 * populated environment. Removing `98300000 Diverse tjenester` from the renhold
 * template left production serving the old CPV list from a row no diff shows.
 *
 * `/admin/tjenestemaler` fixes that for a human: it renders the drift and
 * offers a button. This route is the same reconciliation for everything that is
 * not a human — a deploy step, a cron entry, a one-line command — because
 * production's environment variables are marked sensitive, so nobody can run
 * the script against it from a laptop, and requiring an interactive admin login
 * to correct a value that is already committed to git makes a routine thing
 * ceremonial.
 *
 * ## How it differs from `/revalider`, and why that matters
 *
 * The signing is copied from there deliberately, down to the header name, so
 * there is one way to authenticate a machine call in this app rather than two.
 * Read that file's note on why the secret is a signature over the body rather
 * than a token in a query string.
 *
 * What does *not* carry over is its reasoning about consequences. `/revalider`
 * says plainly that purging a cache is not destructive and the worst a forged
 * call achieves is regeneration. **This route writes to the database.** So the
 * blast radius is bounded in the code rather than in the argument:
 *
 * - It never inserts and never deletes. A seed with no row is reported, not
 *   created — `service_templates.id` is a foreign-key target for
 *   `alert_profiles.service_template_id`, so a row invented here would attach
 *   live profiles to a template nobody wrote. A row with no seed is reported,
 *   not removed.
 * - It writes only `SEED_OWNED_FIELDS`, and the `UPDATE` payload is built from
 *   the drifted field names, so a column outside that list cannot reach the
 *   statement. `admin-service-templates.integration.test.ts` asserts that, and
 *   the assertion has been shown to fail.
 * - The only values it can write are the ones committed to
 *   `packages/content/src/service-templates.ts`. A forged call cannot choose
 *   what lands in the table; it can only force the table to agree with the
 *   repository sooner than someone intended.
 *
 * **Replay is safe and is the reason `apply` is a body field rather than a
 * separate route.** Running twice is a no-op: the second call finds no drift
 * and writes nothing. A captured request replayed later does the same thing it
 * did the first time, which for this operation is exactly nothing.
 *
 * ## Reporting by default
 *
 * `apply` defaults to `false`, so the bare call is a dry run that returns the
 * diff. That is the same shape as the script and the admin page — see the drift
 * before writing it — and it means a cron entry can be pointed at this route to
 * *alert* on drift without being authorised to fix it.
 */

const body = z.object({
  /** Write the drift. Omitted or false, the call only reports it. */
  apply: z.boolean().default(false),
});

export async function POST(request: Request): Promise<Response> {
  const secret = process.env['CRON_SECRET'];
  if (!secret || secret.length === 0) {
    // Refusing is the safe failure, and more so here than in `/revalider`: a
    // route that writes to the template table for anyone when its secret is
    // missing would be most permissive exactly when the environment is most
    // broken.
    return Response.json({ error: 'sync_not_configured' }, { status: 503 });
  }

  const raw = await request.text();
  if (!machineSignatureMatches(raw, request.headers.get(MACHINE_SIGNATURE_HEADER), secret)) {
    return Response.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let parsed: z.infer<typeof body>;
  try {
    // An empty body is a valid dry run: `curl -d ''` with a signature over the
    // empty string is the cheapest way to ask "is anything drifting?".
    parsed = body.parse(raw.length === 0 ? {} : JSON.parse(raw));
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }

  const report = parsed.apply
    ? await applyServiceTemplateDrift()
    : await loadServiceTemplateDrift();

  if (parsed.apply && report.drifted.length > 0) {
    // The trade pages prefill their CPV chips from the template, so a synced
    // template that nobody regenerates is a page still showing the old codes.
    // Same segment-level call as `/revalider` uses, for the same reason.
    revalidatePath('/anbud-for', 'layout');
    revalidatePath('/finn-anbud');
  }

  return Response.json({
    applied: parsed.apply,
    rowCount: report.rowCount,
    seedCount: report.seedCount,
    // The field-level before/after, so a dry run is readable without a browser
    // and an applied run records what it changed.
    drifted: report.drifted,
    missingSlugs: report.missingSlugs,
    unseededSlugs: report.unseededSlugs,
  });
}
