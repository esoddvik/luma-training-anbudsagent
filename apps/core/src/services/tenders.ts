import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  alertProfiles,
  relevanceFeedback,
  tenderMatchReasons,
  tenderMatches,
  tenders,
  userTenderStates,
} from '@luma/db';
import {
  feedbackVerdictSchema,
  noticeCategorySchema,
  type FeedbackVerdict,
  type MatchReasonType,
} from '@luma/domain';
import { MATCHING_VERSION } from '@luma/matching';
import { z } from 'zod';
import { notFound, parseOrThrow } from '../routes/errors.js';
import { requireOwnershipAudited } from './audit.js';
import { decodeCursor, toPage, type Page, type PaginationQuery } from './pagination.js';
import { loadTenderChildren } from './tender-projection.js';
import type { Actor, ApiContext } from './context.js';

/**
 * The tender read surface and the per-user state on it (spec §16, §15).
 *
 * A user may see a tender only through a match against one of their own alert
 * profiles. That is the authorisation rule for this whole file, and it is
 * expressed once, in `assertTenderAccess`, rather than as a `where user_id =`
 * clause repeated in five queries where a missing one would be invisible.
 */

export const tenderListQuerySchema = z.object({
  alertProfileId: z.uuid().optional(),
  category: noticeCategorySchema.optional(),
  state: z.enum(['saved', 'dismissed', 'opened', 'new', 'all']).optional(),
  /** Includes the evaluated-but-not-included matches. Off by default. */
  includeExcluded: z.coerce.boolean().optional(),
});
export type TenderListQuery = z.infer<typeof tenderListQuerySchema>;

export interface TenderListItem {
  readonly id: string;
  readonly title: string;
  readonly buyerName: string;
  readonly noticeCategory: string;
  readonly status: string;
  readonly publishedAt: Date;
  readonly deadlineAt: Date | null;
  readonly sourceUrl: string;
  readonly estimatedValueMinNok: number | null;
  readonly estimatedValueMaxNok: number | null;
  readonly currency: string | null;
  /** The best score across the user's own profiles. */
  readonly score: number;
  readonly userState: string | null;
}

export async function listTenders(
  ctx: ApiContext,
  actor: Actor,
  query: PaginationQuery & TenderListQuery,
): Promise<Page<TenderListItem>> {
  if (query.alertProfileId) {
    // Asking for someone else's profile must not silently return an empty
    // page, which would leak nothing but would also hide a bug.
    await assertProfileOwned(ctx, actor, query.alertProfileId);
  }

  const cursor = decodeCursor(query.cursor);

  const filters = [
    eq(alertProfiles.userId, actor.userId),
    isNull(alertProfiles.deletedAt),
    isNull(tenders.suppressedAt),
    query.includeExcluded ? undefined : eq(tenderMatches.included, true),
    query.alertProfileId ? eq(tenderMatches.alertProfileId, query.alertProfileId) : undefined,
    query.category ? eq(tenders.noticeCategory, query.category) : undefined,
    stateFilter(query.state),
    cursor
      ? or(
          lt(tenders.publishedAt, new Date(cursor.key)),
          and(eq(tenders.publishedAt, new Date(cursor.key)), lt(tenders.id, cursor.id)),
        )
      : undefined,
  ].filter((clause) => clause !== undefined);

  const rows = await ctx.db
    .select({
      id: tenders.id,
      title: tenders.title,
      buyerName: tenders.buyerName,
      noticeCategory: tenders.noticeCategory,
      status: tenders.status,
      publishedAt: tenders.publishedAt,
      deadlineAt: tenders.deadlineAt,
      sourceUrl: tenders.sourceUrl,
      estimatedValueMinNok: tenders.estimatedValueMinNok,
      estimatedValueMaxNok: tenders.estimatedValueMaxNok,
      currency: tenders.currency,
      score: sql<number>`max(${tenderMatches.score})::float8`,
      userState: userTenderStates.state,
    })
    .from(tenderMatches)
    .innerJoin(alertProfiles, eq(alertProfiles.id, tenderMatches.alertProfileId))
    .innerJoin(tenders, eq(tenders.id, tenderMatches.tenderId))
    .leftJoin(
      userTenderStates,
      and(eq(userTenderStates.tenderId, tenders.id), eq(userTenderStates.userId, actor.userId)),
    )
    .where(and(...filters))
    // One row per tender even when several of the user's profiles matched it.
    // Without this a supplier with three overlapping profiles would see the
    // same competition three times in their list.
    .groupBy(tenders.id, userTenderStates.id)
    .orderBy(desc(tenders.publishedAt), desc(tenders.id))
    .limit(query.limit + 1);

  return toPage(rows, query.limit, (row) => ({
    key: row.publishedAt.toISOString(),
    id: row.id,
  }));
}

function stateFilter(state: TenderListQuery['state']) {
  switch (state) {
    case undefined:
      // The default list hides what the user has already thrown away, but
      // still shows everything they have not judged yet.
      return or(isNull(userTenderStates.state), ne(userTenderStates.state, 'dismissed'));
    case 'all':
      return undefined;
    case 'saved':
      return eq(userTenderStates.state, 'saved');
    case 'dismissed':
      return eq(userTenderStates.state, 'dismissed');
    case 'opened':
      return eq(userTenderStates.state, 'opened');
    case 'new':
      return or(isNull(userTenderStates.state), eq(userTenderStates.state, 'new'));
    default: {
      const unexpected: never = state;
      // A new enum member must not silently widen the list.
      throw notFound(`Ukjent tilstand: ${String(unexpected)}`);
    }
  }
}

async function assertProfileOwned(ctx: ApiContext, actor: Actor, profileId: string): Promise<void> {
  const rows = await ctx.db
    .select({ userId: alertProfiles.userId })
    .from(alertProfiles)
    .where(and(eq(alertProfiles.id, profileId), isNull(alertProfiles.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('Varslingsprofilen finnes ikke.');
  await requireOwnershipAudited(ctx, {
    actor,
    resourceOwnerId: row.userId,
    action: 'alert_profile.accessed_as_admin',
    entityType: 'alert_profile',
    entityId: profileId,
  });
}

export interface TenderAccess {
  readonly tender: typeof tenders.$inferSelect;
  /** The user's own matches for this tender, best first. */
  readonly matches: {
    id: string;
    alertProfileId: string;
    score: number;
    confidence: string;
    included: boolean;
    matchingVersion: string;
  }[];
}

/**
 * The single gate on tender data.
 *
 * A tender is public information, but *which* tenders a given supplier is
 * watching is not, and neither is the fact that a competitor's profile matched
 * one. So access is granted only through the caller's own matches, and a
 * tender the caller has no match for answers 404 rather than 403: a 403 would
 * confirm the tender id is real and that somebody else matched it.
 */
export async function assertTenderAccess(
  ctx: ApiContext,
  actor: Actor,
  tenderId: string,
): Promise<TenderAccess> {
  const tenderRows = await ctx.db.select().from(tenders).where(eq(tenders.id, tenderId)).limit(1);
  const tender = tenderRows[0];
  if (!tender) throw notFound('Anbudet finnes ikke.');

  const matches = await ctx.db
    .select({
      id: tenderMatches.id,
      alertProfileId: tenderMatches.alertProfileId,
      score: tenderMatches.score,
      confidence: tenderMatches.confidence,
      included: tenderMatches.included,
      matchingVersion: tenderMatches.matchingVersion,
    })
    .from(tenderMatches)
    .innerJoin(alertProfiles, eq(alertProfiles.id, tenderMatches.alertProfileId))
    .where(
      and(
        eq(tenderMatches.tenderId, tenderId),
        eq(alertProfiles.userId, actor.userId),
        isNull(alertProfiles.deletedAt),
      ),
    )
    .orderBy(desc(tenderMatches.score));

  if (matches.length === 0 && actor.role !== 'admin') {
    throw notFound('Anbudet finnes ikke.');
  }

  return { tender, matches };
}

export interface TenderDetail extends TenderListItem {
  readonly description: string | null;
  readonly noticeType: string | null;
  readonly procedureType: string | null;
  readonly cpvCodes: readonly string[];
  readonly regions: readonly string[];
  readonly municipalities: readonly string[];
  readonly lastSyncedAt: Date;
  readonly matches: readonly {
    alertProfileId: string;
    score: number;
    confidence: string;
    included: boolean;
    matchingVersion: string;
    reasons: readonly { type: string; label: string; evidence: readonly string[] }[];
    exclusions: readonly { type: string; label: string; evidence: readonly string[] }[];
  }[];
}

export async function getTender(
  ctx: ApiContext,
  actor: Actor,
  tenderId: string,
): Promise<TenderDetail> {
  const { tender, matches } = await assertTenderAccess(ctx, actor, tenderId);
  const children = await loadTenderChildren(ctx.db, [tender.id]);

  const reasonRows =
    matches.length > 0
      ? await ctx.db
          .select()
          .from(tenderMatchReasons)
          .where(
            inArray(
              tenderMatchReasons.matchId,
              matches.map((match) => match.id),
            ),
          )
          .orderBy(tenderMatchReasons.sortOrder)
      : [];

  const state = await ctx.db
    .select({ state: userTenderStates.state })
    .from(userTenderStates)
    .where(and(eq(userTenderStates.tenderId, tender.id), eq(userTenderStates.userId, actor.userId)))
    .limit(1);

  return {
    id: tender.id,
    title: tender.title,
    buyerName: tender.buyerName,
    noticeCategory: tender.noticeCategory,
    status: tender.status,
    publishedAt: tender.publishedAt,
    deadlineAt: tender.deadlineAt,
    sourceUrl: tender.sourceUrl,
    estimatedValueMinNok: tender.estimatedValueMinNok,
    estimatedValueMaxNok: tender.estimatedValueMaxNok,
    currency: tender.currency,
    score: matches[0]?.score ?? 0,
    userState: state[0]?.state ?? null,
    description: tender.description,
    noticeType: tender.noticeType,
    procedureType: tender.procedureType,
    cpvCodes: children.cpv.get(tender.id) ?? [],
    regions: children.regions.get(tender.id) ?? [],
    municipalities: children.municipalities.get(tender.id) ?? [],
    lastSyncedAt: tender.lastSyncedAt,
    matches: matches.map((match) => {
      const own = reasonRows.filter((row) => row.matchId === match.id);
      return {
        alertProfileId: match.alertProfileId,
        score: match.score,
        confidence: match.confidence,
        included: match.included,
        matchingVersion: match.matchingVersion,
        reasons: own
          .filter((row) => row.entryType === 'reason')
          .map((row) => ({ type: row.typeKey, label: row.label, evidence: row.evidence })),
        exclusions: own
          .filter((row) => row.entryType === 'exclusion')
          .map((row) => ({ type: row.typeKey, label: row.label, evidence: row.evidence })),
      };
    }),
  };
}

export type UserTenderState = 'new' | 'opened' | 'saved' | 'dismissed';

/**
 * Records what the user did with a tender (spec §16).
 *
 * Upsert on `(user, tender)`, so saving twice is idempotent and saving
 * something previously dismissed simply moves it. The timestamp columns are
 * additive: a tender that was dismissed and later saved keeps both marks,
 * which is what makes the relevance signal in spec §15 readable afterwards.
 */
export async function setTenderState(
  ctx: ApiContext,
  actor: Actor,
  tenderId: string,
  state: UserTenderState,
): Promise<{ tenderId: string; state: UserTenderState }> {
  await assertTenderAccess(ctx, actor, tenderId);
  const now = ctx.now();

  const marks = {
    opened: state === 'opened' ? now : undefined,
    saved: state === 'saved' ? now : undefined,
    dismissed: state === 'dismissed' ? now : undefined,
  };

  await ctx.db
    .insert(userTenderStates)
    .values({
      userId: actor.userId,
      tenderId,
      state,
      openedAt: marks.opened ?? null,
      savedAt: marks.saved ?? null,
      dismissedAt: marks.dismissed ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userTenderStates.userId, userTenderStates.tenderId],
      set: {
        state,
        ...(marks.opened ? { openedAt: marks.opened } : {}),
        ...(marks.saved ? { savedAt: marks.saved } : {}),
        ...(marks.dismissed ? { dismissedAt: marks.dismissed } : {}),
        updatedAt: now,
      },
    });

  return { tenderId, state };
}

export const feedbackInputSchema = z.object({
  verdict: feedbackVerdictSchema,
  comment: z.string().trim().max(2000).optional(),
  alertProfileId: z.uuid().optional(),
});

export interface FeedbackResult {
  readonly tenderId: string;
  readonly verdict: FeedbackVerdict;
  readonly matchingVersion: string;
}

/**
 * Relevance feedback (spec §15).
 *
 * Stored against the matching version it was given under, because feedback on
 * a match produced by one set of weights says nothing reliable about a match
 * produced by another. Nothing here edits the profile: §15 requires that
 * suggestions be shown and approved, never applied automatically.
 */
export async function submitFeedback(
  ctx: ApiContext,
  actor: Actor,
  tenderId: string,
  body: unknown,
): Promise<FeedbackResult> {
  const input = parseOrThrow(feedbackInputSchema, body);
  const { matches } = await assertTenderAccess(ctx, actor, tenderId);

  if (input.alertProfileId) {
    await assertProfileOwned(ctx, actor, input.alertProfileId);
  }

  const alertProfileId = input.alertProfileId ?? matches[0]?.alertProfileId ?? null;
  const matchingVersion = matches[0]?.matchingVersion ?? MATCHING_VERSION;

  await ctx.db
    .insert(relevanceFeedback)
    .values({
      userId: actor.userId,
      tenderId,
      alertProfileId,
      verdict: input.verdict,
      comment: input.comment ?? null,
      matchingVersion,
      createdAt: ctx.now(),
    })
    // Changing your mind replaces the earlier verdict rather than failing on
    // the uniqueness constraint the schema puts on (user, tender, profile,
    // version).
    .onConflictDoUpdate({
      target: [
        relevanceFeedback.userId,
        relevanceFeedback.tenderId,
        relevanceFeedback.alertProfileId,
        relevanceFeedback.matchingVersion,
      ],
      set: { verdict: input.verdict, comment: input.comment ?? null },
    });

  return { tenderId, verdict: input.verdict, matchingVersion };
}

/** The distinct reason *types* behind a user's match. Used by the shared view. */
export async function reasonTypesForMatches(
  ctx: ApiContext,
  matchIds: readonly string[],
): Promise<MatchReasonType[]> {
  if (matchIds.length === 0) return [];
  const rows = await ctx.db
    .select({ reasonType: tenderMatchReasons.reasonType })
    .from(tenderMatchReasons)
    .where(
      and(
        inArray(tenderMatchReasons.matchId, [...matchIds]),
        eq(tenderMatchReasons.entryType, 'reason'),
      ),
    );
  const types = new Set<MatchReasonType>();
  for (const row of rows) {
    if (row.reasonType) types.add(row.reasonType);
  }
  return [...types];
}
