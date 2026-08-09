'use server';

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { z } from 'zod';
import { clientIdentity } from '../client-identity';
import { getWebDb } from '../db';
import { draftFromTemplate, safeDraftReturnPath } from '../draft-profile';
import { recordFunnelEvent } from '../funnel';
import { loadTemplateChoice } from '../profiles';
import { requestSignupConfirmation } from '../registration';
import { withMessage, type ActionMessageCode } from './messages';

/**
 * The signup form's server action (IDE Agent Spec v3, section 3.1).
 *
 * A plain `<form action={...}>` with no client JavaScript, like every other
 * form in this app. The reasoning `login-actions.ts` records applies here with
 * one addition: this is the form at the end of the public funnel, so it is the
 * one most likely to be reached from a corporate proxy that strips bundles or
 * a browser that will not run them.
 *
 * **The action makes no decisions that depend on the address.** It reads the
 * form, hands the work to `requestSignupConfirmation`, and turns the two
 * possible outcomes into two codes. `hadExistingAccount` is deliberately never
 * consulted here, and adding a third code for it is how the enumeration
 * defence in `registration.ts` would be undone by someone trying to be
 * helpful — the redirect is as observable as the message.
 */

const templateSlug = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]+$/)
  .max(120);

export async function requestSignupAction(formData: FormData): Promise<void> {
  const rawEmail = formData.get('epost');
  const rawTemplate = formData.get('tjenestemal');
  const rawReturn = formData.get('retur');
  const rawRegion = formData.get('landsdel');

  const returnPath = safeDraftReturnPath(typeof rawReturn === 'string' ? rawReturn : undefined);
  const parsedSlug = templateSlug.safeParse(typeof rawTemplate === 'string' ? rawTemplate : '');

  /*
   * Resolved server-side, never trusted from the form: the criteria that
   * pre-fill a profile are editorial content (spec section 11.2), and a posted
   * CPV list would let anyone write arbitrary criteria into a profile that does
   * not exist yet. Only the *slug* is taken from the submission.
   *
   * **Resolved through `loadTemplateChoice`, which is the same source the page
   * rendered its options from.** That is the whole point, and it was wrong
   * before: this looked templates up in `service_templates` directly while the
   * pages rendered from `listServiceTemplateChoices`, which falls back to the
   * editorial seeds when the table is empty. Production's table *is* empty, so
   * the form offered eight trades and the action rejected every one of them as
   * `ugyldig` — a signup flow that rendered perfectly and could not be
   * completed.
   *
   * The form and the action now read one function, so they cannot disagree
   * about which trades exist regardless of whether anything is seeded.
   */
  const template = parsedSlug.success ? await loadTemplateChoice(parsedSlug.data) : null;

  if (!template) {
    redirect(withMessage('/#registrering', 'ugyldig'));
  }

  /*
   * The database row's id, when there is one, for analytics only.
   *
   * `alert_profiles.service_template_id` is a foreign key, so it can only be
   * set from a real row — a seed has no id. Spec section 11.2 is explicit that
   * this column is recorded for analytics and must not influence matching, so a
   * profile created against the seed fallback is fully functional without it.
   * Looking it up separately keeps a missing row from blocking the signup.
   */
  const [row] = await getWebDb()
    .select({ id: schema.serviceTemplates.id })
    .from(schema.serviceTemplates)
    .where(eq(schema.serviceTemplates.slug, template.slug))
    .limit(1)
    .catch(() => []);

  const { ip, userAgent } = await clientIdentity();

  // Recorded before the send, not after: this counts *attempts*, and a signup
  // lost to a Postmark outage is exactly the one the funnel needs to show. The
  // completion event is written when the link is confirmed.
  await recordFunnelEvent({
    type: 'signup_started',
    serviceTemplateSlug: template.slug,
    ...(typeof rawRegion === 'string' && rawRegion.length > 0 ? { landsdelSlug: rawRegion } : {}),
  });

  const result = await requestSignupConfirmation({
    // An absent or non-string field is passed through as an empty address
    // rather than short-circuited, so a malformed submission takes the same
    // path — and the same time — as a well-formed one.
    email: typeof rawEmail === 'string' ? rawEmail : '',
    draft: draftFromTemplate({
      templateName: template.name,
      cpvInclude: template.cpvInclude,
      keywordsInclude: template.keywordsInclude,
      ...(typeof rawRegion === 'string' && rawRegion.length > 0
        ? { regionsInclude: [rawRegion] }
        : {}),
      // Omitted entirely when nothing is seeded. The column is nullable and
      // analytics-only, so a profile without it matches identically.
      ...(row ? { serviceTemplateId: row.id } : {}),
    }),
    serviceTemplateSlug: template.slug,
    returnPath,
    ipAddress: ip,
    userAgent,
  });

  const code: ActionMessageCode = result.ok ? 'sjekk-e-post' : 'for-mange-lenker';
  redirect(withMessage('/registrering/sjekk-e-post', code));
}
