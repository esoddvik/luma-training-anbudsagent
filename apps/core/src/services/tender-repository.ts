import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '@luma/db';
import {
  tenderChangeEvents,
  tenderCpvCodes,
  tenderRegions,
  tenderRevisions,
  tenders,
} from '@luma/db';
import type { NormalizedTender } from '@luma/doffin';
import { detectChanges, type ComparableTender, type DetectedChange } from './change-detection.js';

/**
 * Persisting ingested tenders (spec §12 steps 4 to 8).
 *
 * The one property this module exists to guarantee is **idempotent upsert**:
 * re-running a sync over data that has not changed must produce no writes that
 * anything downstream can observe, and above all must not enqueue a second
 * match job or a second notification. Spec §52 item 5 states it as an
 * acceptance criterion — duplicates must not cause duplicate alerts.
 *
 * The payload hash is what makes that cheap. It is computed over the source
 * payload with object keys sorted, so an identical notice hashes identically
 * regardless of how the API happened to order its JSON.
 */

export type UpsertOutcome = 'created' | 'updated' | 'unchanged';

export interface UpsertResult {
  tenderId: string;
  outcome: UpsertOutcome;
  changes: DetectedChange[];
}

function toComparable(row: {
  title: string;
  description: string | null;
  buyerName: string;
  noticeCategory: ComparableTender['noticeCategory'];
  status: ComparableTender['status'];
  deadlineAt: Date | null;
  estimatedValueMinNok: number | null;
  procedureType: string | null;
  cpvCodes: readonly string[];
}): ComparableTender {
  return {
    title: row.title,
    description: row.description,
    buyerName: row.buyerName,
    noticeCategory: row.noticeCategory,
    status: row.status,
    deadlineAt: row.deadlineAt,
    estimatedValueMinNok: row.estimatedValueMinNok,
    procedureType: row.procedureType,
    cpvCodes: row.cpvCodes,
  };
}

/**
 * Inserts or updates one normalised tender.
 *
 * Runs in a single transaction: a tender row, its CPV and region child rows,
 * its revision and its change events must all land together, or a crash
 * halfway through would leave a tender whose codes disagree with its payload
 * and whose change history has a hole.
 */
export async function upsertTender(
  db: Database,
  normalized: NormalizedTender,
  options: { ingestionRunId?: string } = {},
): Promise<UpsertResult> {
  const incoming = normalized.tender;

  return db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(tenders)
      .where(and(eq(tenders.source, incoming.source), eq(tenders.sourceId, incoming.sourceId)))
      .limit(1);
    const existing = existingRows[0];

    const values = {
      source: incoming.source,
      sourceId: incoming.sourceId,
      noticeId: incoming.noticeId ?? null,
      noticeUuid: normalized.noticeUuid ?? null,
      contractFolderId: normalized.contractFolderId ?? null,
      sourceUrl: incoming.sourceUrl,
      title: incoming.title,
      description: incoming.description ?? null,
      buyerName: incoming.buyerName,
      buyerOrganizationNumber: incoming.buyerOrganizationNumber ?? null,
      noticeType: incoming.noticeType ?? null,
      noticeCategory: incoming.noticeCategory,
      procedureType: incoming.procedureType ?? null,
      estimatedValueMinNok: incoming.estimatedValueMinNok ?? null,
      estimatedValueMaxNok: incoming.estimatedValueMaxNok ?? null,
      currency: incoming.currency ?? null,
      publishedAt: incoming.publishedAt,
      deadlineAt: incoming.deadlineAt ?? null,
      status: incoming.status,
      sourceRevision: incoming.sourceRevision ?? null,
      sourcePayloadHash: incoming.sourcePayloadHash,
      rawPayload: incoming.rawPayload,
      lastSyncedAt: incoming.lastSyncedAt,
    };

    if (!existing) {
      const inserted = await tx.insert(tenders).values(values).returning({ id: tenders.id });
      const tenderId = inserted[0]?.id;
      if (!tenderId) throw new Error('insert returned no tender id');

      await writeChildRows(tx, tenderId, incoming.cpvCodes, incoming.regions);
      await insertRevision(tx, tenderId, incoming, options.ingestionRunId);

      return { tenderId, outcome: 'created' as const, changes: [] };
    }

    // The cheap path, and by far the most common one: the overlap window
    // re-reads roughly ten days of notices on every run, so most rows here are
    // byte-identical to what is already stored.
    if (existing.sourcePayloadHash === incoming.sourcePayloadHash) {
      await tx
        .update(tenders)
        .set({ lastSyncedAt: incoming.lastSyncedAt })
        .where(eq(tenders.id, existing.id));
      return { tenderId: existing.id, outcome: 'unchanged' as const, changes: [] };
    }

    const existingCpv = await tx
      .select({ code: tenderCpvCodes.cpvCode })
      .from(tenderCpvCodes)
      .where(eq(tenderCpvCodes.tenderId, existing.id));

    const changes = detectChanges(
      toComparable({ ...existing, cpvCodes: existingCpv.map((row) => row.code) }),
      toComparable({ ...values, cpvCodes: incoming.cpvCodes }),
    );

    await tx
      .update(tenders)
      .set({
        ...values,
        // Our own observation of when the tender last changed, not the
        // source's: Doffin publishes no modification timestamp at all.
        modifiedAt: changes.length > 0 ? incoming.lastSyncedAt : existing.modifiedAt,
        updatedAt: incoming.lastSyncedAt,
      })
      .where(eq(tenders.id, existing.id));

    await writeChildRows(tx, existing.id, incoming.cpvCodes, incoming.regions);

    await insertRevision(tx, existing.id, incoming, options.ingestionRunId);

    if (changes.length > 0) {
      await tx.insert(tenderChangeEvents).values(
        changes.map((change) => ({
          tenderId: existing.id,
          kind: change.kind,
          summary: change.summary,
          previousValue: change.previousValue ?? null,
          currentValue: change.currentValue ?? null,
          sourceRevision: incoming.sourceRevision ?? null,
        })),
      );
    }

    return { tenderId: existing.id, outcome: 'updated' as const, changes };
  });
}

/**
 * Records the payload we just saw, if we do not already hold it.
 *
 * `onConflictDoNothing`, and the reason is worth stating because the schema
 * comment on `tender_revisions_tender_hash_key` already claimed this behaviour
 * before the code delivered it: "the hash is the identity of the payload, so
 * uniqueness on it makes the write idempotent". The constraint enforced that
 * by *raising*, and no caller caught it — so the guard intended to make a
 * re-fetch harmless was instead the thing that failed the run.
 *
 * The consequences ran a long way from here. A failed row makes `runIngest`
 * report `partial`; `partial` means the checkpoint is not advanced, by design,
 * so that a run which lost notices cannot skip past them forever. Correct on
 * its own — but with a *systematic* duplicate it meant the checkpoint never
 * advanced at all, and the ingest re-read one window indefinitely while
 * appearing to work. Eighteen consecutive runs, empty `ingestion_checkpoints`.
 *
 * The unstable hash that produced the duplicates is fixed in
 * `@luma/doffin`'s `hashPayload`. This is the second line: even with a source
 * that reorders arrays, or a future one that does something else surprising,
 * re-recording a payload we already have is a no-op rather than an outage.
 * Storing the same revision twice is not possible and is not desirable, so
 * there is nothing here to fall back to — the row exists either way.
 */
async function insertRevision(
  tx: Database,
  tenderId: string,
  incoming: { sourceRevision?: string | undefined; sourcePayloadHash: string; rawPayload: unknown },
  ingestionRunId: string | undefined,
): Promise<void> {
  await tx
    .insert(tenderRevisions)
    .values({
      tenderId,
      sourceRevision: incoming.sourceRevision ?? null,
      sourcePayloadHash: incoming.sourcePayloadHash,
      rawPayload: incoming.rawPayload as never,
      ingestionRunId: ingestionRunId ?? null,
    })
    .onConflictDoNothing({
      target: [tenderRevisions.tenderId, tenderRevisions.sourcePayloadHash],
    });
}

/**
 * Replaces the CPV and region child rows.
 *
 * Delete-then-insert rather than a diff: the lists are short, and a diff would
 * have to handle a code moving position, which carries no meaning here and
 * would only add a way to get it wrong.
 */
async function writeChildRows(
  tx: Database,
  tenderId: string,
  cpvCodes: readonly string[],
  regions: readonly string[],
): Promise<void> {
  await tx.delete(tenderCpvCodes).where(eq(tenderCpvCodes.tenderId, tenderId));
  await tx.delete(tenderRegions).where(eq(tenderRegions.tenderId, tenderId));

  const uniqueCpv = [...new Set(cpvCodes)];
  if (uniqueCpv.length > 0) {
    await tx.insert(tenderCpvCodes).values(uniqueCpv.map((cpvCode) => ({ tenderId, cpvCode })));
  }

  const uniqueRegions = [...new Set(regions)];
  if (uniqueRegions.length > 0) {
    await tx
      .insert(tenderRegions)
      .values(uniqueRegions.map((regionCode) => ({ tenderId, regionCode })));
  }
}

/** Counts by outcome, for the ingestion run record the admin dashboard reads. */
export function summarizeOutcomes(results: readonly UpsertResult[]): {
  created: number;
  updated: number;
  unchanged: number;
} {
  return {
    created: results.filter((r) => r.outcome === 'created').length,
    updated: results.filter((r) => r.outcome === 'updated').length,
    unchanged: results.filter((r) => r.outcome === 'unchanged').length,
  };
}

/** Tenders that changed materially, so a notification job can pick them up. */
export function notifiableTenderIds(results: readonly UpsertResult[]): string[] {
  return results.filter((r) => r.changes.length > 0).map((r) => r.tenderId);
}

/** Used by the readiness probe; kept here so the SQL lives with the schema use. */
export async function countTenders(db: Database): Promise<number> {
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(tenders);
  return rows[0]?.count ?? 0;
}
