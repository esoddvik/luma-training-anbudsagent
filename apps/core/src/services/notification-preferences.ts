import { eq } from 'drizzle-orm';
import { notificationPreferences } from '@luma/db';
import { PROMOTION_SETTING_TEXT_NB, type NotificationPreferences } from '@luma/domain';
import { z } from 'zod';
import { parseOrThrow } from '../routes/errors.js';
import { hasMarketingConsent, recordConsent } from './consent.js';
import type { Actor, ApiContext } from './context.js';

/**
 * Notification preferences (spec §22).
 *
 * The type in §22 has five fields but they live in two places, and that split
 * is the point. Four are service settings on `notification_preferences`. The
 * fifth, `marketingEmailConsent`, is not a setting at all: it is the derived
 * state of an append-only consent log (ADR-0009), so reading it is a query
 * over `consent_events` and writing it appends an event.
 *
 * Collapsing them into one row would make the two switches share storage, and
 * the rule spec §21 is most insistent about — that turning one off must not
 * turn the other off — would then depend on remembering to write conditional
 * code rather than on the data model.
 */

export const updatePreferencesSchema = z
  .object({
    tenderAlertsEnabled: z.boolean(),
    immediateAlertsEnabled: z.boolean(),
    digestEnabled: z.boolean(),
    includeLumaPromotionsInTenderEmails: z.boolean(),
    marketingEmailConsent: z.boolean(),
  })
  .partial();

export interface PreferencesView extends NotificationPreferences {
  /** Spec §22 requires this sentence next to the promotion switch. */
  readonly promotionSettingText: string;
}

async function readRow(ctx: ApiContext, userId: string) {
  const rows = await ctx.db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);

  const row = rows[0];
  if (row) return row;

  // A user who has never opened the settings page still has preferences; the
  // digest job reads them. Creating the row on first read keeps the defaults
  // in one place — the schema — rather than duplicated as literals here.
  const created = await ctx.db
    .insert(notificationPreferences)
    .values({ userId })
    .onConflictDoNothing({ target: notificationPreferences.userId })
    .returning();
  const inserted = created[0];
  if (inserted) return inserted;

  const reread = await ctx.db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  const found = reread[0];
  if (!found) throw new Error('notification preferences row could not be created');
  return found;
}

export async function getPreferences(ctx: ApiContext, actor: Actor): Promise<PreferencesView> {
  const row = await readRow(ctx, actor.userId);
  return {
    tenderAlertsEnabled: row.tenderAlertsEnabled,
    immediateAlertsEnabled: row.immediateAlertsEnabled,
    digestEnabled: row.digestEnabled,
    includeLumaPromotionsInTenderEmails: row.includeLumaPromotionsInTenderEmails,
    marketingEmailConsent: await hasMarketingConsent(ctx, actor.userId),
    promotionSettingText: PROMOTION_SETTING_TEXT_NB,
  };
}

export interface UpdatePreferencesInput {
  readonly body: unknown;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

/**
 * Updates preferences, and separately records a consent event if the marketing
 * flag was included.
 *
 * The two writes are deliberately not one transaction over one row. Turning
 * `tenderAlertsEnabled` off writes nothing to `consent_events`, and toggling
 * `marketingEmailConsent` writes nothing to `notification_preferences`.
 */
export async function updatePreferences(
  ctx: ApiContext,
  actor: Actor,
  input: UpdatePreferencesInput,
): Promise<PreferencesView> {
  const patch = parseOrThrow(updatePreferencesSchema, input.body);
  const { marketingEmailConsent, ...settings } = patch;

  if (Object.keys(settings).length > 0) {
    await readRow(ctx, actor.userId);
    await ctx.db
      .update(notificationPreferences)
      .set({ ...settings, updatedAt: ctx.now() })
      .where(eq(notificationPreferences.userId, actor.userId));
  }

  if (marketingEmailConsent !== undefined) {
    const current = await hasMarketingConsent(ctx, actor.userId);
    // Only a genuine change is recorded. Re-saving the settings form without
    // touching the box must not append a redundant event and reset the date
    // Luma would later have to defend.
    if (current !== marketingEmailConsent) {
      await recordConsent(ctx, actor, {
        body: {
          consentType: 'marketing_email',
          status: marketingEmailConsent ? 'granted' : 'withdrawn',
          source: 'account_settings',
          consentTextVersion: ctx.config.currentMarketingConsentTextVersion,
        },
        ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
        ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      });
    }
  }

  return getPreferences(ctx, actor);
}
