'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { SESSION_COOKIE_NAME } from '@luma/auth';
import * as schema from '@luma/db/schema';
import { MARKETING_CONSENT_TEXT_NB } from '@luma/domain';
import { z } from 'zod';
import { getWebDb, marketingConsentTextVersion, privacyPolicyVersion } from '../db';
import { requireUser } from '../session';
import { withMessage } from './messages';

/**
 * Notification preferences, marketing consent and account deletion
 * (spec sections 20 to 22, and section 40).
 *
 * The two switches on the settings page are deliberately not the same
 * mechanism, and this file is where that separation is enforced:
 *
 * - **Promotion in tender emails** is a content setting. It lives in
 *   `notification_preferences`, and turning it off must never stop the tender
 *   alerts (spec section 22).
 * - **Marketing consent** is an append-only event (ADR-9). Granting and
 *   withdrawing both *insert* a row carrying the exact wording version, the
 *   source and the timestamp. Nothing here updates or deletes a consent row;
 *   migration `0001` installs a trigger that would refuse anyway.
 *
 * Spec section 21 also requires that unsubscribing from tender alerts does not
 * remove marketing consent and vice versa. Two actions, two tables, no shared
 * column.
 */

const preferencesForm = z.object({
  tenderAlertsEnabled: z.boolean(),
  immediateAlertsEnabled: z.boolean(),
  digestEnabled: z.boolean(),
  includeLumaPromotionsInTenderEmails: z.boolean(),
});

/** Reads an HTML checkbox: present means on, absent means off. */
function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === 'on';
}

export async function updateNotificationPreferencesAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const parsed = preferencesForm.safeParse({
    tenderAlertsEnabled: checkbox(formData, 'tenderAlertsEnabled'),
    immediateAlertsEnabled: checkbox(formData, 'immediateAlertsEnabled'),
    digestEnabled: checkbox(formData, 'digestEnabled'),
    includeLumaPromotionsInTenderEmails: checkbox(formData, 'includeLumaPromotionsInTenderEmails'),
  });
  if (!parsed.success) redirect(withMessage('/innstillinger', 'ugyldig'));

  const db = getWebDb();
  await db
    .insert(schema.notificationPreferences)
    .values({ userId: user.id, ...parsed.data })
    .onConflictDoUpdate({
      target: schema.notificationPreferences.userId,
      set: { ...parsed.data, updatedAt: new Date() },
    });

  revalidatePath('/innstillinger');
  revalidatePath('/oversikt');
  redirect(withMessage('/innstillinger', 'innstillinger-lagret'));
}

/**
 * Records marketing consent, or withdraws it (spec section 20.2).
 *
 * The wording the user saw is stored by reference to a versioned row, so the
 * record can answer "what exactly did they agree to" years later. The version
 * row is created on demand from `MARKETING_CONSENT_TEXT_NB` — the same constant
 * the checkbox renders — so the stored evidence cannot drift from the text on
 * screen.
 */
export async function setMarketingConsentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const grant = formData.get('samtykke') === 'ja';

  const db = getWebDb();
  const version = marketingConsentTextVersion();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.consentTextVersions)
      .values({
        consentType: 'marketing_email',
        version,
        body: MARKETING_CONSENT_TEXT_NB,
        effectiveFrom: now,
      })
      .onConflictDoNothing();

    await tx.insert(schema.consentEvents).values({
      userId: user.id,
      consentType: 'marketing_email',
      // Withdrawal is a new event, never an edit of the previous one.
      status: grant ? 'granted' : 'withdrawn',
      source: 'account_settings',
      policyVersion: privacyPolicyVersion() ?? null,
      consentTextVersion: version,
      occurredAt: now,
    });
  });

  revalidatePath('/innstillinger');
  redirect(withMessage('/innstillinger', grant ? 'samtykke-gitt' : 'samtykke-trukket'));
}

/**
 * Deletes the account (spec section 40, launch blocker section 51 point 14).
 *
 * A hard delete. The schema is built for it: everything that hangs off a user
 * declares an explicit `onDelete`, cascading the person's own activity and
 * severing the evidence rows the controller has to keep. A `deleted_at` column
 * on `users` would be personal data wearing the costume of a feature.
 *
 * Confirmation is by typing the account's own e-mail address, so the
 * irreversible action cannot happen on a stray click, and the session cookie is
 * cleared in the same request so the browser is not left holding a cookie for a
 * row that no longer exists.
 */
export async function deleteAccountAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const confirmation = formData.get('bekreftelse');

  if (
    typeof confirmation !== 'string' ||
    confirmation.trim().toLowerCase() !== user.email.toLowerCase()
  ) {
    redirect('/innstillinger/slett-konto?feil=bekreftelse');
  }

  const db = getWebDb();
  await db.delete(schema.users).where(eq(schema.users.id, user.id));

  const jar = await cookies();
  jar.delete(SESSION_COOKIE_NAME);

  redirect('/?konto=slettet');
}
