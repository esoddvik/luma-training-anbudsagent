'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { clientIdentity } from '../client-identity';
import { getWebDb } from '../db';
import { draftFromTemplate, safeDraftReturnPath } from '../draft-profile';
import { listServiceTemplates } from '../profiles';
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

  // Resolved from the database rather than trusted from the form: the criteria
  // that pre-fill a profile are editorial content (spec section 11.2), and a
  // posted CPV list would let anyone write arbitrary criteria into a profile
  // that has not been created yet.
  const templates = await listServiceTemplates(getWebDb());
  const template = parsedSlug.success
    ? templates.find((candidate) => candidate.slug === parsedSlug.data)
    : undefined;

  if (!template) {
    redirect(withMessage('/#registrering', 'ugyldig'));
  }

  const { ip, userAgent } = await clientIdentity();

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
      serviceTemplateId: template.id,
    }),
    serviceTemplateSlug: template.slug,
    returnPath,
    ipAddress: ip,
    userAgent,
  });

  const code: ActionMessageCode = result.ok ? 'sjekk-e-post' : 'for-mange-lenker';
  redirect(withMessage('/registrering/sjekk-e-post', code));
}
