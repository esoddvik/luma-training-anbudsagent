import { inArray } from 'drizzle-orm';
import type { Database } from '@luma/db';
import { tenderCpvCodes, tenderRegions, tenders } from '@luma/db';
import type { Tender } from '@luma/domain';

/**
 * Loading full domain tenders by id, for the jobs that need them.
 *
 * Kept next to the jobs rather than in the API's service layer: the digest and
 * the matcher read tenders for their own reasons and should not acquire an
 * import edge into the HTTP surface to do it.
 */
export async function loadTendersByIds(db: Database, ids: readonly string[]): Promise<Tender[]> {
  if (ids.length === 0) return [];

  const rows = await db
    .select()
    .from(tenders)
    .where(inArray(tenders.id, [...ids]));
  if (rows.length === 0) return [];

  const rowIds = rows.map((row) => row.id);
  const [cpvRows, regionRows] = await Promise.all([
    db.select().from(tenderCpvCodes).where(inArray(tenderCpvCodes.tenderId, rowIds)),
    db.select().from(tenderRegions).where(inArray(tenderRegions.tenderId, rowIds)),
  ]);

  return rows.map((row) => {
    const tender: Tender = {
      id: row.id,
      source: row.source,
      sourceId: row.sourceId,
      sourceUrl: row.sourceUrl,
      title: row.title,
      buyerName: row.buyerName,
      cpvCodes: cpvRows.filter((c) => c.tenderId === row.id).map((c) => c.cpvCode),
      regions: regionRows.filter((r) => r.tenderId === row.id).map((r) => r.regionCode),
      // Doffin exposes no municipality field; see docs/spec-deviations.md.
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
  });
}
