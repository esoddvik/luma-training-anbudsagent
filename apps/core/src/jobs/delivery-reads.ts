import { eq } from 'drizzle-orm';
import type { Database } from '@luma/db';
import {
  alertProfileGeographies,
  alertProfiles,
  notificationDeliveries,
  notificationDeliveryItems,
  notificationPreferences,
  tenderMatches,
  users,
} from '@luma/db';
import type { DigestCandidate } from './digest.js';
import type { ImmediateCandidate } from './immediate.js';

/**
 * Rebuilding a claim from a delivery id.
 *
 * The preparer jobs (`runDigestScheduler`, `runImmediateAlerts`) claim a
 * delivery row and hand back the candidate they built. The sending job runs in
 * a *different* process invocation, so it has to get that candidate from
 * somewhere — and the choice of where matters more than it looks.
 *
 * The obvious option is to put the candidate in the queue payload. It is
 * rejected here for two reasons. A candidate carries an email address, and
 * spec §40 requires data minimisation: an address in `pgboss.job` is a copy of
 * personal data in a table with its own retention, outside every deletion path
 * the schema defines. And a payload is a snapshot — a user who switches off
 * promotion between the claim and the send would still get the promotion,
 * because the payload remembers the old answer.
 *
 * So the payload carries the delivery id and nothing else, and this module
 * reads the current state behind it.
 */

type DeliveryRow = typeof notificationDeliveries.$inferSelect;
export type DeliveryKind = DeliveryRow['kind'];
export type DeliveryStatus = DeliveryRow['status'];

export interface ClaimedDelivery {
  readonly deliveryId: string;
  readonly kind: DeliveryKind;
  readonly status: DeliveryStatus;
  readonly candidate: DigestCandidate;
}

/**
 * The delivery, plus the candidate the renderer needs.
 *
 * Returns `null` when the delivery is gone or its profile has been deleted:
 * both are ordinary outcomes of a user deleting something between the claim
 * and the send, and neither should fail a job.
 */
export async function loadClaimedDelivery(
  db: Database,
  deliveryId: string,
): Promise<ClaimedDelivery | null> {
  const rows = await db
    .select({
      deliveryId: notificationDeliveries.id,
      kind: notificationDeliveries.kind,
      status: notificationDeliveries.status,
      userId: users.id,
      email: users.email,
      alertProfileId: alertProfiles.id,
      profileName: alertProfiles.name,
      frequency: alertProfiles.frequency,
      timezone: alertProfiles.timezone,
      digestHourLocal: alertProfiles.digestHourLocal,
      includePromotions: notificationPreferences.includeLumaPromotionsInTenderEmails,
    })
    .from(notificationDeliveries)
    .innerJoin(users, eq(users.id, notificationDeliveries.userId))
    .innerJoin(alertProfiles, eq(alertProfiles.id, notificationDeliveries.alertProfileId))
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
    .where(eq(notificationDeliveries.id, deliveryId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    deliveryId: row.deliveryId,
    kind: row.kind,
    status: row.status,
    candidate: {
      userId: row.userId,
      email: row.email,
      alertProfileId: row.alertProfileId,
      profileName: row.profileName,
      frequency: row.frequency,
      timezone: row.timezone,
      digestHourLocal: row.digestHourLocal,
      // Defaults to on, per spec §22, when the user has no preferences row.
      includePromotions: row.includePromotions ?? true,
    },
  };
}

/**
 * The single item behind an immediate alert, widened into an
 * `ImmediateCandidate`.
 *
 * An immediate delivery has exactly one item by construction
 * (`claimImmediateAlert` writes one). A delivery with no usable item is a
 * claim whose item write did not land, which is a real fault and is reported
 * as `null` rather than sent as an empty email.
 */
export async function loadImmediateCandidate(
  db: Database,
  claim: ClaimedDelivery,
): Promise<ImmediateCandidate | null> {
  const rows = await db
    .select({
      tenderId: notificationDeliveryItems.tenderId,
      matchId: notificationDeliveryItems.tenderMatchId,
      score: tenderMatches.score,
    })
    .from(notificationDeliveryItems)
    .leftJoin(tenderMatches, eq(tenderMatches.id, notificationDeliveryItems.tenderMatchId))
    .where(eq(notificationDeliveryItems.deliveryId, claim.deliveryId))
    .orderBy(notificationDeliveryItems.sortOrder)
    .limit(1);

  const row = rows[0];
  if (!row || !row.matchId || row.score === null) return null;

  return {
    ...claim.candidate,
    matchId: row.matchId,
    tenderId: row.tenderId,
    score: row.score,
  };
}

/** When the account was created, for the promotion ladder (spec §23.1). */
export async function accountCreatedAt(db: Database, userId: string): Promise<Date | null> {
  const rows = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.createdAt ?? null;
}

/**
 * Region codes stated on one alert profile, for editorial routing (§23.2).
 *
 * Deliberately identical in behaviour to the private helper of the same name
 * in `digest-send.ts`: the immediate alert must route promotion by exactly the
 * rule the digest routes it by, or the same user gets a different offer
 * depending on which email arrived first.
 */
export async function profileRegionCodes(db: Database, alertProfileId: string): Promise<string[]> {
  const rows = await db
    .select({ code: alertProfileGeographies.code })
    .from(alertProfileGeographies)
    .where(eq(alertProfileGeographies.alertProfileId, alertProfileId));
  return rows.map((row) => row.code);
}
