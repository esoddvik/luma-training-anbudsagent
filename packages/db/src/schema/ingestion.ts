import { relations } from 'drizzle-orm';
import { date, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { JsonValue } from '@luma/domain';
import { users } from './auth.js';
import { createdAt, primaryId, timestamptz, updatedAt } from './columns.js';
import { ingestionRunStatusEnum, ingestionTriggerEnum, tenderSourceEnum } from './enums.js';

/**
 * Ingestion bookkeeping (spec sections 12 and 45).
 *
 * The admin dashboard's first line is "last successful Doffin sync, with counts
 * fetched, created, updated and failed", so those counts are columns rather
 * than something reconstructed from logs.
 */
export const ingestionRuns = pgTable(
  'ingestion_runs',
  {
    id: primaryId(),
    source: tenderSourceEnum('source').notNull(),
    status: ingestionRunStatusEnum('status').notNull().default('running'),
    trigger: ingestionTriggerEnum('trigger').notNull().default('schedule'),
    triggeredByAdminId: uuid('triggered_by_admin_id').references(() => users.id, {
      // set null: operational history outlives the operator's account.
      onDelete: 'set null',
    }),

    /**
     * The overlapping publication-date window the run covered (spec section 12
     * step 2). Timestamps rather than dates because a run's window is bounded
     * by when it actually started and stopped paging.
     */
    windowFrom: timestamptz('window_from'),
    windowTo: timestamptz('window_to'),

    fetchedCount: integer('fetched_count').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    unchangedCount: integer('unchanged_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    matchJobsEnqueued: integer('match_jobs_enqueued').notNull().default(0),

    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    errorMessage: text('error_message'),
  },
  (table) => [
    // Spec: ingestion runs by started_at. The dashboard's default query.
    index('ingestion_runs_started_at_idx').on(table.startedAt.desc()),
    // "Last successful sync for this source."
    index('ingestion_runs_source_status_started_idx').on(
      table.source,
      table.status,
      table.startedAt.desc(),
    ),
  ],
);

/**
 * The high-water mark per source (spec section 12 step 1).
 *
 * One row per source, so the source is the primary key: a second checkpoint
 * for the same source would be a silent correctness bug, and this makes it
 * unrepresentable.
 *
 * Spec section 12 is explicit that the checkpoint must not advance after a
 * partial failure. That is a job-level rule, not something a column can
 * enforce, but `last_successful_run_id` makes a violation visible: it should
 * always point at a run whose status is `succeeded`.
 *
 * **The watermark is a publication date, not a modification timestamp.** Spec
 * section 12 assumes a "modified after" cursor. The Doffin API has no such
 * field, filter or sort (docs/doffin-api-findings.md section 6), so the sync
 * pages backwards through `PUBLICATION_DATE_DESC` and stops when it reaches
 * `last_publication_date` minus an overlap. The column is named for what it
 * actually holds so that nobody writes `WHERE modified > checkpoint` against a
 * source that cannot answer it.
 */
export const ingestionCheckpoints = pgTable('ingestion_checkpoints', {
  source: tenderSourceEnum('source').primaryKey(),
  lastSuccessfulRunId: uuid('last_successful_run_id').references(() => ingestionRuns.id, {
    onDelete: 'set null',
  }),
  /**
   * The newest `publicationDate` fully covered by a successful run.
   *
   * A `date`, not a timestamp, because Doffin's `publicationDate` is date-only
   * with no time component. Storing it as an instant would invent a precision
   * the source does not have and make the overlap arithmetic depend on the
   * server's timezone.
   */
  lastPublicationDate: date('last_publication_date', { mode: 'string' }),
  /**
   * Days of overlap re-fetched on every run, so a late publication is not
   * missed.
   *
   * Defaults to 10: `publicationDate` trails `issueDate` by up to 7 days in
   * observed data, and at roughly 32 notices a day a 10-day window is about
   * 320 notices, well inside the API's 1000-hit ceiling. A column rather than
   * a constant so the window can be widened during an incident without a
   * deploy.
   */
  overlapDays: integer('overlap_days').notNull().default(10),
  /** Opaque source cursor, when the source paginates by one. */
  cursor: text('cursor'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * A single failed notice within a run, so a partial failure is diagnosable
 * without re-running the whole window (spec section 45).
 */
export const ingestionErrors = pgTable(
  'ingestion_errors',
  {
    id: primaryId(),
    runId: uuid('run_id')
      .notNull()
      .references(() => ingestionRuns.id, { onDelete: 'cascade' }),
    /** The source's identifier for the notice that failed, when known. */
    sourceId: text('source_id'),
    /** Which step it failed at: fetch, normalize, upsert. */
    stage: text('stage').notNull(),
    message: text('message').notNull(),
    /**
     * The offending fragment. Same rule as `tenders.raw_payload`: this is
     * public source data only and must never contain user data.
     */
    payload: jsonb('payload').$type<JsonValue>(),
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('ingestion_errors_run_occurred_idx').on(table.runId, table.occurredAt),
    index('ingestion_errors_source_id_idx').on(table.sourceId),
  ],
);

export const ingestionRunsRelations = relations(ingestionRuns, ({ many }) => ({
  errors: many(ingestionErrors),
}));

export const ingestionErrorsRelations = relations(ingestionErrors, ({ one }) => ({
  run: one(ingestionRuns, { fields: [ingestionErrors.runId], references: [ingestionRuns.id] }),
}));

export type IngestionRunRow = typeof ingestionRuns.$inferSelect;
export type NewIngestionRunRow = typeof ingestionRuns.$inferInsert;
export type IngestionCheckpointRow = typeof ingestionCheckpoints.$inferSelect;
export type IngestionErrorRow = typeof ingestionErrors.$inferSelect;
