import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import type { Database } from '@luma/db';
import {
  alertProfiles,
  notificationDeliveries,
  notificationDeliveryItems,
  notificationPreferences,
  tenderMatches,
  users,
} from '@luma/db';
import type { MatchConfidence } from '@luma/domain';
import type { Logger } from '@luma/observability';
import type { DigestCandidate } from './digest.js';

/**
 * Immediate alerts (spec §9.3).
 *
 * A high-relevance match can be sent the moment it is found rather than
 * waiting for the digest. Two things make this safe to run alongside the
 * digest, and both matter:
 *
 * **The bar is high.** Only `high` confidence qualifies. An immediate alert
 * interrupts someone's day, and a service that interrupts for a medium match
 * gets muted, at which point it stops delivering the high ones too.
 *
 * **It writes the same delivery rows the digest reads.** Spec §9.3 requires
 * deduplication to prevent a double send, and the mechanism is not a separate
 * check: an immediately-alerted tender is recorded as delivered, so the digest
 * query that excludes already-delivered tenders excludes it for free. A second
 * mechanism would be a second thing to get wrong.
 */

/** Only the top confidence band interrupts anyone. */
const IMMEDIATE_CONFIDENCE: MatchConfidence = 'high';

export interface ImmediateCandidate extends DigestCandidate {
  matchId: string;
  tenderId: string;
  score: number;
}

/**
 * Matches that qualify for an immediate alert and have not been delivered.
 *
 * Restricted to profiles whose owner has both tender alerts and immediate
 * alerts switched on. Marketing consent is deliberately not consulted: spec §3
 * keeps tender alerts independent of it.
 */
export async function findImmediateCandidates(
  db: Database,
  tenderIds?: readonly string[],
): Promise<ImmediateCandidate[]> {
  const alreadyDelivered = db
    .select({ tenderId: notificationDeliveryItems.tenderId })
    .from(notificationDeliveryItems)
    .innerJoin(
      notificationDeliveries,
      eq(notificationDeliveries.id, notificationDeliveryItems.deliveryId),
    )
    .where(eq(notificationDeliveries.alertProfileId, alertProfiles.id));

  const conditions = [
    eq(alertProfiles.active, true),
    isNull(alertProfiles.deletedAt),
    eq(tenderMatches.included, true),
    eq(tenderMatches.confidence, IMMEDIATE_CONFIDENCE),
    notInArray(tenderMatches.tenderId, alreadyDelivered),
  ];

  if (tenderIds && tenderIds.length > 0) {
    conditions.push(sql`${tenderMatches.tenderId} = any(${sql.param(tenderIds)}::uuid[])`);
  }

  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      alertProfileId: alertProfiles.id,
      profileName: alertProfiles.name,
      frequency: alertProfiles.frequency,
      timezone: alertProfiles.timezone,
      digestHourLocal: alertProfiles.digestHourLocal,
      tenderAlertsEnabled: notificationPreferences.tenderAlertsEnabled,
      immediateAlertsEnabled: notificationPreferences.immediateAlertsEnabled,
      includePromotions: notificationPreferences.includeLumaPromotionsInTenderEmails,
      matchId: tenderMatches.id,
      tenderId: tenderMatches.tenderId,
      score: tenderMatches.score,
    })
    .from(tenderMatches)
    .innerJoin(alertProfiles, eq(alertProfiles.id, tenderMatches.alertProfileId))
    .innerJoin(users, eq(users.id, alertProfiles.userId))
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
    .where(and(...conditions));

  return rows
    .filter(
      (row) =>
        (row.tenderAlertsEnabled ?? true) &&
        // Off by default (spec §22). A user opts in to being interrupted.
        (row.immediateAlertsEnabled ?? false),
    )
    .map((row) => ({
      userId: row.userId,
      email: row.email,
      alertProfileId: row.alertProfileId,
      profileName: row.profileName,
      frequency: row.frequency,
      timezone: row.timezone,
      digestHourLocal: row.digestHourLocal,
      includePromotions: row.includePromotions ?? true,
      matchId: row.matchId,
      tenderId: row.tenderId,
      score: row.score,
    }));
}

/**
 * A stable key for one immediate alert.
 *
 * Keyed on the profile and the tender rather than on time: an immediate alert
 * about a given tender is sent exactly once to a given profile, ever. Two
 * workers processing the same match both insert and one loses.
 */
export function immediateIdempotencyKey(alertProfileId: string, tenderId: string): string {
  return `immediate:${alertProfileId}:${tenderId}`;
}

export type ClaimResult =
  { readonly created: true; readonly deliveryId: string } | { readonly created: false };

export async function claimImmediateAlert(
  db: Database,
  candidate: ImmediateCandidate,
  now: Date,
): Promise<ClaimResult> {
  const inserted = await db
    .insert(notificationDeliveries)
    .values({
      userId: candidate.userId,
      alertProfileId: candidate.alertProfileId,
      kind: 'immediate',
      status: 'pending',
      messageStream: 'tender_notifications',
      templateAlias: 'tender-immediate-v1',
      scheduledFor: now,
      itemCount: 1,
      idempotencyKey: immediateIdempotencyKey(candidate.alertProfileId, candidate.tenderId),
    })
    .onConflictDoNothing({ target: notificationDeliveries.idempotencyKey })
    .returning({ id: notificationDeliveries.id });

  const deliveryId = inserted[0]?.id;
  if (!deliveryId) return { created: false };

  // Written in the same call so the digest's already-delivered query sees this
  // tender the moment the claim exists, not only once the email has been sent.
  await db.insert(notificationDeliveryItems).values({
    deliveryId,
    tenderId: candidate.tenderId,
    tenderMatchId: candidate.matchId,
    section: 'immediate',
    sortOrder: 0,
  });

  return { created: true, deliveryId };
}

export interface ImmediateReport {
  considered: number;
  claimed: number;
  skippedAlreadyClaimed: number;
}

/**
 * Claims every immediate alert that is due.
 *
 * Sending is left to the caller for the same reason as the digest: a claim
 * that precedes the send loses one alert on a crash rather than sending two,
 * and the tender then simply appears in the next digest.
 */
export async function runImmediateAlerts(options: {
  db: Database;
  logger: Logger;
  now: Date;
  tenderIds?: readonly string[];
}): Promise<
  ImmediateReport & { claims: Array<{ candidate: ImmediateCandidate; deliveryId: string }> }
> {
  const { db, logger, now } = options;

  const candidates = await findImmediateCandidates(db, options.tenderIds);
  const claims: Array<{ candidate: ImmediateCandidate; deliveryId: string }> = [];
  let skippedAlreadyClaimed = 0;

  for (const candidate of candidates) {
    const claim = await claimImmediateAlert(db, candidate, now);
    if (claim.created) {
      claims.push({ candidate, deliveryId: claim.deliveryId });
    } else {
      skippedAlreadyClaimed += 1;
    }
  }

  logger.info(
    { considered: candidates.length, claimed: claims.length, skippedAlreadyClaimed },
    'immediate alert pass complete',
  );

  return {
    considered: candidates.length,
    claimed: claims.length,
    skippedAlreadyClaimed,
    claims,
  };
}
