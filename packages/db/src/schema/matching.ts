import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { createdAt, primaryId, timestamptz, updatedAt } from './columns.js';
import { alertProfiles } from './profiles.js';
import { tenders } from './tenders.js';
import {
  feedbackVerdictEnum,
  matchConfidenceEnum,
  matchEntryTypeEnum,
  matchReasonTypeEnum,
  profileSuggestionFieldEnum,
  profileSuggestionOperationEnum,
  profileSuggestionStatusEnum,
  userTenderStateEnum,
} from './enums.js';

/**
 * Match results, per-user tender state and relevance feedback
 * (spec sections 14 to 16).
 *
 * Nothing in this file may be written or read by the editorial, attribution or
 * notification-engagement layers. Course clicks and Påfyll engagement are not
 * inputs to a score (ADR-6), and the absence of any foreign key from
 * `attribution_events` into these tables is what makes that checkable rather
 * than merely stated.
 */

/**
 * One scored evaluation of a tender against a profile, for one version of the
 * algorithm.
 *
 * The score is a statement about fit, never a probability of winning
 * (spec section 4.3).
 */
export const tenderMatches = pgTable(
  'tender_matches',
  {
    id: primaryId(),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id, { onDelete: 'cascade' }),
    alertProfileId: uuid('alert_profile_id')
      .notNull()
      // cascade: a match is meaningless without the criteria that produced it,
      // and it carries no evidence obligation the way consent does.
      .references(() => alertProfiles.id, { onDelete: 'cascade' }),
    score: numeric('score', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    confidence: matchConfidenceEnum('confidence').notNull(),
    /** False when a hard exclusion fired. The row is kept so the user can be told why. */
    included: boolean('included').notNull(),
    /** Same version plus same input must always produce the same result. */
    matchingVersion: text('matching_version').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // Spec section 37: unique match per tender, profile and matching version.
    // Re-running the matcher at the same version is therefore an upsert, which
    // is what keeps a replayed job from generating a second alert.
    uniqueIndex('tender_matches_tender_profile_version_key').on(
      table.tenderId,
      table.alertProfileId,
      table.matchingVersion,
    ),
    // The dashboard and digest query: this profile's matches, best first.
    index('tender_matches_profile_score_idx').on(table.alertProfileId, table.score.desc()),
    // "New matches first" for one profile.
    index('tender_matches_profile_included_created_idx').on(
      table.alertProfileId,
      table.included,
      table.createdAt.desc(),
    ),
    index('tender_matches_tender_id_idx').on(table.tenderId),
    check('tender_matches_score_range', sql`${table.score} BETWEEN 0 AND 100`),
  ],
);

/**
 * The explanation behind a match (spec section 4.2: every match must say why).
 *
 * Both positive reasons and hard exclusions live here, told apart by
 * `entry_type`, because spec section 37 names one table and a user needs to
 * see both sides of the same decision.
 *
 * A reason's `type` is drawn from a fixed enum; an exclusion's is an open
 * string in the domain model. `type_key` therefore holds the string form for
 * both, and `reason_type` holds the enum only for reasons. The check
 * constraint keeps the two columns consistent.
 */
export const tenderMatchReasons = pgTable(
  'tender_match_reasons',
  {
    id: primaryId(),
    matchId: uuid('match_id')
      .notNull()
      .references(() => tenderMatches.id, { onDelete: 'cascade' }),
    entryType: matchEntryTypeEnum('entry_type').notNull(),
    /** The enum value for a reason. Null for an exclusion. */
    reasonType: matchReasonTypeEnum('reason_type'),
    /** String form of the type, for both reasons and exclusions. */
    typeKey: text('type_key').notNull(),
    /** Norwegian, customer-facing. */
    label: text('label').notNull(),
    /** Points this component added. Null for an exclusion. */
    contribution: numeric('contribution', { precision: 6, scale: 2, mode: 'number' }),
    /** The concrete values that caused it: codes, keywords, place names. */
    evidence: text('evidence').array().notNull().default([]),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    index('tender_match_reasons_match_id_idx').on(table.matchId, table.sortOrder),
    check(
      'tender_match_reasons_shape',
      sql`(${table.entryType} = 'reason'
             AND ${table.reasonType} IS NOT NULL
             AND ${table.contribution} IS NOT NULL)
          OR (${table.entryType} = 'exclusion' AND ${table.reasonType} IS NULL)`,
    ),
  ],
);

/**
 * What a user has done with a tender: opened, saved, dismissed
 * (spec section 16).
 */
export const userTenderStates = pgTable(
  'user_tender_states',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      // cascade: this is the person's own reading history.
      .references(() => users.id, { onDelete: 'cascade' }),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id, { onDelete: 'cascade' }),
    state: userTenderStateEnum('state').notNull().default('new'),
    openedAt: timestamptz('opened_at'),
    savedAt: timestamptz('saved_at'),
    dismissedAt: timestamptz('dismissed_at'),
    /** The user's own note on the tender. Personal data; goes with the account. */
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('user_tender_states_user_tender_key').on(table.userId, table.tenderId),
    // The "Lagret" page and the dismissed filter.
    index('user_tender_states_user_state_idx').on(
      table.userId,
      table.state,
      table.updatedAt.desc(),
    ),
  ],
);

/**
 * Relevance feedback (spec section 15).
 *
 * This drives the primary quality metric in section 44.3 — the share of
 * user-rated matches marked relevant — so it must survive things the user
 * does to their profiles.
 */
export const relevanceFeedback = pgTable(
  'relevance_feedback',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      // cascade: feedback is attributable to a person, so account deletion
      // removes it. The quality metric loses a data point; that is the correct
      // trade, because anonymising it well would mean keeping the tender and
      // profile shape, which is close to re-identifying.
      .references(() => users.id, { onDelete: 'cascade' }),
    tenderId: uuid('tender_id')
      .notNull()
      .references(() => tenders.id, { onDelete: 'cascade' }),
    alertProfileId: uuid('alert_profile_id').references(() => alertProfiles.id, {
      // set null: deleting a profile must not erase the quality signal it
      // generated, so the feedback outlives the criteria.
      onDelete: 'set null',
    }),
    verdict: feedbackVerdictEnum('verdict').notNull(),
    comment: text('comment'),
    /** Which algorithm version was being judged. */
    matchingVersion: text('matching_version').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // One verdict per user, tender, profile and algorithm version, so the
    // relevance metric cannot be skewed by a double-click.
    //
    // A unique *constraint* rather than a unique index, because only the
    // constraint form exposes `NULLS NOT DISTINCT`, and that is required here:
    // `alert_profile_id` is nullable, and under the default NULLs-are-distinct
    // rule two verdicts on the same tender from a profile that has since been
    // deleted would both be accepted.
    unique('relevance_feedback_user_tender_profile_version_key')
      .on(table.userId, table.tenderId, table.alertProfileId, table.matchingVersion)
      .nullsNotDistinct(),
    index('relevance_feedback_tender_id_idx').on(table.tenderId),
    index('relevance_feedback_verdict_created_idx').on(table.verdict, table.createdAt.desc()),
  ],
);

/**
 * A profile change derived from feedback (spec section 15).
 *
 * Not in the spec section 37 minimum list, but section 15 requires the system
 * to show what it suggests and to require the user's approval, which needs
 * somewhere to hold a pending suggestion. Feedback never edits a profile on
 * its own.
 */
export const profileSuggestions = pgTable(
  'profile_suggestions',
  {
    id: primaryId(),
    alertProfileId: uuid('alert_profile_id')
      .notNull()
      .references(() => alertProfiles.id, { onDelete: 'cascade' }),
    field: profileSuggestionFieldEnum('field').notNull(),
    operation: profileSuggestionOperationEnum('operation').notNull(),
    value: text('value').notNull(),
    /** Norwegian explanation of why this is suggested. */
    rationale: text('rationale').notNull(),
    status: profileSuggestionStatusEnum('status').notNull().default('pending'),
    decidedAt: timestamptz('decided_at'),
    createdAt: createdAt(),
  },
  (table) => [
    index('profile_suggestions_profile_status_idx').on(table.alertProfileId, table.status),
  ],
);

export const tenderMatchesRelations = relations(tenderMatches, ({ one, many }) => ({
  tender: one(tenders, { fields: [tenderMatches.tenderId], references: [tenders.id] }),
  profile: one(alertProfiles, {
    fields: [tenderMatches.alertProfileId],
    references: [alertProfiles.id],
  }),
  reasons: many(tenderMatchReasons),
}));

export const tenderMatchReasonsRelations = relations(tenderMatchReasons, ({ one }) => ({
  match: one(tenderMatches, {
    fields: [tenderMatchReasons.matchId],
    references: [tenderMatches.id],
  }),
}));

export const userTenderStatesRelations = relations(userTenderStates, ({ one }) => ({
  user: one(users, { fields: [userTenderStates.userId], references: [users.id] }),
  tender: one(tenders, { fields: [userTenderStates.tenderId], references: [tenders.id] }),
}));

export const relevanceFeedbackRelations = relations(relevanceFeedback, ({ one }) => ({
  user: one(users, { fields: [relevanceFeedback.userId], references: [users.id] }),
  tender: one(tenders, { fields: [relevanceFeedback.tenderId], references: [tenders.id] }),
  profile: one(alertProfiles, {
    fields: [relevanceFeedback.alertProfileId],
    references: [alertProfiles.id],
  }),
}));

export const profileSuggestionsRelations = relations(profileSuggestions, ({ one }) => ({
  profile: one(alertProfiles, {
    fields: [profileSuggestions.alertProfileId],
    references: [alertProfiles.id],
  }),
}));

export type TenderMatchRow = typeof tenderMatches.$inferSelect;
export type NewTenderMatchRow = typeof tenderMatches.$inferInsert;
export type TenderMatchReasonRow = typeof tenderMatchReasons.$inferSelect;
export type UserTenderStateRow = typeof userTenderStates.$inferSelect;
export type RelevanceFeedbackRow = typeof relevanceFeedback.$inferSelect;
