import { eq, inArray } from 'drizzle-orm';
import type { Database } from '@luma/db';
import {
  editorialRecommendations,
  notificationPreferences,
  tenderMatchReasons,
  tenderMatches,
} from '@luma/db';
import type { EditorialRecommendation, MatchResult, NotificationPreferences } from '@luma/domain';
import {
  ladderStateForAccount,
  renderImmediateAlert,
  selectPromotion,
  type EmailClient,
  type ImmediateAlertContext,
} from '@luma/email';
import type { Logger } from '@luma/observability';
import { markDeliveryFailed, markDeliverySent } from './digest.js';
import { accountCreatedAt, profileRegionCodes } from './delivery-reads.js';
import type { ImmediateCandidate } from './immediate.js';
import { loadTendersByIds } from './tender-reads.js';

/**
 * Turning a claimed immediate alert into a sent email (spec §9.3).
 *
 * The shape mirrors `digest-send.ts` deliberately: the scheduler claims, this
 * sends, and promotion is selected here rather than inside the renderer so
 * commercial content cannot reach match data (ADR-0006). The differences from
 * the digest are the two the spec asks for — one tender rather than a list,
 * and `tender-immediate-v1` rather than a digest template.
 *
 * One thing is genuinely different and worth stating. The digest derives the
 * promotion ladder from the period start, which is a stand-in for account age
 * that happens to be adequate for a daily window. An immediate alert has no
 * period, so this reads the account's real creation date. A user who has been
 * registered a week therefore sees the same ladder level in both emails, which
 * is what spec §23.3 actually asks for.
 */

export interface SendImmediateOptions {
  readonly db: Database;
  readonly emailClient: EmailClient;
  readonly logger: Logger;
  readonly candidate: ImmediateCandidate;
  readonly deliveryId: string;
  readonly now: Date;
  readonly appUrl: string;
  readonly privacyUrl: string;
  readonly termsUrl: string;
  readonly senderName: string;
  readonly senderPostalAddress: string;
  readonly senderContactEmail: string;
  readonly osloRegionCodes: readonly string[];
}

export type SendImmediateResult =
  | { readonly sent: true; readonly messageId?: string }
  | { readonly sent: false; readonly reason: string };

async function loadPreferences(db: Database, userId: string): Promise<NotificationPreferences> {
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  const row = rows[0];

  // Spec §22 defaults. `marketingEmailConsent` is false here on purpose: it is
  // derived from the consent log and is irrelevant to a tender alert, which
  // never goes on the marketing stream.
  return {
    tenderAlertsEnabled: row?.tenderAlertsEnabled ?? true,
    immediateAlertsEnabled: row?.immediateAlertsEnabled ?? false,
    digestEnabled: row?.digestEnabled ?? true,
    includeLumaPromotionsInTenderEmails: row?.includeLumaPromotionsInTenderEmails ?? true,
    marketingEmailConsent: false,
  };
}

/** Rebuilds one stored match into the domain shape the renderer expects. */
async function loadMatch(db: Database, matchId: string): Promise<MatchResult | null> {
  const [matchRows, reasonRows] = await Promise.all([
    db.select().from(tenderMatches).where(eq(tenderMatches.id, matchId)).limit(1),
    db
      .select()
      .from(tenderMatchReasons)
      .where(inArray(tenderMatchReasons.matchId, [matchId])),
  ]);

  const row = matchRows[0];
  if (!row) return null;

  const ordered = [...reasonRows].sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    tenderId: row.tenderId,
    alertProfileId: row.alertProfileId,
    score: row.score,
    confidence: row.confidence,
    included: row.included,
    matchingVersion: row.matchingVersion,
    reasons: ordered
      .filter((reason) => reason.entryType === 'reason' && reason.reasonType !== null)
      .map((reason) => ({
        // Narrowed by the filter above; `noUncheckedIndexedAccess` does not
        // see through it, so the assertion is doing real work.
        type: reason.reasonType as NonNullable<typeof reason.reasonType>,
        label: reason.label,
        contribution: reason.contribution ?? 0,
        evidence: reason.evidence,
      })),
    exclusions: ordered
      .filter((reason) => reason.entryType === 'exclusion')
      .map((reason) => ({
        type: reason.typeKey,
        label: reason.label,
        evidence: reason.evidence,
      })),
  };
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

/**
 * A small stable integer derived from the delivery id.
 *
 * Derived rather than random so a retried render produces the same promotion:
 * a user who receives a resent alert should not see a different advertisement
 * in it. Same rule, same reason, as the digest.
 */
function rotationIndexFor(deliveryId: string): number {
  let hash = 0;
  for (const character of deliveryId) {
    hash = (hash * 31 + character.charCodeAt(0)) % 100_000;
  }
  return hash;
}

export async function sendClaimedImmediateAlert(
  options: SendImmediateOptions,
): Promise<SendImmediateResult> {
  const { db, candidate, deliveryId, now, logger } = options;

  const [tenders, match, preferences, recommendations, regionCodes, createdAt] = await Promise.all([
    loadTendersByIds(db, [candidate.tenderId]),
    loadMatch(db, candidate.matchId),
    loadPreferences(db, candidate.userId),
    loadActiveRecommendations(db),
    profileRegionCodes(db, candidate.alertProfileId),
    accountCreatedAt(db, candidate.userId),
  ]);

  const tender = tenders[0];
  if (!tender || !match) {
    await markDeliveryFailed(db, deliveryId, 'tender or match missing for claimed alert');
    return { sent: false, reason: 'missing tender or match' };
  }

  const promotion = selectPromotion({
    recommendations,
    placement: 'digest_footer',
    medium: 'digest',
    preferences,
    userRegionCodes: regionCodes,
    osloRegionCodes: options.osloRegionCodes,
    ladder: ladderStateForAccount({
      accountCreatedAt: createdAt ?? now,
      now,
      rotationIndex: rotationIndexFor(deliveryId),
    }),
    now,
  });

  const context: ImmediateAlertContext = {
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
    item: { tender, match },
  };

  const email = renderImmediateAlert(context);

  try {
    const outcome = await options.emailClient.sendTenderNotification(email, {
      to: candidate.email,
    });

    if (outcome.status === 'suppressed') {
      // Postmark refuses this address on this stream, usually after a hard
      // bounce. Recording it as failed keeps a suppression list from looking
      // like an outage while still leaving a trace in admin.
      await markDeliveryFailed(db, deliveryId, `suppressed: ${outcome.reason}`);
      return { sent: false, reason: outcome.reason };
    }

    await markDeliverySent(db, deliveryId, outcome.messageId, new Date());
    return { sent: true, messageId: outcome.messageId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown send failure';
    logger.error({ err: error, deliveryId }, 'immediate alert send failed');
    await markDeliveryFailed(db, deliveryId, reason);
    return { sent: false, reason };
  }
}
