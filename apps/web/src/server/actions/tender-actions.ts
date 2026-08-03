'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { feedbackVerdictSchema } from '@luma/domain';
import { MATCHING_VERSION } from '@luma/matching';
import { z } from 'zod';
import { getWebDb, shareTtlDays } from '../db';
import { requireUser } from '../session';
import { findActiveShare } from '../shares';
import { withMessage } from './messages';

/**
 * Mutations on a tender: save, dismiss, feedback and sharing.
 *
 * Spec section 36 puts the web app on Vercel and the API on Railway, so these
 * run as server actions rather than as fetches to the Fastify API — one hop
 * instead of two, and one place where the authorisation rule lives.
 *
 * Every action re-resolves the session itself. A server action is a public HTTP
 * endpoint; that the button which submits it sits under a layout that checked
 * the session proves nothing about who is calling it.
 *
 * Each action finishes with `redirect(withMessage(...))` rather than returning a
 * value, so the forms work with JavaScript disabled and the confirmation lands
 * in a live region on the next render.
 */

const uuid = z.uuid();

/** Saves a tender for later (spec section 16). */
export async function saveTenderAction(formData: FormData): Promise<void> {
  await setTenderState(formData, 'saved');
}

/** Dismisses a tender so it stops appearing in the list. */
export async function dismissTenderAction(formData: FormData): Promise<void> {
  await setTenderState(formData, 'dismissed');
}

/** Undoes a save or a dismissal. */
export async function resetTenderStateAction(formData: FormData): Promise<void> {
  await setTenderState(formData, 'opened');
}

async function setTenderState(
  formData: FormData,
  state: 'saved' | 'dismissed' | 'opened',
): Promise<never> {
  const user = await requireUser();
  const returnTo = readReturnTo(formData);
  const parsed = uuid.safeParse(formData.get('tenderId'));
  if (!parsed.success) redirect(withMessage(returnTo, 'ugyldig'));

  const db = getWebDb();
  const now = new Date();

  const [tender] = await db
    .select({ id: schema.tenders.id })
    .from(schema.tenders)
    .where(and(eq(schema.tenders.id, parsed.data), isNull(schema.tenders.suppressedAt)))
    .limit(1);
  if (!tender) redirect(withMessage(returnTo, 'ukjent-anbud'));

  await db
    .insert(schema.userTenderStates)
    .values({
      userId: user.id,
      tenderId: parsed.data,
      state,
      openedAt: now,
      ...(state === 'saved' ? { savedAt: now } : {}),
      ...(state === 'dismissed' ? { dismissedAt: now } : {}),
    })
    .onConflictDoUpdate({
      target: [schema.userTenderStates.userId, schema.userTenderStates.tenderId],
      set: {
        state,
        updatedAt: now,
        // Clearing the opposite timestamp matters: a tender that was dismissed
        // and is then saved must not still read as dismissed in the history.
        savedAt: state === 'saved' ? now : null,
        dismissedAt: state === 'dismissed' ? now : null,
      },
    });

  revalidatePath('/oversikt');
  revalidatePath('/planlagte');
  revalidatePath('/lagret');
  revalidatePath(`/anbud/${parsed.data}`);

  redirect(
    withMessage(
      returnTo,
      state === 'saved' ? 'lagret' : state === 'dismissed' ? 'avvist' : 'tilbakestilt',
    ),
  );
}

/**
 * Relevance feedback (spec section 15).
 *
 * Feedback is stored and used for quality measurement. It never edits the
 * profile: section 15 requires a suggestion to be shown and approved, and an
 * action that quietly rewrote criteria would be the automatic profile change
 * that section forbids.
 */
export async function submitFeedbackAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const returnTo = readReturnTo(formData);

  const rawProfile = formData.get('alertProfileId');
  const rawComment = formData.get('comment');
  const parsed = z
    .object({
      tenderId: uuid,
      verdict: feedbackVerdictSchema,
      alertProfileId: uuid.optional(),
      comment: z.string().trim().max(2000).optional(),
    })
    .safeParse({
      tenderId: formData.get('tenderId'),
      verdict: formData.get('verdict'),
      ...(typeof rawProfile === 'string' && rawProfile.length > 0
        ? { alertProfileId: rawProfile }
        : {}),
      ...(typeof rawComment === 'string' && rawComment.trim().length > 0
        ? { comment: rawComment }
        : {}),
    });
  if (!parsed.success) redirect(withMessage(returnTo, 'ugyldig'));

  const db = getWebDb();

  // The profile id arrives from a form field, so it is checked against the
  // caller's own profiles before it is stored.
  let alertProfileId: string | null = null;
  if (parsed.data.alertProfileId) {
    const [owned] = await db
      .select({ id: schema.alertProfiles.id })
      .from(schema.alertProfiles)
      .where(
        and(
          eq(schema.alertProfiles.id, parsed.data.alertProfileId),
          eq(schema.alertProfiles.userId, user.id),
        ),
      )
      .limit(1);
    alertProfileId = owned?.id ?? null;
  }

  await db
    .insert(schema.relevanceFeedback)
    .values({
      userId: user.id,
      tenderId: parsed.data.tenderId,
      alertProfileId,
      verdict: parsed.data.verdict,
      comment: parsed.data.comment ?? null,
      matchingVersion: MATCHING_VERSION,
    })
    .onConflictDoUpdate({
      target: [
        schema.relevanceFeedback.userId,
        schema.relevanceFeedback.tenderId,
        schema.relevanceFeedback.alertProfileId,
        schema.relevanceFeedback.matchingVersion,
      ],
      set: { verdict: parsed.data.verdict, comment: parsed.data.comment ?? null },
    });

  revalidatePath(`/anbud/${parsed.data.tenderId}`);
  redirect(withMessage(returnTo, 'feedback'));
}

/**
 * Creates a share link (spec section 17).
 *
 * The token is 32 random bytes from the system CSPRNG, base64url-encoded. Spec
 * section 40 forbids deriving it from the user id or the tender id: a derived
 * token would be guessable from data the recipient already holds, and the
 * shared view is exactly the surface someone would enumerate.
 *
 * An existing, unexpired link for the same tender is reused, so pressing the
 * button twice does not scatter live tokens the user then has to revoke one by
 * one.
 */
export async function createShareAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const returnTo = readReturnTo(formData);
  const parsed = uuid.safeParse(formData.get('tenderId'));
  if (!parsed.success) redirect(withMessage(returnTo, 'ugyldig'));

  const db = getWebDb();
  const now = new Date();

  const [tender] = await db
    .select({ id: schema.tenders.id })
    .from(schema.tenders)
    .where(and(eq(schema.tenders.id, parsed.data), isNull(schema.tenders.suppressedAt)))
    .limit(1);
  if (!tender) redirect(withMessage(returnTo, 'ukjent-anbud'));

  const existing = await findActiveShare(db, { tenderId: parsed.data, userId: user.id, now });
  if (existing) {
    revalidatePath('/delinger');
    revalidatePath(`/anbud/${parsed.data}`);
    redirect(withMessage(returnTo, 'deling-finnes'));
  }

  await db.insert(schema.tenderShares).values({
    tenderId: parsed.data,
    createdByUserId: user.id,
    token: randomBytes(32).toString('base64url'),
    expiresAt: new Date(now.getTime() + shareTtlDays() * 86_400_000),
  });

  revalidatePath('/delinger');
  revalidatePath(`/anbud/${parsed.data}`);
  redirect(withMessage(returnTo, 'deling-opprettet'));
}

/** Revokes a share link. Immediate: the public page reads `revoked_at` live. */
export async function revokeShareAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = uuid.safeParse(formData.get('shareId'));
  if (!parsed.success) redirect(withMessage('/delinger', 'ugyldig'));

  const db = getWebDb();
  const revoked = await db
    .update(schema.tenderShares)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.tenderShares.id, parsed.data),
        // Scoped to the owner: a share id is not a secret.
        eq(schema.tenderShares.createdByUserId, user.id),
        isNull(schema.tenderShares.revokedAt),
      ),
    )
    .returning({ id: schema.tenderShares.id });

  revalidatePath('/delinger');
  redirect(withMessage('/delinger', revoked.length === 0 ? 'deling-mangler' : 'deling-opphevet'));
}

/**
 * Where to send the browser after the action.
 *
 * Read from a hidden field so the same button works from the dashboard, the
 * saved list and the detail page. Only a known in-app path is accepted; an
 * unrecognised value falls back to the dashboard rather than being followed,
 * because a redirect target from a form field is attacker-controlled.
 */
function readReturnTo(formData: FormData): string {
  const raw = formData.get('returnTo');
  if (typeof raw !== 'string') return '/oversikt';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/oversikt';
  // Strip any query the caller attached, so a stale `melding` cannot survive.
  const [path] = raw.split('?');
  return path && path.length > 0 ? path : '/oversikt';
}
