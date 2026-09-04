import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { applyLegalDocumentDrift, loadLegalDocumentDrift } from '@/server/legal-documents';
import { MACHINE_SIGNATURE_HEADER, machineSignatureMatches } from '@/server/machine-signature';

/**
 * Publish committed terms versions without a session
 * (spec section 19; the sibling of `/admin/vilkar`).
 *
 * ## Why this exists
 *
 * The same reason `/synk-tjenestemaler` does: production marks its environment
 * variables sensitive, so nobody can reach the production database from a
 * laptop, and requiring an interactive admin login to publish a document that
 * is already committed to git makes a routine thing ceremonial. Read that
 * route's note on why the secret is a signature over the body rather than a
 * token in a query string — the signing here is copied from it deliberately,
 * down to the header name, so there is one way to authenticate a machine call
 * in this app rather than two.
 *
 * ## Blast radius
 *
 * This route writes to the database, so the limit is in the code rather than
 * in the argument:
 *
 * - It **only inserts**. It never updates and never deletes. A published
 *   version whose body has drifted is reported as a conflict and left exactly
 *   as it is, because `user_legal_acceptances` references `(kind, version)`
 *   and rewriting a body would change what people already agreed to (ADR-11).
 * - The only values it can write are the ones committed to
 *   `packages/content/src/legal-documents.ts`. A forged call cannot choose
 *   what lands in the table; it can only publish a version already reviewed
 *   and checked in, sooner than someone intended.
 * - It cannot un-publish anything, so there is no call that removes a document
 *   users are being asked to accept.
 *
 * **Replay is safe**, which is why `apply` is a body field rather than a
 * separate route: the second call finds nothing to insert and writes nothing.
 *
 * ## Reporting by default
 *
 * `apply` defaults to `false`, so the bare call is a dry run returning what
 * would be published and what is conflicting. A cron entry can therefore be
 * pointed at this route to *alert* on a hand-edited legal document without
 * being authorised to publish anything.
 */

const body = z.object({
  /** Publish the missing versions. Omitted or false, the call only reports. */
  apply: z.boolean().default(false),
});

export async function POST(request: Request): Promise<Response> {
  const secret = process.env['CRON_SECRET'];
  if (!secret || secret.length === 0) {
    // Refusing is the safe failure: a route that publishes legal documents for
    // anyone when its secret is missing would be most permissive exactly when
    // the environment is most broken.
    return Response.json({ error: 'sync_not_configured' }, { status: 503 });
  }

  const raw = await request.text();
  if (!machineSignatureMatches(raw, request.headers.get(MACHINE_SIGNATURE_HEADER), secret)) {
    return Response.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(raw.length === 0 ? {} : JSON.parse(raw));
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }

  const report = parsed.apply ? await applyLegalDocumentDrift() : await loadLegalDocumentDrift();

  if (parsed.apply && report.insertable.length > 0) {
    // `/vilkar` renders the version in force, so publishing changes it.
    revalidatePath('/vilkar');
  }

  return Response.json({
    applied: parsed.apply,
    // Version identifiers only. The bodies are in git; echoing a full legal
    // document into a machine response would make the log the least useful
    // copy of it.
    published: report.insertable.map((seed) => ({ kind: seed.kind, version: seed.version })),
    conflicts: report.conflicts,
    unseeded: report.unseeded,
  });
}
