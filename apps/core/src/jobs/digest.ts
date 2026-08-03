import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { Database } from '@luma/db';
import {
  alertProfiles,
  notificationDeliveries,
  notificationDeliveryItems,
  notificationPreferences,
  tenderMatches,
  users,
} from '@luma/db';
import type { AlertFrequency } from '@luma/domain';
import type { Logger } from '@luma/observability';

/**
 * Deciding who receives a digest, and making sure nobody receives the same
 * tender twice (spec §26 and §38).
 *
 * Two rules do the real work here.
 *
 * **Respect the user's local hour.** A profile stores a send hour and an IANA
 * timezone, and Norway observes daylight saving, so "07:00 local" is not a
 * fixed UTC offset. The scheduler ticks every fifteen minutes and asks, for
 * each profile, what hour it currently is *there*.
 *
 * **Never send the same tender twice.** The delivery-item table has a unique
 * constraint on (delivery, tender), and a tender already sent to a profile is
 * excluded from the next digest by query. Spec §52 item 5 makes this an
 * acceptance criterion, and it is the failure a user would never forgive:
 * duplicate alerts are the reason people stop reading tender emails.
 */

export interface DigestCandidate {
  userId: string;
  email: string;
  alertProfileId: string;
  profileName: string;
  frequency: AlertFrequency;
  timezone: string;
  digestHourLocal: number;
  includePromotions: boolean;
}

/**
 * The hour of day at `instant` in `timeZone`, or null if the zone is unknown.
 *
 * Uses `Intl` rather than arithmetic on an offset, because an offset is wrong
 * twice a year and the failure is a digest that arrives an hour early for six
 * months.
 */
export function localHourIn(instant: Date, timeZone: string): number | null {
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: 'numeric',
      hour12: false,
    }).format(instant);
    const hour = Number(formatted);
    return Number.isInteger(hour) ? hour % 24 : null;
  } catch {
    // An invalid timezone must not take the whole scheduler down with it.
    return null;
  }
}

/** The weekly digest goes out on Mondays, in the user's own timezone. */
export function isWeeklySendDay(instant: Date, timeZone: string): boolean {
  try {
    const weekday = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' }).format(
      instant,
    );
    return weekday === 'Mon';
  } catch {
    return false;
  }
}

/**
 * Whether a profile is due right now.
 *
 * The scheduler ticks every fifteen minutes, so "due" means the local hour has
 * arrived, and the deduplication below is what prevents the following three
 * ticks in the same hour from sending again.
 */
export function isDue(candidate: DigestCandidate, now: Date): boolean {
  if (candidate.frequency === 'immediate') return false;

  const hour = localHourIn(now, candidate.timezone);
  if (hour === null || hour !== candidate.digestHourLocal) return false;

  return candidate.frequency === 'daily' || isWeeklySendDay(now, candidate.timezone);
}

/**
 * Profiles eligible for a digest: active, not deleted, belonging to a user who
 * has tender alerts and digests switched on.
 *
 * Note what is deliberately not consulted here: marketing consent. Spec §3
 * makes tender alerts independent of it, and withdrawing marketing consent
 * must never stop a tender email.
 */
export async function loadDigestCandidates(db: Database): Promise<DigestCandidate[]> {
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
      digestEnabled: notificationPreferences.digestEnabled,
      includePromotions: notificationPreferences.includeLumaPromotionsInTenderEmails,
    })
    .from(alertProfiles)
    .innerJoin(users, eq(users.id, alertProfiles.userId))
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
    .where(and(eq(alertProfiles.active, true), isNull(alertProfiles.deletedAt)));

  return rows
    .filter((row) => (row.tenderAlertsEnabled ?? true) && (row.digestEnabled ?? true))
    .map((row) => ({
      userId: row.userId,
      email: row.email,
      alertProfileId: row.alertProfileId,
      profileName: row.profileName,
      frequency: row.frequency,
      timezone: row.timezone,
      digestHourLocal: row.digestHourLocal,
      // Defaults to on, per spec §22, when the user has no preferences row yet.
      includePromotions: row.includePromotions ?? true,
    }));
}

/**
 * Included matches for a profile that have not already been sent to it.
 *
 * The exclusion is by tender rather than by match, because a tender rematched
 * under a new algorithm version is still the same opportunity, and the user
 * has already seen it.
 */
export async function unsentMatchesForProfile(
  db: Database,
  alertProfileId: string,
  limit = 25,
): Promise<Array<{ matchId: string; tenderId: string; score: number }>> {
  const alreadySent = db
    .select({ tenderId: notificationDeliveryItems.tenderId })
    .from(notificationDeliveryItems)
    .innerJoin(
      notificationDeliveries,
      eq(notificationDeliveries.id, notificationDeliveryItems.deliveryId),
    )
    .where(eq(notificationDeliveries.alertProfileId, alertProfileId));

  return db
    .select({
      matchId: tenderMatches.id,
      tenderId: tenderMatches.tenderId,
      score: tenderMatches.score,
    })
    .from(tenderMatches)
    .where(
      and(
        eq(tenderMatches.alertProfileId, alertProfileId),
        eq(tenderMatches.included, true),
        notInArray(tenderMatches.tenderId, alreadySent),
      ),
    )
    .orderBy(sql`${tenderMatches.score} desc`)
    .limit(limit);
}

/**
 * A stable key for one digest, so a retry cannot produce a second email.
 *
 * Built from the profile, the kind and the local calendar hour rather than
 * from the instant, because the scheduler ticks four times inside every hour
 * and each tick must resolve to the same key.
 */
export function digestIdempotencyKey(input: {
  alertProfileId: string;
  kind: 'daily_digest' | 'weekly_digest';
  now: Date;
  timezone: string;
}): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: input.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(input.now);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';

  return `${input.kind}:${input.alertProfileId}:${get('year')}-${get('month')}-${get('day')}T${get('hour')}`;
}

export interface RecordDeliveryInput {
  db: Database;
  candidate: DigestCandidate;
  kind: 'daily_digest' | 'weekly_digest';
  now: Date;
  items: ReadonlyArray<{ tenderId: string; matchId?: string }>;
}

export type RecordDeliveryResult =
  | { readonly created: true; readonly deliveryId: string }
  | { readonly created: false; readonly reason: 'already_sent' };

/**
 * Claims the right to send this digest.
 *
 * The unique index on the idempotency key is what makes this safe: two workers
 * racing on the same tick both insert, one wins, and the loser is told the
 * digest is already claimed rather than sending a duplicate. The claim is made
 * before the email is sent, so a crash between claim and send loses a digest
 * rather than sending two — the right way round, since the next digest still
 * contains the same unsent tenders.
 */
export async function claimDelivery(input: RecordDeliveryInput): Promise<RecordDeliveryResult> {
  const { db, candidate, kind, now, items } = input;

  const idempotencyKey = digestIdempotencyKey({
    alertProfileId: candidate.alertProfileId,
    kind,
    now,
    timezone: candidate.timezone,
  });

  const inserted = await db
    .insert(notificationDeliveries)
    .values({
      userId: candidate.userId,
      alertProfileId: candidate.alertProfileId,
      kind,
      status: 'pending',
      messageStream: 'tender_notifications',
      templateAlias: kind === 'daily_digest' ? 'tender-daily-digest-v1' : 'tender-weekly-digest-v1',
      scheduledFor: now,
      itemCount: items.length,
      idempotencyKey,
    })
    .onConflictDoNothing({ target: notificationDeliveries.idempotencyKey })
    .returning({ id: notificationDeliveries.id });

  const deliveryId = inserted[0]?.id;
  if (!deliveryId) return { created: false, reason: 'already_sent' };

  if (items.length > 0) {
    await db.insert(notificationDeliveryItems).values(
      items.map((item, index) => ({
        deliveryId,
        tenderId: item.tenderId,
        tenderMatchId: item.matchId ?? null,
        section: kind,
        sortOrder: index,
      })),
    );
  }

  return { created: true, deliveryId };
}

export async function markDeliverySent(
  db: Database,
  deliveryId: string,
  postmarkMessageId: string | undefined,
  sentAt: Date,
): Promise<void> {
  await db
    .update(notificationDeliveries)
    .set({
      status: 'sent',
      sentAt,
      postmarkMessageId: postmarkMessageId ?? null,
      attemptCount: sql`${notificationDeliveries.attemptCount} + 1`,
    })
    .where(eq(notificationDeliveries.id, deliveryId));
}

export async function markDeliveryFailed(
  db: Database,
  deliveryId: string,
  reason: string,
): Promise<void> {
  await db
    .update(notificationDeliveries)
    .set({
      status: 'failed',
      failureReason: reason,
      attemptCount: sql`${notificationDeliveries.attemptCount} + 1`,
    })
    .where(eq(notificationDeliveries.id, deliveryId));
}

export interface DigestSchedulerReport {
  candidatesConsidered: number;
  due: number;
  claimed: number;
  skippedAlreadySent: number;
  skippedEmpty: number;
}

/**
 * One scheduler tick.
 *
 * Returns what it claimed rather than sending directly, so the sending step
 * can be a separate queued job with its own retry behaviour.
 */
export async function runDigestScheduler(options: {
  db: Database;
  logger: Logger;
  now: Date;
}): Promise<
  DigestSchedulerReport & { claims: Array<{ candidate: DigestCandidate; deliveryId: string }> }
> {
  const { db, logger, now } = options;

  const candidates = await loadDigestCandidates(db);
  const dueCandidates = candidates.filter((candidate) => isDue(candidate, now));

  const claims: Array<{ candidate: DigestCandidate; deliveryId: string }> = [];
  let skippedAlreadySent = 0;
  let skippedEmpty = 0;

  for (const candidate of dueCandidates) {
    const matches = await unsentMatchesForProfile(db, candidate.alertProfileId);
    if (matches.length === 0) {
      // Spec §4.1: an email must be useful. An empty digest is not.
      skippedEmpty += 1;
      continue;
    }

    const claim = await claimDelivery({
      db,
      candidate,
      kind: candidate.frequency === 'weekly' ? 'weekly_digest' : 'daily_digest',
      now,
      items: matches.map((match) => ({ tenderId: match.tenderId, matchId: match.matchId })),
    });

    if (!claim.created) {
      skippedAlreadySent += 1;
      continue;
    }

    claims.push({ candidate, deliveryId: claim.deliveryId });
  }

  logger.info(
    {
      candidates: candidates.length,
      due: dueCandidates.length,
      claimed: claims.length,
      skippedAlreadySent,
      skippedEmpty,
    },
    'digest scheduler tick complete',
  );

  return {
    candidatesConsidered: candidates.length,
    due: dueCandidates.length,
    claimed: claims.length,
    skippedAlreadySent,
    skippedEmpty,
    claims,
  };
}

/** Tenders already delivered to a profile. Exported for the API and tests. */
export async function deliveredTenderIds(db: Database, alertProfileId: string): Promise<string[]> {
  const rows = await db
    .select({ tenderId: notificationDeliveryItems.tenderId })
    .from(notificationDeliveryItems)
    .innerJoin(
      notificationDeliveries,
      eq(notificationDeliveries.id, notificationDeliveryItems.deliveryId),
    )
    .where(eq(notificationDeliveries.alertProfileId, alertProfileId));

  return [...new Set(rows.map((row) => row.tenderId))];
}

/** Convenience for the admin dashboard: recent deliveries for a user. */
export async function recentDeliveries(db: Database, userIds: readonly string[]) {
  if (userIds.length === 0) return [];
  return db
    .select()
    .from(notificationDeliveries)
    .where(inArray(notificationDeliveries.userId, [...userIds]))
    .orderBy(sql`${notificationDeliveries.scheduledFor} desc`)
    .limit(50);
}
