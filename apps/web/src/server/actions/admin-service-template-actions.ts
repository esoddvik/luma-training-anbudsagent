'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { applyServiceTemplateDrift } from '../admin-service-templates';
import { requireAdmin } from '../session';
import { withMessage } from './messages';

/**
 * Writing the editorial seeds back into `service_templates` (spec section 11.2).
 *
 * Unlike the two Doffin actions next door, this does **not** go through `core`.
 * That forwarding exists because ingest needs the Doffin adapter and spec
 * section 36 forbids running it as a request-bound Vercel function. This is a
 * handful of `UPDATE`s on eight rows in the web app's own database — well
 * inside a request — so it runs here, and `admin-service-templates.ts` explains
 * the rest.
 *
 * `requireAdmin` is the only authorisation check there is, since no other
 * service is involved. It calls `notFound()` rather than returning, so a
 * non-admin gets a 404 and never learns the route exists.
 */
export async function syncServiceTemplatesAction(): Promise<void> {
  await requireAdmin();

  const report = await applyServiceTemplateDrift();

  revalidatePath('/admin/tjenestemaler');

  // The page renders the diff before offering the button, so an empty report
  // means the drift went away between the render and the press — another
  // operator, or a deploy. Saying "synchronised" there would be a small lie
  // about work that did not happen.
  redirect(
    withMessage(
      '/admin/tjenestemaler',
      report.drifted.length > 0 ? 'maler-synkronisert' : 'maler-uendret',
    ),
  );
}
