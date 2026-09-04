'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { safeReturnPath } from '@/lib/return-path';
import { getWebDb } from '../db';
import { recordTermsAcceptance } from '../legal';
import { applyLegalDocumentDrift } from '../legal-documents';
import { requireAdmin, requireUser } from '../session';
import { withMessage } from './messages';

/**
 * Publishing committed terms versions into `legal_document_versions`
 * (spec section 19, ADR-11).
 *
 * Like the service-template sync next door, this does not go through `core`:
 * it is a small number of inserts in the web app's own database, well inside a
 * request, and forwarding it would buy a network hop and a second copy of the
 * rules. `legal-documents.ts` carries the rest of the argument.
 *
 * `requireAdmin` calls `notFound()` rather than returning, so a non-admin gets
 * a 404 and never learns the route exists.
 */
export async function syncLegalDocumentsAction(): Promise<void> {
  await requireAdmin();

  const report = await applyLegalDocumentDrift();

  revalidatePath('/admin/vilkar');
  // The public terms page renders the version in force, so publishing a new
  // one changes it.
  revalidatePath('/vilkar');

  /**
   * A conflict outranks a successful publication in the message.
   *
   * A conflict means published legal text was edited in place — somebody has
   * to go and look, and a green "published" banner on the same screen would
   * bury that. The two states are not mutually exclusive: one version can be
   * inserted in the same run that another is refused.
   */
  const code =
    report.conflicts.length > 0
      ? 'vilkar-konflikt'
      : report.insertable.length > 0
        ? 'vilkar-publisert'
        : 'vilkar-uendret';

  redirect(withMessage('/admin/vilkar', code));
}

/**
 * Accepting the terms version the user was shown (spec section 20.1).
 *
 * ## The version comes from the form
 *
 * Not re-read as "whatever is current now". If a newer version is published
 * between the page rendering and the button being pressed, the user accepts
 * the one they actually read, and the gate catches them again on the next
 * request — which is correct, because they have not seen the newer one.
 * Recording an acceptance of text nobody was shown is the failure this whole
 * flow exists to fix, and doing it here would be doing it deliberately.
 *
 * An unknown version is a stale or forged form, so it is sent back to the page
 * rather than recorded. `recordTermsAcceptance` would refuse it anyway — the
 * acceptance has a composite foreign key onto the version — but a Norwegian
 * page is a better answer than a constraint violation.
 */
export async function acceptTermsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const version = String(formData.get('versjon') ?? '');
  const returnPath = safeReturnPath(String(formData.get('retur') ?? ''));

  const db = getWebDb();
  const [documentVersion] = await db
    .select({
      version: schema.legalDocumentVersions.version,
      body: schema.legalDocumentVersions.body,
      effectiveFrom: schema.legalDocumentVersions.effectiveFrom,
    })
    .from(schema.legalDocumentVersions)
    .where(
      and(
        eq(schema.legalDocumentVersions.kind, 'terms'),
        eq(schema.legalDocumentVersions.version, version),
      ),
    )
    .limit(1);

  if (!documentVersion) redirect('/vilkar/godta');

  await db.transaction(async (tx) => {
    await recordTermsAcceptance(tx, {
      userId: user.id,
      version: documentVersion.version,
      body: documentVersion.body,
      effectiveFrom: documentVersion.effectiveFrom,
      now: new Date(),
      // Not captured here. The acceptance carries the same evidential weight
      // wherever it happened, and the signup path records these because it has
      // them on the pending row; inventing them from a server action would be
      // recording something we did not observe.
      ipAddressHash: null,
      userAgent: null,
      source: 'account_settings',
    });
  });

  redirect(returnPath ?? '/oversikt');
}
