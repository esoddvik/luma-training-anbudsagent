import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { JsonValue } from '@luma/domain';
import { createdAt, primaryId, timestamptz, updatedAt } from './columns.js';
import {
  noticeCategoryEnum,
  tenderChangeKindEnum,
  tenderSourceEnum,
  tenderStatusEnum,
} from './enums.js';

/**
 * The normalised tender (spec section 13) and its history.
 *
 * Source-specific field names never appear here. `tenders` is the shape a
 * future `TedApiAdapter` would populate unchanged (ADR-7); everything
 * Doffin-shaped lives inside `raw_payload`.
 *
 * **Deletion policy: no delete.** A tender is public procurement data, not
 * personal data, and matches, notifications and shares all point at it. Admin
 * "suppress an invalid tender" (spec section 45) sets `suppressed_at`, which
 * hides the row from every product surface while leaving the audit trail of
 * what was already sent intact.
 */
export const tenders = pgTable(
  'tenders',
  {
    id: primaryId(),
    source: tenderSourceEnum('source').notNull(),
    /** Stable identifier within the source system. Unique with `source`. */
    sourceId: text('source_id').notNull(),
    /**
     * The source's own publication identifier where it differs from
     * `source_id` (spec section 13). Source-neutral by design (ADR-7).
     */
    noticeId: text('notice_id'),

    /**
     * The eForms notice UUID (`cbc:ID[@schemeName="notice-id"]`).
     *
     * **Persist this from the very first ingest.** Doffin does not update a
     * notice when something changes — it publishes a *new* notice with a new
     * Doffin id, and the only back-reference to what it supersedes is
     * `efac:Changes/efbc:ChangedNoticeIdentifier` in the eForms XML, which
     * names the superseded notice by **this UUID**, not by the Doffin id
     * (docs/doffin-api-findings.md section 6).
     *
     * So without this column, "the deadline moved" is undetectable, and it
     * cannot be repaired by a migration: recovering it means re-downloading
     * the XML for every notice ever ingested. Nullable because it lives only
     * in the XML, and an older or partially ingested row may not have it.
     */
    noticeUuid: text('notice_uuid'),

    /**
     * The eForms `cbc:ContractFolderID`.
     *
     * Groups every notice about one procurement: the planned notice, the
     * competition it becomes, any correction, and the eventual award. Spec
     * section 13's `planned_became_competition` change and the phase-8
     * award/competition join both depend on it, and like `notice_uuid` it is
     * XML-only and impossible to backfill.
     *
     * Nullable: absent on some notice types (an `ADVISORY_NOTICE` was observed
     * without one).
     */
    contractFolderId: text('contract_folder_id'),

    sourceUrl: text('source_url').notNull(),

    title: text('title').notNull(),
    description: text('description'),
    /**
     * The first buyer. Doffin returns an array and 74 of 1000 sampled notices
     * had more than one, so co-purchasers live on in `raw_payload`
     * (docs/doffin-api-findings.md section 9).
     */
    buyerName: text('buyer_name').notNull(),
    /**
     * Not validated as nine digits: foreign buyers produce identifiers of
     * other lengths, and rejecting them would drop real notices.
     */
    buyerOrganizationNumber: text('buyer_organization_number'),

    noticeType: text('notice_type'),
    noticeCategory: noticeCategoryEnum('notice_category').notNull(),
    procedureType: text('procedure_type'),

    /**
     * `numeric`, not a float. Contract values run to hundreds of millions and
     * appear in a value-range filter; binary floating point would make a
     * boundary comparison depend on how the number was parsed.
     *
     * Two caveats from the live source (docs/doffin-api-findings.md section 9),
     * both of which the matcher has to survive:
     *
     * 1. **Doffin publishes a single scalar, not a range.** Spec section 13's
     *    min/max pair has no source. The adapter writes the same value to
     *    both, so a row where they differ came from somewhere else.
     * 2. **It is absent about 47% of the time.** A value filter must treat a
     *    missing value as "unknown", never as zero, or half the corpus
     *    silently drops out of every profile with a value floor.
     */
    estimatedValueMinNok: numeric('estimated_value_min_nok', {
      precision: 18,
      scale: 2,
      mode: 'number',
    }),
    estimatedValueMaxNok: numeric('estimated_value_max_nok', {
      precision: 18,
      scale: 2,
      mode: 'number',
    }),
    /**
     * **Not always NOK.** `PLN` occurs in real Doffin data, and the API
     * supplies no conversion rate. The column names above say `_nok` because
     * spec section 13 does; the currency here is what the value is actually
     * denominated in, and comparing a foreign-currency value against a NOK
     * threshold without converting is a bug, not a rounding error.
     */
    currency: varchar('currency', { length: 3 }),

    /**
     * When the source published the notice.
     *
     * Doffin's `publicationDate` is **date-only** with no time component, so
     * the adapter has to pick and document a timezone convention when it
     * widens that to an instant.
     */
    publishedAt: timestamptz('published_at').notNull(),

    /**
     * **Our observation, not the source's.**
     *
     * Spec section 13 models this as the source's modification timestamp.
     * There is no such field in the Doffin API — no `modifiedAt`, no
     * modified-after filter, no modified sort, in neither the JSON nor the
     * eForms XML (docs/doffin-api-findings.md section 6). So this column means
     * "when *our* ingest last detected a material change", and nothing else.
     *
     * It is therefore **not a sync watermark**. Any incremental fetch that
     * asks the source for "everything modified since this timestamp" is asking
     * for a filter that does not exist; the watermark lives in
     * `ingestion_checkpoints.last_publication_date`.
     */
    modifiedAt: timestamptz('modified_at'),
    /** Null for planned procurements, which have no bid deadline yet. */
    deadlineAt: timestamptz('deadline_at'),

    status: tenderStatusEnum('status').notNull().default('unknown'),

    sourceRevision: text('source_revision'),
    /** Detects a genuine change on re-ingest, so an unchanged fetch is a no-op. */
    sourcePayloadHash: text('source_payload_hash').notNull(),
    /**
     * The unmodified notice from the source.
     *
     * **This column must never contain user data** (spec section 37). It holds
     * exactly what the public procurement source published: buyer, notice text,
     * award details. Nothing about a Luma user — no id, no email, no profile,
     * no match — may be merged into it. Two reasons, and the second is the one
     * that bites: the payload is copied verbatim into `tender_revisions`, and
     * an account deletion has no way to reach inside a JSON blob.
     *
     * Award notices keep their supplier data here so phase 8 can be built
     * without re-ingesting (spec section 13). That works for *who won*:
     * `lots[].winner[].name` and `.organizationId` were present on 219 of 219
     * sampled award notices. It does **not** work for contract duration, which
     * is absent from the JSON entirely and from roughly 80% of award XML
     * (docs/doffin-api-findings.md section 8). No placeholder column is
     * defined for it, because a column that is null four times in five invites
     * a feature that cannot be built. A renewal-date estimate would have to
     * come from the linked competition notice's `PlannedPeriod` by way of
     * `contract_folder_id`, which is a phase-8 design problem, not a column.
     */
    rawPayload: jsonb('raw_payload').$type<JsonValue>().notNull(),

    /** Admin suppression of an invalid notice (spec section 45). Soft, reversible. */
    suppressedAt: timestamptz('suppressed_at'),
    suppressedReason: text('suppressed_reason'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastSyncedAt: timestamptz('last_synced_at').notNull().defaultNow(),
  },
  (table) => [
    // Spec section 37: unique source + source_id. This is what makes the
    // ingest upsert idempotent, and therefore what stops a re-fetched notice
    // producing a second round of alerts (spec section 52 item 5).
    uniqueIndex('tenders_source_source_id_key').on(table.source, table.sourceId),

    // "New matches first" on the dashboard and in the digest.
    index('tenders_published_at_idx').on(table.publishedAt.desc()),
    // Deadline filters and the "deadline is too close to bid" rule.
    index('tenders_deadline_at_idx').on(table.deadlineAt),
    // The planned-procurement tab, which is a category filter with a date sort.
    index('tenders_category_published_at_idx').on(table.noticeCategory, table.publishedAt.desc()),
    // Closing-soon queries and the status sweeper.
    index('tenders_status_deadline_at_idx').on(table.status, table.deadlineAt),
    index('tenders_notice_id_idx').on(table.noticeId),
    // Resolving `efac:Changes/efbc:ChangedNoticeIdentifier` to the notice a
    // correction supersedes. This lookup is the whole point of the column.
    index('tenders_notice_uuid_idx').on(table.noticeUuid),
    // Grouping every notice about one procurement: planned, competition,
    // correction, award.
    index('tenders_contract_folder_id_idx').on(table.contractFolderId),
    index('tenders_buyer_name_idx').on(table.buyerName),
  ],
);

/**
 * CPV codes for a tender, one row per code.
 *
 * A child table rather than a `text[]` column because CPV matching is a
 * hierarchy test (spec section 11.1): "45000000 also matches 45213316" is a
 * prefix query, and a btree index on a scalar column serves that. Spec
 * section 37 names the table.
 */
export const tenderCpvCodes = pgTable(
  'tender_cpv_codes',
  {
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id, { onDelete: 'cascade' }),
    /** Eight digits, check digit stripped by the adapter before insert. */
    cpvCode: varchar('cpv_code', { length: 8 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenderId, table.cpvCode] }),
    index('tender_cpv_codes_cpv_code_idx').on(table.cpvCode),
  ],
);

/**
 * Where the work is to be performed, at NUTS granularity.
 *
 * Two values are not NUTS codes and must be handled explicitly rather than
 * matched as region strings (docs/doffin-api-findings.md section 9):
 * `anyw` means nationwide and appeared on 182 of 1000 sampled notices, and
 * `NOZZZ` means unspecified. Foreign NUTS codes (`FI1D9`) also occur.
 */
export const tenderRegions = pgTable(
  'tender_regions',
  {
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id, { onDelete: 'cascade' }),
    /** NUTS code (`NO081`), or the special values `anyw` and `NOZZZ`. */
    regionCode: text('region_code').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenderId, table.regionCode] }),
    index('tender_regions_region_code_idx').on(table.regionCode),
  ],
);

/**
 * Municipalities for a tender.
 *
 * **Unpopulated in the MVP. This is not a missing ingest step — do not go
 * looking for one.**
 *
 * Spec section 13 models `municipalities`, but the Doffin API exposes no
 * municipality field at all (docs/doffin-api-findings.md section 9). The
 * finest geography available is `locationId`, which is NUTS-3, i.e.
 * county-level, and lands in `tender_regions`. The eForms XML does carry
 * `cbc:CityName`, but that is the *buyer's* postal city rather than the place
 * of performance, so writing it here would be worse than leaving the table
 * empty: profile geography matching would quietly start comparing where the
 * buyer's post arrives against where the work happens.
 *
 * The table exists because spec section 37 and the domain model both name the
 * field, and because a source that does expose municipalities (a future TED
 * adapter, or a Doffin API change) can fill it without a migration. Until then
 * geography matching operates at NUTS-3 and must handle the `anyw` case above.
 *
 * Spec section 37 lists no municipality table of its own; modelling it as a
 * sibling of `tender_regions` rather than as an array column on `tenders` is a
 * judgment call, made so both levels feed the geography matcher the same way.
 */
export const tenderMunicipalities = pgTable(
  'tender_municipalities',
  {
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id, { onDelete: 'cascade' }),
    municipalityCode: text('municipality_code').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenderId, table.municipalityCode] }),
    index('tender_municipalities_code_idx').on(table.municipalityCode),
  ],
);

/**
 * Every distinct payload the source has served for a tender.
 *
 * This is what makes "kildesporbarhet" (spec section 4.5) real: when a user
 * disputes a deadline, the revision that was current when the alert was sent
 * is still on disk.
 */
export const tenderRevisions = pgTable(
  'tender_revisions',
  {
    id: primaryId(),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id, { onDelete: 'cascade' }),
    sourceRevision: text('source_revision'),
    sourcePayloadHash: text('source_payload_hash').notNull(),
    /** Same rule as `tenders.raw_payload`: public source data only, no user data. */
    rawPayload: jsonb('raw_payload').$type<JsonValue>().notNull(),
    fetchedAt: timestamptz('fetched_at').notNull().defaultNow(),
    /** Which ingestion run produced it. Nullable for backfills. */
    ingestionRunId: uuid('ingestion_run_id'),
  },
  (table) => [
    // An unchanged re-fetch must not create a revision. The hash is the
    // identity of the payload, so uniqueness on it makes the write idempotent.
    uniqueIndex('tender_revisions_tender_hash_key').on(table.tenderId, table.sourcePayloadHash),
    index('tender_revisions_tender_fetched_at_idx').on(table.tenderId, table.fetchedAt.desc()),
  ],
);

/**
 * A material change worth telling a user about (spec section 13).
 *
 * Changes that are not on `tenderChangeKindEnum` update the tender row
 * silently and produce no row here.
 */
export const tenderChangeEvents = pgTable(
  'tender_change_events',
  {
    id: primaryId(),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id, { onDelete: 'cascade' }),
    kind: tenderChangeKindEnum('kind').notNull(),
    /** Norwegian, customer-facing. Rendered directly into the change email. */
    summary: text('summary').notNull(),
    previousValue: text('previous_value'),
    currentValue: text('current_value'),
    detectedAt: timestamptz('detected_at').notNull().defaultNow(),
    sourceRevision: text('source_revision'),
  },
  (table) => [
    index('tender_change_events_tender_detected_at_idx').on(
      table.tenderId,
      table.detectedAt.desc(),
    ),
    // The change-notification job sweeps by time across all tenders.
    index('tender_change_events_detected_at_idx').on(table.detectedAt.desc()),
  ],
);

export const tendersRelations = relations(tenders, ({ many }) => ({
  cpvCodes: many(tenderCpvCodes),
  regions: many(tenderRegions),
  municipalities: many(tenderMunicipalities),
  revisions: many(tenderRevisions),
  changeEvents: many(tenderChangeEvents),
}));

export const tenderCpvCodesRelations = relations(tenderCpvCodes, ({ one }) => ({
  tender: one(tenders, { fields: [tenderCpvCodes.tenderId], references: [tenders.id] }),
}));

export const tenderRegionsRelations = relations(tenderRegions, ({ one }) => ({
  tender: one(tenders, { fields: [tenderRegions.tenderId], references: [tenders.id] }),
}));

export const tenderMunicipalitiesRelations = relations(tenderMunicipalities, ({ one }) => ({
  tender: one(tenders, { fields: [tenderMunicipalities.tenderId], references: [tenders.id] }),
}));

export const tenderRevisionsRelations = relations(tenderRevisions, ({ one }) => ({
  tender: one(tenders, { fields: [tenderRevisions.tenderId], references: [tenders.id] }),
}));

export const tenderChangeEventsRelations = relations(tenderChangeEvents, ({ one }) => ({
  tender: one(tenders, { fields: [tenderChangeEvents.tenderId], references: [tenders.id] }),
}));

export type TenderRow = typeof tenders.$inferSelect;
export type NewTenderRow = typeof tenders.$inferInsert;
export type TenderRevisionRow = typeof tenderRevisions.$inferSelect;
export type TenderChangeEventRow = typeof tenderChangeEvents.$inferSelect;
