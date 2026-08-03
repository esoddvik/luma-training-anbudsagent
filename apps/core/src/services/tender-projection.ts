import { and, desc, inArray, isNull } from 'drizzle-orm';
import {
  tenderCpvCodes,
  tenderMunicipalities,
  tenderRegions,
  tenders,
  type Database,
} from '@luma/db';
import type { Tender } from '@luma/domain';

/**
 * Turning tender rows back into the domain model.
 *
 * The matching engine takes `Tender`, not a database row, and so does the
 * shared-view projection. Assembling that object in one place means the
 * preview endpoint and the scheduled matching job cannot disagree about what a
 * tender is — a disagreement that would show up as a preview promising matches
 * the digest never delivers.
 */

export function toDomainTender(
  row: typeof tenders.$inferSelect,
  cpvCodes: readonly string[],
  regions: readonly string[],
  municipalities: readonly string[],
): Tender {
  const tender: Tender = {
    id: row.id,
    source: row.source,
    sourceId: row.sourceId,
    sourceUrl: row.sourceUrl,
    title: row.title,
    buyerName: row.buyerName,
    cpvCodes: [...cpvCodes],
    regions: [...regions],
    municipalities: [...municipalities],
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
  if (row.buyerOrganizationNumber) tender.buyerOrganizationNumber = row.buyerOrganizationNumber;
  if (row.noticeType) tender.noticeType = row.noticeType;
  if (row.procedureType) tender.procedureType = row.procedureType;
  if (row.estimatedValueMinNok !== null) tender.estimatedValueMinNok = row.estimatedValueMinNok;
  if (row.estimatedValueMaxNok !== null) tender.estimatedValueMaxNok = row.estimatedValueMaxNok;
  if (row.currency) tender.currency = row.currency;
  if (row.modifiedAt) tender.modifiedAt = row.modifiedAt;
  if (row.deadlineAt) tender.deadlineAt = row.deadlineAt;
  if (row.sourceRevision) tender.sourceRevision = row.sourceRevision;

  return tender;
}

/** Loads the child rows for a set of tenders in three queries, not 3 × N. */
export async function loadTenderChildren(
  db: Database,
  ids: readonly string[],
): Promise<{
  cpv: Map<string, string[]>;
  regions: Map<string, string[]>;
  municipalities: Map<string, string[]>;
}> {
  const empty = { cpv: new Map(), regions: new Map(), municipalities: new Map() };
  if (ids.length === 0) return empty;
  const list = [...ids];

  const [cpvRows, regionRows, municipalityRows] = await Promise.all([
    db.select().from(tenderCpvCodes).where(inArray(tenderCpvCodes.tenderId, list)),
    db.select().from(tenderRegions).where(inArray(tenderRegions.tenderId, list)),
    db.select().from(tenderMunicipalities).where(inArray(tenderMunicipalities.tenderId, list)),
  ]);

  const group = <T>(rows: T[], key: (row: T) => string, value: (row: T) => string) => {
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const bucket = map.get(key(row));
      if (bucket) bucket.push(value(row));
      else map.set(key(row), [value(row)]);
    }
    return map;
  };

  return {
    cpv: group(
      cpvRows,
      (row) => row.tenderId,
      (row) => row.cpvCode,
    ),
    regions: group(
      regionRows,
      (row) => row.tenderId,
      (row) => row.regionCode,
    ),
    municipalities: group(
      municipalityRows,
      (row) => row.tenderId,
      (row) => row.municipalityCode,
    ),
  };
}

export async function hydrateTenders(
  db: Database,
  rows: readonly (typeof tenders.$inferSelect)[],
): Promise<Tender[]> {
  const children = await loadTenderChildren(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) =>
    toDomainTender(
      row,
      children.cpv.get(row.id) ?? [],
      children.regions.get(row.id) ?? [],
      children.municipalities.get(row.id) ?? [],
    ),
  );
}

/**
 * The most recently published tenders, suppressed ones excluded.
 *
 * Used by the profile preview. A suppressed tender is one an administrator has
 * declared invalid (spec §45), and showing it in a preview would advertise a
 * match the user will never actually be sent.
 */
export async function loadTendersForMatching(
  db: Database,
  options: { limit: number; tenderIds?: readonly string[] },
): Promise<Tender[]> {
  const rows = await db
    .select()
    .from(tenders)
    .where(
      options.tenderIds && options.tenderIds.length > 0
        ? and(inArray(tenders.id, [...options.tenderIds]), isNull(tenders.suppressedAt))
        : isNull(tenders.suppressedAt),
    )
    .orderBy(desc(tenders.publishedAt), desc(tenders.id))
    .limit(options.limit);

  return hydrateTenders(db, rows);
}
