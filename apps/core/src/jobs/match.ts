import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '@luma/db';
import {
  alertProfileBuyers,
  alertProfileCpvCodes,
  alertProfileGeographies,
  alertProfileKeywords,
  alertProfiles,
  tenderCpvCodes,
  tenderMatchReasons,
  tenderMatches,
  tenderRegions,
  tenders,
} from '@luma/db';
import type { AlertProfile, Tender } from '@luma/domain';
import { matchTender, MATCHING_VERSION } from '@luma/matching';
import type { Logger } from '@luma/observability';

/**
 * Running matching over ingested tenders and storing the result (spec §14).
 *
 * Matching itself lives in `@luma/matching` and is pure. This module is only
 * the plumbing: load the tenders and the active profiles, call the engine, and
 * persist the outcome together with the reasons behind it.
 *
 * The reasons are stored, not recomputed on read, because spec §14 requires a
 * match to be explainable at the version it was calculated under. Weights can
 * change; an explanation shown to a user in June must still say what it said
 * in June.
 */

export interface MatchJobOptions {
  db: Database;
  logger: Logger;
  now: Date;
  /** Restricts the run to specific tenders. Omit to match everything current. */
  tenderIds?: readonly string[];
  /** Restricts the run to one profile, used by the profile preview. */
  alertProfileId?: string;
}

export interface MatchJobReport {
  tendersConsidered: number;
  profilesConsidered: number;
  matchesWritten: number;
  included: number;
}

interface ProfileRow {
  profile: AlertProfile;
}

/** Assembles a domain `AlertProfile` from its row and its child tables. */
async function loadProfiles(db: Database, alertProfileId?: string): Promise<ProfileRow[]> {
  const rows = await db
    .select()
    .from(alertProfiles)
    .where(
      alertProfileId
        ? and(eq(alertProfiles.id, alertProfileId), isNull(alertProfiles.deletedAt))
        : and(eq(alertProfiles.active, true), isNull(alertProfiles.deletedAt)),
    );

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [cpv, keywords, geographies, buyers] = await Promise.all([
    db.select().from(alertProfileCpvCodes).where(inArray(alertProfileCpvCodes.alertProfileId, ids)),
    db.select().from(alertProfileKeywords).where(inArray(alertProfileKeywords.alertProfileId, ids)),
    db
      .select()
      .from(alertProfileGeographies)
      .where(inArray(alertProfileGeographies.alertProfileId, ids)),
    db.select().from(alertProfileBuyers).where(inArray(alertProfileBuyers.alertProfileId, ids)),
  ]);

  return rows.map((row) => {
    const own = <T extends { alertProfileId: string }>(list: T[]) =>
      list.filter((entry) => entry.alertProfileId === row.id);

    const profile: AlertProfile = {
      id: row.id,
      userId: row.userId,
      name: row.name,
      active: row.active,
      cpvInclude: own(cpv)
        .filter((c) => c.mode === 'include')
        .map((c) => c.cpvCode),
      cpvExclude: own(cpv)
        .filter((c) => c.mode === 'exclude')
        .map((c) => c.cpvCode),
      keywordsInclude: own(keywords)
        .filter((k) => k.mode === 'include')
        .map((k) => k.keyword),
      keywordsExclude: own(keywords)
        .filter((k) => k.mode === 'exclude')
        .map((k) => k.keyword),
      regionsInclude: own(geographies)
        .filter((g) => g.kind === 'region')
        .map((g) => g.code),
      municipalitiesInclude: own(geographies)
        .filter((g) => g.kind === 'municipality')
        .map((g) => g.code),
      buyerInclude: own(buyers)
        .filter((b) => b.mode === 'include')
        .map((b) => b.buyerName),
      buyerExclude: own(buyers)
        .filter((b) => b.mode === 'exclude')
        .map((b) => b.buyerName),
      noticeTypes: row.noticeTypes,
      includePlannedProcurements: row.includePlannedProcurements,
      procedureTypes: row.procedureTypes,
      frequency: row.frequency,
      digestHourLocal: row.digestHourLocal,
      timezone: row.timezone,
      minimumMatchScore: row.minimumMatchScore,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    if (row.description) profile.description = row.description;
    if (row.serviceTemplateId) profile.serviceTemplateId = row.serviceTemplateId;
    if (row.estimatedValueMinNok !== null) {
      profile.estimatedValueMinNok = row.estimatedValueMinNok;
    }
    if (row.estimatedValueMaxNok !== null) {
      profile.estimatedValueMaxNok = row.estimatedValueMaxNok;
    }
    if (row.deadlineMinimumDays !== null) {
      profile.deadlineMinimumDays = row.deadlineMinimumDays;
    }

    return { profile };
  });
}

/** Assembles domain `Tender` objects from their rows and child tables. */
async function loadTenders(db: Database, tenderIds?: readonly string[]): Promise<Tender[]> {
  const rows = await db
    .select()
    .from(tenders)
    .where(
      tenderIds && tenderIds.length > 0
        ? and(inArray(tenders.id, [...tenderIds]), isNull(tenders.suppressedAt))
        : isNull(tenders.suppressedAt),
    );

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [cpv, regions] = await Promise.all([
    db.select().from(tenderCpvCodes).where(inArray(tenderCpvCodes.tenderId, ids)),
    db.select().from(tenderRegions).where(inArray(tenderRegions.tenderId, ids)),
  ]);

  return rows.map((row) => {
    const tender: Tender = {
      id: row.id,
      source: row.source,
      sourceId: row.sourceId,
      sourceUrl: row.sourceUrl,
      title: row.title,
      buyerName: row.buyerName,
      cpvCodes: cpv.filter((c) => c.tenderId === row.id).map((c) => c.cpvCode),
      regions: regions.filter((r) => r.tenderId === row.id).map((r) => r.regionCode),
      municipalities: [],
      noticeCategory: row.noticeCategory,
      publishedAt: row.publishedAt,
      status: row.status,
      sourcePayloadHash: row.sourcePayloadHash,
      rawPayload: row.rawPayload,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastSyncedAt: row.lastSyncedAt,
    };

    if (row.noticeId) tender.noticeId = row.noticeId;
    if (row.description) tender.description = row.description;
    if (row.buyerOrganizationNumber) {
      tender.buyerOrganizationNumber = row.buyerOrganizationNumber;
    }
    if (row.noticeType) tender.noticeType = row.noticeType;
    if (row.procedureType) tender.procedureType = row.procedureType;
    if (row.estimatedValueMinNok !== null) {
      tender.estimatedValueMinNok = row.estimatedValueMinNok;
    }
    if (row.estimatedValueMaxNok !== null) {
      tender.estimatedValueMaxNok = row.estimatedValueMaxNok;
    }
    if (row.currency) tender.currency = row.currency;
    if (row.modifiedAt) tender.modifiedAt = row.modifiedAt;
    if (row.deadlineAt) tender.deadlineAt = row.deadlineAt;
    if (row.sourceRevision) tender.sourceRevision = row.sourceRevision;

    return tender;
  });
}

export async function runMatching(options: MatchJobOptions): Promise<MatchJobReport> {
  const { db, logger, now } = options;

  const [profiles, tenderList] = await Promise.all([
    loadProfiles(db, options.alertProfileId),
    loadTenders(db, options.tenderIds),
  ]);

  if (profiles.length === 0 || tenderList.length === 0) {
    return {
      tendersConsidered: tenderList.length,
      profilesConsidered: profiles.length,
      matchesWritten: 0,
      included: 0,
    };
  }

  let matchesWritten = 0;
  let included = 0;

  for (const { profile } of profiles) {
    for (const tender of tenderList) {
      const result = matchTender(tender, profile, { now });

      // Every evaluation is stored, including the excluded ones. Support needs
      // to be able to answer "why did I not get this tender", and that
      // question is unanswerable if only the hits are kept.
      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(tenderMatches)
          .values({
            tenderId: tender.id,
            alertProfileId: profile.id,
            score: result.score,
            confidence: result.confidence,
            included: result.included,
            matchingVersion: result.matchingVersion,
          })
          .onConflictDoUpdate({
            target: [
              tenderMatches.tenderId,
              tenderMatches.alertProfileId,
              tenderMatches.matchingVersion,
            ],
            set: {
              score: result.score,
              confidence: result.confidence,
              included: result.included,
            },
          })
          .returning({ id: tenderMatches.id });

        const matchId = inserted[0]?.id;
        if (!matchId) return;

        // Replaced wholesale: a reason that no longer applies must disappear,
        // not linger next to the reasons that do.
        await tx.delete(tenderMatchReasons).where(eq(tenderMatchReasons.matchId, matchId));

        const rows = [
          ...result.reasons.map((reason, index) => ({
            matchId,
            entryType: 'reason' as const,
            reasonType: reason.type,
            typeKey: reason.type,
            label: reason.label,
            contribution: reason.contribution,
            evidence: reason.evidence,
            sortOrder: index,
          })),
          ...result.exclusions.map((exclusion, index) => ({
            matchId,
            entryType: 'exclusion' as const,
            reasonType: null,
            typeKey: exclusion.type,
            label: exclusion.label,
            contribution: null,
            evidence: exclusion.evidence,
            sortOrder: result.reasons.length + index,
          })),
        ];

        if (rows.length > 0) await tx.insert(tenderMatchReasons).values(rows);
      });

      matchesWritten += 1;
      if (result.included) included += 1;
    }
  }

  logger.info(
    {
      tenders: tenderList.length,
      profiles: profiles.length,
      matchesWritten,
      included,
      matchingVersion: MATCHING_VERSION,
    },
    'matching run complete',
  );

  return {
    tendersConsidered: tenderList.length,
    profilesConsidered: profiles.length,
    matchesWritten,
    included,
  };
}

/** Included matches for one profile, newest first. Used by the digest. */
export async function includedMatchesForProfile(
  db: Database,
  alertProfileId: string,
  limit = 50,
): Promise<Array<{ tenderId: string; score: number; confidence: string }>> {
  return db
    .select({
      tenderId: tenderMatches.tenderId,
      score: tenderMatches.score,
      confidence: tenderMatches.confidence,
    })
    .from(tenderMatches)
    .where(and(eq(tenderMatches.alertProfileId, alertProfileId), eq(tenderMatches.included, true)))
    .orderBy(sql`${tenderMatches.score} desc`)
    .limit(limit);
}
