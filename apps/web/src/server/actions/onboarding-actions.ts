'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { MARKETING_CONSENT_TEXT_NB, normalizeCpv } from '@luma/domain';
import { z } from 'zod';
import { getWebDb, marketingConsentTextVersion, privacyPolicyVersion, type Database } from '../db';
import { safeDraftReturnPath } from '../draft-profile';
import { recordFunnelEvent } from '../funnel';
import { requireUser } from '../session';
import { withMessage } from './messages';

/**
 * The last step of the search-first signup: reviewing the profile that
 * `registration.confirmSignup` just created, and switching it on
 * (IDE Agent Spec v3, section 3.2; design B5 «Stemmer dette?»).
 *
 * ## Why this is a separate file from `profile-actions.ts`
 *
 * Those actions serve the profile *editor*, where the whole form is submitted
 * and the criteria are replaced wholesale. This step is the opposite shape: a
 * reader who has never seen a form removes one chip at a time from a profile
 * the service filled in for them, and then presses one button that means «yes,
 * start sending». Folding either of these into `updateProfileAction` would mean
 * rebuilding the entire criteria set from a page that renders none of it — one
 * missing hidden field away from silently emptying a profile.
 *
 * Both actions here work with JavaScript switched off, because every other form
 * in this app does: a chip is a `<button type="submit">` inside its own tiny
 * `<form>`, and the activation is a plain form post. Nothing on the review page
 * is a client component.
 *
 * ## The ownership rule
 *
 * The profile id travels in the URL and in a hidden field, so it is attacker
 * controlled, and every action below re-resolves the session and re-checks the
 * ownership itself. A layout is not a security boundary for a server action —
 * Next does not re-run it — which is the same reason `profile-actions.ts`
 * calls `requireUser()` in every export.
 */

const REVIEW_PATH = '/registrering/profil';

/** Which chip row a removal came from. Norwegian, because the form field is. */
const criterionField = z.enum(['cpv', 'sokeord']);

interface OwnedProfile {
  readonly id: string;
  readonly active: boolean;
  readonly serviceTemplateSlug: string | null;
}

/**
 * Resolves a profile the signed-in user owns, or `null`.
 *
 * Deliberately a copy of the check in `profile-actions.ts` rather than an
 * import: that one is a private helper of the editor's module, and the property
 * being enforced — user id in the `where`, soft-deleted rows excluded — is one
 * that must be visible at the point of use rather than delegated to a name.
 */
async function ownedProfile(
  db: Database,
  profileId: string,
  userId: string,
): Promise<OwnedProfile | null> {
  const [row] = await db
    .select({
      id: schema.alertProfiles.id,
      active: schema.alertProfiles.active,
      serviceTemplateSlug: schema.serviceTemplates.slug,
    })
    .from(schema.alertProfiles)
    // Left, not inner: `service_template_id` is nullable, and an inner join
    // would make a hand-built profile look like somebody else's.
    .leftJoin(
      schema.serviceTemplates,
      eq(schema.serviceTemplates.id, schema.alertProfiles.serviceTemplateId),
    )
    .where(and(eq(schema.alertProfiles.id, profileId), eq(schema.alertProfiles.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Rebuilds the review URL, carrying the return path when there is one. */
function reviewPath(profileId: string, returnPath: string | undefined): string {
  const query = new URLSearchParams({ profil: profileId });
  if (returnPath) query.set('retur', returnPath);
  return `${REVIEW_PATH}?${query.toString()}`;
}

function readReturnPath(formData: FormData): string | undefined {
  const raw = formData.get('retur');
  return safeDraftReturnPath(typeof raw === 'string' ? raw : undefined);
}

/**
 * Removes one CPV code or one keyword from the profile's *include* list.
 *
 * Only `include` rows are touched. The exclude lists are what the service
 * template uses to keep obviously wrong notices out ("vindusvask" out of a
 * general cleaning profile), the review screen does not render them, and an
 * action that quietly widened a profile while the reader was narrowing it would
 * be the opposite of what the button says.
 */
export async function removeProfileCriterionAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const idParsed = z.uuid().safeParse(formData.get('profileId'));
  const fieldParsed = criterionField.safeParse(formData.get('felt'));
  const rawValue = formData.get('verdi');
  if (!idParsed.success || !fieldParsed.success || typeof rawValue !== 'string') {
    redirect(withMessage('/varsler', 'ugyldig'));
  }

  const db = getWebDb();
  const owned = await ownedProfile(db, idParsed.data, user.id);
  if (!owned) redirect(withMessage('/varsler', 'ukjent-profil'));

  const returnPath = readReturnPath(formData);

  if (fieldParsed.data === 'cpv') {
    // Normalised the same way `profile-write.ts` normalises on the way in, so a
    // code stored as eight digits is still found when the form echoes back the
    // check-digit form. A code that does not normalise cannot be in the table
    // at all, so the delete is skipped rather than run with a value that would
    // match nothing.
    const code = normalizeCpv(rawValue);
    if (code) {
      await db
        .delete(schema.alertProfileCpvCodes)
        .where(
          and(
            eq(schema.alertProfileCpvCodes.alertProfileId, owned.id),
            eq(schema.alertProfileCpvCodes.mode, 'include'),
            eq(schema.alertProfileCpvCodes.cpvCode, code),
          ),
        );
    }
  } else {
    await db
      .delete(schema.alertProfileKeywords)
      .where(
        and(
          eq(schema.alertProfileKeywords.alertProfileId, owned.id),
          eq(schema.alertProfileKeywords.mode, 'include'),
          eq(schema.alertProfileKeywords.keyword, rawValue),
        ),
      );
  }

  revalidatePath('/varsler');
  revalidatePath(`/varsler/${owned.id}`);
  redirect(reviewPath(owned.id, returnPath));
}

/**
 * Switches the reviewed profile on, and records the two optional consents the
 * review screen offers.
 *
 * Three writes, and they are deliberately three different mechanisms, because
 * `settings-actions.ts` establishes that they are three different kinds of
 * fact:
 *
 * - `active` is profile state.
 * - the promotion switch is a *content setting* on the tender emails
 *   (spec section 22), stored in `notification_preferences`.
 * - marketing consent is an append-only *event* carrying the exact wording
 *   version (ADR-9, spec section 20.2). An unticked box writes nothing at all:
 *   a `withdrawn` row for a consent that was never granted would be a false
 *   entry in a log that can never be corrected.
 *
 * The terms acceptance is not among them. It was recorded inside
 * `confirmSignup`'s transaction before this page could render, so a checkbox
 * here would be either a second record of one acceptance or a control that
 * does nothing. The screen states the fact instead.
 */
export async function activateProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const idParsed = z.uuid().safeParse(formData.get('profileId'));
  if (!idParsed.success) redirect(withMessage('/varsler', 'ugyldig'));

  const db = getWebDb();
  const owned = await ownedProfile(db, idParsed.data, user.id);
  if (!owned) redirect(withMessage('/varsler', 'ukjent-profil'));

  const wantsMarketing = formData.get('markedsforing') === 'on';
  const wantsPromotions = formData.get('faglig-pafyll') === 'on';
  const returnPath = readReturnPath(formData);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(schema.alertProfiles)
      .set({ active: true, updatedAt: now })
      .where(eq(schema.alertProfiles.id, owned.id));

    await tx
      .insert(schema.notificationPreferences)
      .values({ userId: user.id, includeLumaPromotionsInTenderEmails: wantsPromotions })
      // Only this column is written. The other three carry launch defaults that
      // this screen never shows, and an upsert that set them would reset the
      // preferences of a returning user adding a second profile.
      .onConflictDoUpdate({
        target: schema.notificationPreferences.userId,
        set: { includeLumaPromotionsInTenderEmails: wantsPromotions, updatedAt: now },
      });

    if (wantsMarketing) {
      const version = marketingConsentTextVersion();
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
        status: 'granted',
        // `signup`, not `account_settings`: this box is ticked while finishing
        // registration, and the source column is what tells a later audit where
        // in the person's journey the consent was collected.
        source: 'signup',
        policyVersion: privacyPolicyVersion() ?? null,
        consentTextVersion: version,
        occurredAt: now,
      });
    }
  });

  // Outside the transaction, and only when the profile was not already on, for
  // the reason `toggleProfileActiveAction` records: the funnel measures the
  // step being taken, and a reload of an activated profile is not a second
  // activation.
  if (!owned.active) {
    await recordFunnelEvent({
      type: 'profile_activated',
      ...(owned.serviceTemplateSlug ? { serviceTemplateSlug: owned.serviceTemplateSlug } : {}),
    });
  }

  revalidatePath('/varsler');
  revalidatePath(`/varsler/${owned.id}`);
  revalidatePath('/oversikt');
  revalidatePath('/innstillinger');

  // The stored return path is honoured here rather than at confirmation time.
  // See the note in `(public)/registrering/bekreft/page.tsx`: the review step
  // preempts it, and this is the moment it was always meant to fire.
  redirect(returnPath ?? '/oversikt');
}
