'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { applyLegalDocumentDrift } from '../legal-documents';
import { requireAdmin } from '../session';
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
