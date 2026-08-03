import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import type { Database } from './db';
import type { FeedbackVerdict, MatchConfidence, NoticeCategory, TenderStatus } from '@luma/domain';
import { buildMatchExplanation, type FullMatchExplanation } from './match-explanation';

/**
 * Reads of tender and match data (spec section 16).
 *
 * Every function takes a `Database` so it can be exercised against a throwaway
 * database in a test; nothing here reaches for the process-wide pool. Every
 * function also takes the user id and scopes its query by the user's own
 * profiles — a tender id or a profile id arriving from a URL is user input,
 * and joining on it without that scope is how one account reads another's
 * matches.
 */

export type UserTenderState = 'new' | 'opened' | 'saved' | 'dismissed';

export interface TenderSummary {
  readonly id: string;
  readonly title: string;
  readonly buyerName: string;
  readonly description: string | null;
  readonly noticeCategory: NoticeCategory;
  readonly status: TenderStatus;
  readonly publishedAt: Date;
  readonly deadlineAt: Date | null;
  readonly lastSyncedAt: Date;
  readonly sourceUrl: string;
  readonly estimatedValueMinNok: number | null;
  readonly estimatedValueMaxNok: number | null;
  readonly currency: string | null;
}

export interface MatchListItem {
  readonly matchId: string;
  readonly tender: TenderSummary;
  readonly profileId: string;
  readonly profileName: string;
  readonly confidence: MatchConfidence;
  readonly state: UserTenderState;
  /** The two or three leading reason labels, for the card (spec section 25). */
  readonly reasonLabels: readonly string[];
  readonly cpvCodes: readonly string[];
  readonly regionCodes: readonly string[];
}

export interface DashboardFilters {
  readonly profileId?: string | undefined;
  /** Maximum number of days until the deadline. */
  readonly deadlineWithinDays?: number | undefined;
  readonly buyer?: string | undefined;
  readonly cpv?: string | undefined;
  readonly state?: UserTenderState | undefined;
  readonly category?: NoticeCategory | undefined;
}

const MAX_ROWS = 200;

/**
 * The user's included matches, newest notice first (spec section 16: "nye
 * treff først").
 *
 * Only `included` matches are listed. A match that a hard exclusion knocked out
 * is kept in the database so the detail page can explain *why* it was excluded,
 * but it is not a result.
 *
 * Suppressed tenders (spec section 45) are filtered out here rather than in the
 * page, so an admin suppression takes effect on every surface at once.
 */
export async function listMatches(
  db: Database,
  input: { userId: string; filters?: DashboardFilters; limit?: number },
): Promise<MatchListItem[]> {
  const filters = input.filters ?? {};
  const conditions = [
    eq(schema.alertProfiles.userId, input.userId),
    isNull(schema.alertProfiles.deletedAt),
    eq(schema.tenderMatches.included, true),
    isNull(schema.tenders.suppressedAt),
  ];

  if (filters.profileId) {
    conditions.push(eq(schema.tenderMatches.alertProfileId, filters.profileId));
  }
  if (filters.category) {
    conditions.push(eq(schema.tenders.noticeCategory, filters.category));
  }
  if (filters.buyer && filters.buyer.trim().length > 0) {
    conditions.push(ilike(schema.tenders.buyerName, `%${escapeLike(filters.buyer.trim())}%`));
  }
  if (filters.deadlineWithinDays !== undefined) {
    const horizon = new Date(Date.now() + filters.deadlineWithinDays * 86_400_000);
    // A notice with no deadline is a planned procurement, which has none by
    // definition; a deadline filter is a statement about competitions, so those
    // rows drop out rather than being treated as "deadline unknown, keep it".
    conditions.push(
      and(
        lte(schema.tenders.deadlineAt, horizon),
        gte(schema.tenders.deadlineAt, new Date(Date.now() - 86_400_000)),
      )!,
    );
  }
  if (filters.cpv && filters.cpv.trim().length > 0) {
    const prefix = significantCpvDigits(filters.cpv);
    if (prefix !== undefined) {
      conditions.push(
        sql`exists (
          select 1 from ${schema.tenderCpvCodes}
          where ${schema.tenderCpvCodes.tenderId} = ${schema.tenders.id}
            and ${schema.tenderCpvCodes.cpvCode} like ${`${prefix}%`}
        )`,
      );
    }
  }

  // The state filter needs the outer-joined row, so it is expressed against
  // the coalesced value rather than against the join.
  const stateExpression = sql<UserTenderState>`coalesce(${schema.userTenderStates.state}, 'new')`;
  if (filters.state) {
    conditions.push(sql`${stateExpression} = ${filters.state}`);
  } else {
    // Dismissed matches are hidden unless the user asks for them by name.
    conditions.push(sql`${stateExpression} <> 'dismissed'`);
  }

  const rows = await db
    .select({
      matchId: schema.tenderMatches.id,
      confidence: schema.tenderMatches.confidence,
      profileId: schema.alertProfiles.id,
      profileName: schema.alertProfiles.name,
      state: stateExpression,
      tenderId: schema.tenders.id,
      title: schema.tenders.title,
      buyerName: schema.tenders.buyerName,
      description: schema.tenders.description,
      noticeCategory: schema.tenders.noticeCategory,
      status: schema.tenders.status,
      publishedAt: schema.tenders.publishedAt,
      deadlineAt: schema.tenders.deadlineAt,
      lastSyncedAt: schema.tenders.lastSyncedAt,
      sourceUrl: schema.tenders.sourceUrl,
      estimatedValueMinNok: schema.tenders.estimatedValueMinNok,
      estimatedValueMaxNok: schema.tenders.estimatedValueMaxNok,
      currency: schema.tenders.currency,
    })
    .from(schema.tenderMatches)
    .innerJoin(
      schema.alertProfiles,
      eq(schema.alertProfiles.id, schema.tenderMatches.alertProfileId),
    )
    .innerJoin(schema.tenders, eq(schema.tenders.id, schema.tenderMatches.tenderId))
    .leftJoin(
      schema.userTenderStates,
      and(
        eq(schema.userTenderStates.tenderId, schema.tenders.id),
        eq(schema.userTenderStates.userId, input.userId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.tenders.publishedAt), desc(schema.tenderMatches.score))
    .limit(Math.min(input.limit ?? MAX_ROWS, MAX_ROWS));

  if (rows.length === 0) return [];

  const matchIds = rows.map((row) => row.matchId);
  const tenderIds = [...new Set(rows.map((row) => row.tenderId))];
  const [reasonsByMatch, cpvByTender, regionsByTender] = await Promise.all([
    leadingReasonLabels(db, matchIds),
    cpvCodesFor(db, tenderIds),
    regionCodesFor(db, tenderIds),
  ]);

  return rows.map((row) => ({
    matchId: row.matchId,
    profileId: row.profileId,
    profileName: row.profileName,
    confidence: row.confidence,
    state: row.state,
    reasonLabels: reasonsByMatch.get(row.matchId) ?? [],
    cpvCodes: cpvByTender.get(row.tenderId) ?? [],
    regionCodes: regionsByTender.get(row.tenderId) ?? [],
    tender: {
      id: row.tenderId,
      title: row.title,
      buyerName: row.buyerName,
      description: row.description,
      noticeCategory: row.noticeCategory,
      status: row.status,
      publishedAt: row.publishedAt,
      deadlineAt: row.deadlineAt,
      lastSyncedAt: row.lastSyncedAt,
      sourceUrl: row.sourceUrl,
      estimatedValueMinNok: row.estimatedValueMinNok,
      estimatedValueMaxNok: row.estimatedValueMaxNok,
      currency: row.currency,
    },
  }));
}

/** Distinct buyers across the user's matches, for the filter drop-down. */
export async function listMatchedBuyers(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ buyerName: schema.tenders.buyerName })
    .from(schema.tenderMatches)
    .innerJoin(
      schema.alertProfiles,
      eq(schema.alertProfiles.id, schema.tenderMatches.alertProfileId),
    )
    .innerJoin(schema.tenders, eq(schema.tenders.id, schema.tenderMatches.tenderId))
    .where(
      and(
        eq(schema.alertProfiles.userId, userId),
        isNull(schema.alertProfiles.deletedAt),
        eq(schema.tenderMatches.included, true),
        isNull(schema.tenders.suppressedAt),
      ),
    )
    .orderBy(asc(schema.tenders.buyerName))
    .limit(200);
  return rows.map((row) => row.buyerName);
}

/** Tenders the user has saved (spec section 16). */
export async function listSavedTenders(db: Database, userId: string): Promise<TenderSummary[]> {
  const rows = await db
    .select({
      id: schema.tenders.id,
      title: schema.tenders.title,
      buyerName: schema.tenders.buyerName,
      description: schema.tenders.description,
      noticeCategory: schema.tenders.noticeCategory,
      status: schema.tenders.status,
      publishedAt: schema.tenders.publishedAt,
      deadlineAt: schema.tenders.deadlineAt,
      lastSyncedAt: schema.tenders.lastSyncedAt,
      sourceUrl: schema.tenders.sourceUrl,
      estimatedValueMinNok: schema.tenders.estimatedValueMinNok,
      estimatedValueMaxNok: schema.tenders.estimatedValueMaxNok,
      currency: schema.tenders.currency,
    })
    .from(schema.userTenderStates)
    .innerJoin(schema.tenders, eq(schema.tenders.id, schema.userTenderStates.tenderId))
    .where(
      and(
        eq(schema.userTenderStates.userId, userId),
        eq(schema.userTenderStates.state, 'saved'),
        isNull(schema.tenders.suppressedAt),
      ),
    )
    .orderBy(desc(schema.userTenderStates.savedAt))
    .limit(MAX_ROWS);
  return rows;
}

export interface TenderDetail {
  readonly tender: TenderSummary & {
    readonly sourceId: string;
    readonly noticeId: string | null;
    readonly noticeType: string | null;
    readonly procedureType: string | null;
    readonly buyerOrganizationNumber: string | null;
    readonly modifiedAt: Date | null;
    readonly sourceRevision: string | null;
  };
  readonly cpvCodes: readonly string[];
  readonly regionCodes: readonly string[];
  /** Empty when the tender is not matched by any of the user's profiles. */
  readonly matches: readonly TenderDetailMatch[];
  readonly state: UserTenderState;
  readonly note: string | null;
  readonly feedback: FeedbackVerdict | null;
  readonly changeEvents: readonly TenderChangeSummary[];
  readonly activeShareCount: number;
}

export interface TenderDetailMatch {
  readonly matchId: string;
  readonly profileId: string;
  readonly profileName: string;
  readonly included: boolean;
  readonly explanation: FullMatchExplanation;
}

export interface TenderChangeSummary {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly detectedAt: Date;
}

/**
 * One tender, with everything the detail page shows.
 *
 * Returns `null` for an unknown or suppressed tender, so the page renders the
 * ordinary not-found view. Note that a tender is *public procurement data* —
 * it is not scoped to the user. What is scoped is the match explanation, the
 * saved/dismissed state and the feedback, all of which are the user's own.
 */
export async function getTenderDetail(
  db: Database,
  input: { tenderId: string; userId: string },
): Promise<TenderDetail | null> {
  const [tender] = await db
    .select({
      id: schema.tenders.id,
      title: schema.tenders.title,
      buyerName: schema.tenders.buyerName,
      buyerOrganizationNumber: schema.tenders.buyerOrganizationNumber,
      description: schema.tenders.description,
      noticeCategory: schema.tenders.noticeCategory,
      status: schema.tenders.status,
      publishedAt: schema.tenders.publishedAt,
      deadlineAt: schema.tenders.deadlineAt,
      lastSyncedAt: schema.tenders.lastSyncedAt,
      modifiedAt: schema.tenders.modifiedAt,
      sourceUrl: schema.tenders.sourceUrl,
      sourceId: schema.tenders.sourceId,
      noticeId: schema.tenders.noticeId,
      noticeType: schema.tenders.noticeType,
      procedureType: schema.tenders.procedureType,
      sourceRevision: schema.tenders.sourceRevision,
      estimatedValueMinNok: schema.tenders.estimatedValueMinNok,
      estimatedValueMaxNok: schema.tenders.estimatedValueMaxNok,
      currency: schema.tenders.currency,
    })
    .from(schema.tenders)
    .where(and(eq(schema.tenders.id, input.tenderId), isNull(schema.tenders.suppressedAt)))
    .limit(1);

  if (!tender) return null;

  const [cpvMap, regionMap, matchRows, stateRow, feedbackRow, changeRows, shareCount] =
    await Promise.all([
      cpvCodesFor(db, [tender.id]),
      regionCodesFor(db, [tender.id]),
      db
        .select({
          matchId: schema.tenderMatches.id,
          profileId: schema.alertProfiles.id,
          profileName: schema.alertProfiles.name,
          included: schema.tenderMatches.included,
          confidence: schema.tenderMatches.confidence,
          matchingVersion: schema.tenderMatches.matchingVersion,
        })
        .from(schema.tenderMatches)
        .innerJoin(
          schema.alertProfiles,
          eq(schema.alertProfiles.id, schema.tenderMatches.alertProfileId),
        )
        .where(
          and(
            eq(schema.tenderMatches.tenderId, tender.id),
            eq(schema.alertProfiles.userId, input.userId),
            isNull(schema.alertProfiles.deletedAt),
          ),
        )
        .orderBy(desc(schema.tenderMatches.score)),
      db
        .select({
          state: schema.userTenderStates.state,
          note: schema.userTenderStates.note,
        })
        .from(schema.userTenderStates)
        .where(
          and(
            eq(schema.userTenderStates.tenderId, tender.id),
            eq(schema.userTenderStates.userId, input.userId),
          ),
        )
        .limit(1),
      db
        .select({ verdict: schema.relevanceFeedback.verdict })
        .from(schema.relevanceFeedback)
        .where(
          and(
            eq(schema.relevanceFeedback.tenderId, tender.id),
            eq(schema.relevanceFeedback.userId, input.userId),
          ),
        )
        .orderBy(desc(schema.relevanceFeedback.createdAt))
        .limit(1),
      db
        .select({
          id: schema.tenderChangeEvents.id,
          kind: schema.tenderChangeEvents.kind,
          summary: schema.tenderChangeEvents.summary,
          detectedAt: schema.tenderChangeEvents.detectedAt,
        })
        .from(schema.tenderChangeEvents)
        .where(eq(schema.tenderChangeEvents.tenderId, tender.id))
        .orderBy(desc(schema.tenderChangeEvents.detectedAt))
        .limit(20),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.tenderShares)
        .where(
          and(
            eq(schema.tenderShares.tenderId, tender.id),
            eq(schema.tenderShares.createdByUserId, input.userId),
            isNull(schema.tenderShares.revokedAt),
            gte(schema.tenderShares.expiresAt, new Date()),
          ),
        ),
    ]);

  const reasonRows = await reasonRowsFor(
    db,
    matchRows.map((row) => row.matchId),
  );

  const matches: TenderDetailMatch[] = matchRows.map((row) => ({
    matchId: row.matchId,
    profileId: row.profileId,
    profileName: row.profileName,
    included: row.included,
    explanation: buildMatchExplanation({
      confidence: row.confidence,
      matchingVersion: row.matchingVersion,
      rows: reasonRows.get(row.matchId) ?? [],
    }),
  }));

  return {
    tender,
    cpvCodes: cpvMap.get(tender.id) ?? [],
    regionCodes: regionMap.get(tender.id) ?? [],
    matches,
    state: stateRow[0]?.state ?? 'new',
    note: stateRow[0]?.note ?? null,
    feedback: feedbackRow[0]?.verdict ?? null,
    changeEvents: changeRows,
    activeShareCount: shareCount[0]?.count ?? 0,
  };
}

/** How many included matches the user has, split by notice category. */
export async function countMatchesByCategory(
  db: Database,
  userId: string,
): Promise<Record<NoticeCategory, number>> {
  const rows = await db
    .select({
      category: schema.tenders.noticeCategory,
      count: sql<number>`count(distinct ${schema.tenders.id})::int`,
    })
    .from(schema.tenderMatches)
    .innerJoin(
      schema.alertProfiles,
      eq(schema.alertProfiles.id, schema.tenderMatches.alertProfileId),
    )
    .innerJoin(schema.tenders, eq(schema.tenders.id, schema.tenderMatches.tenderId))
    .leftJoin(
      schema.userTenderStates,
      and(
        eq(schema.userTenderStates.tenderId, schema.tenders.id),
        eq(schema.userTenderStates.userId, userId),
      ),
    )
    .where(
      and(
        eq(schema.alertProfiles.userId, userId),
        isNull(schema.alertProfiles.deletedAt),
        eq(schema.tenderMatches.included, true),
        isNull(schema.tenders.suppressedAt),
        or(isNull(schema.userTenderStates.state), ne(schema.userTenderStates.state, 'dismissed')),
      ),
    )
    .groupBy(schema.tenders.noticeCategory);

  const counts: Record<NoticeCategory, number> = {
    planned: 0,
    competition: 0,
    award: 0,
    other: 0,
  };
  for (const row of rows) counts[row.category] = row.count;
  return counts;
}

// --- helpers ---------------------------------------------------------------

async function cpvCodesFor(
  db: Database,
  tenderIds: readonly string[],
): Promise<Map<string, string[]>> {
  if (tenderIds.length === 0) return new Map();
  const rows = await db
    .select({
      tenderId: schema.tenderCpvCodes.tenderId,
      cpvCode: schema.tenderCpvCodes.cpvCode,
    })
    .from(schema.tenderCpvCodes)
    .where(inArray(schema.tenderCpvCodes.tenderId, [...tenderIds]))
    .orderBy(asc(schema.tenderCpvCodes.cpvCode));
  return groupBy(
    rows,
    (row) => row.tenderId,
    (row) => row.cpvCode,
  );
}

async function regionCodesFor(
  db: Database,
  tenderIds: readonly string[],
): Promise<Map<string, string[]>> {
  if (tenderIds.length === 0) return new Map();
  const rows = await db
    .select({
      tenderId: schema.tenderRegions.tenderId,
      regionCode: schema.tenderRegions.regionCode,
    })
    .from(schema.tenderRegions)
    .where(inArray(schema.tenderRegions.tenderId, [...tenderIds]))
    .orderBy(asc(schema.tenderRegions.regionCode));
  return groupBy(
    rows,
    (row) => row.tenderId,
    (row) => row.regionCode,
  );
}

/** Spec section 25: a card shows the two or three main reasons. */
const CARD_REASON_COUNT = 3;

async function leadingReasonLabels(
  db: Database,
  matchIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byMatch = await reasonRowsFor(db, matchIds);
  const labels = new Map<string, string[]>();
  for (const [matchId, rows] of byMatch) {
    labels.set(
      matchId,
      rows
        .filter((row) => row.entryType === 'reason')
        .slice(0, CARD_REASON_COUNT)
        .map((row) => row.label),
    );
  }
  return labels;
}

interface ReasonRow {
  readonly entryType: 'reason' | 'exclusion';
  readonly typeKey: string;
  readonly label: string;
  readonly evidence: string[];
}

async function reasonRowsFor(
  db: Database,
  matchIds: readonly string[],
): Promise<Map<string, ReasonRow[]>> {
  if (matchIds.length === 0) return new Map();
  const rows = await db
    .select({
      matchId: schema.tenderMatchReasons.matchId,
      entryType: schema.tenderMatchReasons.entryType,
      typeKey: schema.tenderMatchReasons.typeKey,
      label: schema.tenderMatchReasons.label,
      evidence: schema.tenderMatchReasons.evidence,
    })
    .from(schema.tenderMatchReasons)
    .where(inArray(schema.tenderMatchReasons.matchId, [...matchIds]))
    .orderBy(asc(schema.tenderMatchReasons.sortOrder));

  const grouped = new Map<string, ReasonRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.matchId) ?? [];
    list.push({
      entryType: row.entryType,
      typeKey: row.typeKey,
      label: row.label,
      evidence: row.evidence,
    });
    grouped.set(row.matchId, list);
  }
  return grouped;
}

function groupBy<T, V>(
  rows: readonly T[],
  key: (row: T) => string,
  value: (row: T) => V,
): Map<string, V[]> {
  const map = new Map<string, V[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k) ?? [];
    list.push(value(row));
    map.set(k, list);
  }
  return map;
}

/**
 * The significant digits of a CPV filter, for a prefix search.
 *
 * A CPV code is a hierarchy (spec section 11.1): filtering on `45000000` must
 * also return `45213316`. Trailing zeros are where the branch stops being
 * specific, so they are trimmed and the rest becomes a `LIKE` prefix. Returns
 * `undefined` for anything that is not digits, so a filter value cannot become
 * a wildcard.
 */
export function significantCpvDigits(raw: string): string | undefined {
  const digits = raw.trim().replace(/-\d$/, '');
  if (!/^\d{1,8}$/.test(digits)) return undefined;
  const padded = digits.padEnd(8, '0');
  let end = padded.length;
  while (end > 1 && padded[end - 1] === '0') end -= 1;
  return padded.slice(0, end);
}

/** Escapes the `LIKE` metacharacters so a buyer search stays a literal search. */
export function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (character) => `\\${character}`);
}
