import { and, desc, eq } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import type { Database } from './db';
import type { NotificationPreferences } from '@luma/domain';

/**
 * Notification preferences and consent state (spec sections 21 and 22).
 *
 * `marketingEmailConsent` is **derived**, never stored as a column. ADR-9 is
 * explicit that a boolean cannot demonstrate what wording a person agreed to
 * and cannot survive being overwritten, so the current answer is the latest
 * `consent_events` row of that type. The settings screen shows one checkbox;
 * behind it are two different storage mechanisms, and conflating them is the
 * bug this function exists to prevent.
 */

export interface AccountSettings {
  readonly preferences: NotificationPreferences;
  /** The exact wording version the user last agreed to, when they have. */
  readonly marketingConsentTextVersion: string | null;
  readonly marketingConsentChangedAt: Date | null;
}

export async function getAccountSettings(db: Database, userId: string): Promise<AccountSettings> {
  const [prefsRow] = await db
    .select({
      tenderAlertsEnabled: schema.notificationPreferences.tenderAlertsEnabled,
      immediateAlertsEnabled: schema.notificationPreferences.immediateAlertsEnabled,
      digestEnabled: schema.notificationPreferences.digestEnabled,
      includeLumaPromotionsInTenderEmails:
        schema.notificationPreferences.includeLumaPromotionsInTenderEmails,
    })
    .from(schema.notificationPreferences)
    .where(eq(schema.notificationPreferences.userId, userId))
    .limit(1);

  const [consentRow] = await db
    .select({
      status: schema.consentEvents.status,
      consentTextVersion: schema.consentEvents.consentTextVersion,
      occurredAt: schema.consentEvents.occurredAt,
    })
    .from(schema.consentEvents)
    .where(
      and(
        eq(schema.consentEvents.userId, userId),
        eq(schema.consentEvents.consentType, 'marketing_email'),
      ),
    )
    // Ordered by when the person consented, not by insertion, because an
    // administrator may record a historical consent after the fact (spec 21).
    .orderBy(desc(schema.consentEvents.occurredAt), desc(schema.consentEvents.createdAt))
    .limit(1);

  const granted = consentRow?.status === 'granted' || consentRow?.status === 'accepted';

  return {
    preferences: {
      // Spec section 22's recommended defaults, applied when the user has no
      // row yet. Promotion on, marketing consent off.
      tenderAlertsEnabled: prefsRow?.tenderAlertsEnabled ?? true,
      immediateAlertsEnabled: prefsRow?.immediateAlertsEnabled ?? false,
      digestEnabled: prefsRow?.digestEnabled ?? true,
      includeLumaPromotionsInTenderEmails: prefsRow?.includeLumaPromotionsInTenderEmails ?? true,
      marketingEmailConsent: granted,
    },
    marketingConsentTextVersion: consentRow?.consentTextVersion ?? null,
    marketingConsentChangedAt: consentRow?.occurredAt ?? null,
  };
}

/**
 * Whether Luma promotion may be rendered for this user (spec section 23.4).
 *
 * Every surface that renders a `Promotion` block asks this first. A user who
 * turned promotion off must see none of it — and must still get exactly the
 * same tenders, which is why this reads a content preference and never touches
 * anything the matcher can see.
 */
export async function promotionAllowed(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({
      allowed: schema.notificationPreferences.includeLumaPromotionsInTenderEmails,
    })
    .from(schema.notificationPreferences)
    .where(eq(schema.notificationPreferences.userId, userId))
    .limit(1);
  return row?.allowed ?? true;
}

/**
 * Region codes across the user's profiles, for editorial regional routing
 * (spec section 23.2). Based on stated profile geography, never on IP.
 */
export async function userRegionCodes(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ code: schema.alertProfileGeographies.code })
    .from(schema.alertProfileGeographies)
    .innerJoin(
      schema.alertProfiles,
      eq(schema.alertProfiles.id, schema.alertProfileGeographies.alertProfileId),
    )
    .where(
      and(
        eq(schema.alertProfiles.userId, userId),
        eq(schema.alertProfileGeographies.kind, 'region'),
      ),
    );
  return rows.map((row) => row.code);
}
