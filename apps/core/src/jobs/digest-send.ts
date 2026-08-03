import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '@luma/db';
import {
  alertProfileGeographies,
  editorialRecommendations,
  notificationDeliveryItems,
  notificationPreferences,
  tenderChangeEvents,
  tenderMatchReasons,
  tenderMatches,
  userTenderStates,
} from '@luma/db';
import type {
  EditorialRecommendation,
  MatchResult,
  NotificationPreferences,
  TenderChangeEvent,
} from '@luma/domain';
import {
  ladderStateForAccount,
  renderDigest,
  selectPromotion,
  type DigestContext,
  type EmailClient,
  type TenderCardItem,
  type TenderChangeItem,
} from '@luma/email';
import type { Logger } from '@luma/observability';
import { loadTendersByIds } from './tender-reads.js';
import { markDeliveryFailed, markDeliverySent, type DigestCandidate } from './digest.js';

/**
 * Turning a claimed delivery into a sent email (spec §26).
 *
 * The scheduler has already decided who is due and reserved the right to send.
 * This assembles the content and hands it to Postmark.
 *
 * Promotion is selected *here*, before rendering, and never inside the
 * renderer. That is ADR-6 made structural: the renderer receives an
 * already-chosen block or null and has no access to match data at all, so
 * commercial content cannot influence what tenders appear or in what order.
 */

export interface SendDigestOptions {
  db: Database;
  emailClient: EmailClient;
  logger: Logger;
  candidate: DigestCandidate;
  deliveryId: string;
  now: Date;
  appUrl: string;
  privacyUrl: string;
  termsUrl: string;
  senderName: string;
  senderPostalAddress: string;
  senderContactEmail: string;
  osloRegionCodes: readonly string[];
}

export type SendDigestResult =
  | { readonly sent: true; readonly messageId?: string }
  | { readonly sent: false; readonly reason: string };

async function loadPreferences(db: Database, userId: string): Promise<NotificationPreferences> {
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  const row = rows[0];

  // Two of these are §22's «Anbefalt standard»: promotion on, marketing consent
  // off. The three alert defaults are the column defaults in
  // `notification_preferences` (`@luma/db`) — §22 states no default for them.
  // Marketing consent is never read from here; it is derived from the consent log.
  return {
    tenderAlertsEnabled: row?.tenderAlertsEnabled ?? true,
    immediateAlertsEnabled: row?.immediateAlertsEnabled ?? false,
    digestEnabled: row?.digestEnabled ?? true,
    includeLumaPromotionsInTenderEmails: row?.includeLumaPromotionsInTenderEmails ?? true,
    marketingEmailConsent: false,
  };
}

/** Rebuilds a stored match into the domain shape the email renderer expects. */
async function loadMatches(
  db: Database,
  matchIds: readonly string[],
): Promise<Map<string, MatchResult>> {
  if (matchIds.length === 0) return new Map();

  const [matchRows, reasonRows] = await Promise.all([
    db
      .select()
      .from(tenderMatches)
      .where(inArray(tenderMatches.id, [...matchIds])),
    db
      .select()
      .from(tenderMatchReasons)
      .where(inArray(tenderMatchReasons.matchId, [...matchIds])),
  ]);

  const byMatch = new Map<string, MatchResult>();
  for (const row of matchRows) {
    const own = reasonRows
      .filter((reason) => reason.matchId === row.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    byMatch.set(row.id, {
      tenderId: row.tenderId,
      alertProfileId: row.alertProfileId,
      score: row.score,
      confidence: row.confidence,
      included: row.included,
      matchingVersion: row.matchingVersion,
      reasons: own
        .filter((reason) => reason.entryType === 'reason' && reason.reasonType !== null)
        .map((reason) => ({
          type: reason.reasonType!,
          label: reason.label,
          contribution: reason.contribution ?? 0,
          evidence: reason.evidence,
        })),
      exclusions: own
        .filter((reason) => reason.entryType === 'exclusion')
        .map((reason) => ({
          type: reason.typeKey,
          label: reason.label,
          evidence: reason.evidence,
        })),
    });
  }
  return byMatch;
}

/** Changes to tenders this user has saved (spec §26 section 6). */
async function loadSavedTenderChanges(
  db: Database,
  userId: string,
  since: Date,
): Promise<TenderChangeItem[]> {
  const saved = await db
    .select({ tenderId: userTenderStates.tenderId })
    .from(userTenderStates)
    .where(and(eq(userTenderStates.userId, userId), eq(userTenderStates.state, 'saved')));

  if (saved.length === 0) return [];

  const changeRows = await db
    .select()
    .from(tenderChangeEvents)
    .where(
      inArray(
        tenderChangeEvents.tenderId,
        saved.map((row) => row.tenderId),
      ),
    );

  const recent = changeRows.filter((row) => row.detectedAt >= since);
  if (recent.length === 0) return [];

  const tenders = await loadTendersByIds(db, [...new Set(recent.map((row) => row.tenderId))]);
  const byId = new Map(tenders.map((tender) => [tender.id, tender]));

  const grouped = new Map<string, TenderChangeEvent[]>();
  for (const row of recent) {
    const event: TenderChangeEvent = {
      id: row.id,
      tenderId: row.tenderId,
      kind: row.kind,
      summary: row.summary,
      detectedAt: row.detectedAt,
    };
    if (row.previousValue) event.previousValue = row.previousValue;
    if (row.currentValue) event.currentValue = row.currentValue;
    grouped.set(row.tenderId, [...(grouped.get(row.tenderId) ?? []), event]);
  }

  return [...grouped.entries()].flatMap(([tenderId, changes]) => {
    const tender = byId.get(tenderId);
    return tender ? [{ tender, changes }] : [];
  });
}

async function loadActiveRecommendations(db: Database): Promise<EditorialRecommendation[]> {
  const rows = await db
    .select()
    .from(editorialRecommendations)
    .where(eq(editorialRecommendations.active, true));

  return rows.map((row) => {
    const recommendation: EditorialRecommendation = {
      id: row.id,
      title: row.title,
      description: row.description,
      url: row.url,
      placement: row.placement,
      relevanceTags: row.relevanceTags,
      ladderLevel: row.ladderLevel as EditorialRecommendation['ladderLevel'],
      regionScope: row.regionScope,
      marketingCategory: row.marketingCategory,
      isPaid: row.isPaid,
      active: row.active,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    if (row.activeFrom) recommendation.activeFrom = row.activeFrom;
    if (row.activeUntil) recommendation.activeUntil = row.activeUntil;
    return recommendation;
  });
}

export async function sendClaimedDigest(options: SendDigestOptions): Promise<SendDigestResult> {
  const { db, candidate, deliveryId, now, logger } = options;

  const items = await db
    .select()
    .from(notificationDeliveryItems)
    .where(eq(notificationDeliveryItems.deliveryId, deliveryId))
    .orderBy(notificationDeliveryItems.sortOrder);

  if (items.length === 0) {
    await markDeliveryFailed(db, deliveryId, 'no items on claimed delivery');
    return { sent: false, reason: 'no items' };
  }

  const [tenders, matches, preferences, recommendations] = await Promise.all([
    loadTendersByIds(
      db,
      items.map((item) => item.tenderId),
    ),
    loadMatches(
      db,
      items.flatMap((item) => (item.tenderMatchId ? [item.tenderMatchId] : [])),
    ),
    loadPreferences(db, candidate.userId),
    loadActiveRecommendations(db),
  ]);

  const tenderById = new Map(tenders.map((tender) => [tender.id, tender]));

  const cards: TenderCardItem[] = items.flatMap((item) => {
    const tender = tenderById.get(item.tenderId);
    const match = item.tenderMatchId ? matches.get(item.tenderMatchId) : undefined;
    return tender && match ? [{ tender, match }] : [];
  });

  // Spec §26: planned procurements go in their own labelled section, never
  // mixed in with live competitions.
  const competitions = cards.filter((card) => card.tender.noticeCategory !== 'planned');
  const plannedProcurements = cards.filter((card) => card.tender.noticeCategory === 'planned');

  const periodStart = new Date(
    now.getTime() - (candidate.frequency === 'weekly' ? 7 : 1) * 86_400_000,
  );
  const savedTenderChanges = await loadSavedTenderChanges(db, candidate.userId, periodStart);

  const regionCodes = await profileRegionCodes(db, candidate.alertProfileId);

  // Selected before rendering, and null when the user turned promotion off.
  const promotion = selectPromotion({
    recommendations,
    placement: 'digest_footer',
    medium: 'digest',
    preferences,
    userRegionCodes: regionCodes,
    osloRegionCodes: options.osloRegionCodes,
    ladder: ladderStateForAccount({
      accountCreatedAt: periodStart,
      now,
      // Stable per delivery, so a retry renders the same promotion rather than
      // rotating to a different one mid-flight.
      rotationIndex: rotationIndexFor(deliveryId),
    }),
    now,
  });

  const context: DigestContext = {
    recipientEmail: candidate.email,
    sender: {
      name: options.senderName,
      postalAddress: options.senderPostalAddress,
      contactEmail: options.senderContactEmail,
    },
    links: {
      appUrl: options.appUrl,
      privacyUrl: options.privacyUrl,
      termsUrl: options.termsUrl,
      medium: 'digest',
    },
    now,
    profileName: candidate.profileName,
    preferences,
    promotion,
    competitions,
    plannedProcurements,
    savedTenderChanges,
    periodStart,
    periodEnd: now,
  };

  const email = renderDigest(context, candidate.frequency === 'weekly' ? 'weekly' : 'daily');

  try {
    const outcome = await options.emailClient.sendTenderNotification(email, {
      to: candidate.email,
    });

    if (outcome.status === 'suppressed') {
      // Not a failure of ours: Postmark refuses the address on this stream,
      // usually after a hard bounce or a complaint. Recording it as failed
      // would make a suppression list look like an outage.
      await markDeliveryFailed(db, deliveryId, `suppressed: ${outcome.reason}`);
      return { sent: false, reason: outcome.reason };
    }
    await markDeliverySent(db, deliveryId, outcome.messageId, new Date());
    return { sent: true, messageId: outcome.messageId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown send failure';
    logger.error({ err: error, deliveryId }, 'digest send failed');
    await markDeliveryFailed(db, deliveryId, reason);
    return { sent: false, reason };
  }
}

/**
 * A small stable integer derived from the delivery id.
 *
 * Used to rotate the promotion ladder. Derived rather than random so a retry
 * of the same delivery renders the same block: a user who receives a retried
 * digest should not see a different advertisement in it.
 */
function rotationIndexFor(deliveryId: string): number {
  let hash = 0;
  for (const character of deliveryId) {
    hash = (hash * 31 + character.charCodeAt(0)) % 100_000;
  }
  return hash;
}

/** Region codes stated on one alert profile, for editorial routing (§23.2). */
async function profileRegionCodes(db: Database, alertProfileId: string): Promise<string[]> {
  const rows = await db
    .select({ code: alertProfileGeographies.code })
    .from(alertProfileGeographies)
    .where(eq(alertProfileGeographies.alertProfileId, alertProfileId));
  return rows.map((row) => row.code);
}
