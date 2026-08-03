import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { createdAt, primaryId, timestamptz, updatedAt } from './columns.js';
import {
  alertFrequencyEnum,
  criterionModeEnum,
  geographyKindEnum,
  supplierFormEnum,
} from './enums.js';

/**
 * Alert profiles and service templates (spec section 11, ADR-17).
 *
 * A profile is the *only* user-supplied input to matching. Nothing commercial
 * appears in this file, and nothing here may be written by the editorial or
 * attribution layers (ADR-6).
 */

/**
 * Editorial content that pre-fills a profile during onboarding
 * (spec section 11.2). Maintained in admin without a deploy.
 *
 * **A template describes what is delivered, never who buys it** (ADR-17).
 * There is deliberately no buyer-side column here and there must never be one:
 * a cleaning company sells to hospitals, schools, transit operators and the
 * armed forces, and a template that guessed at the buyer would remove most of
 * its own market without saying so.
 *
 * The criteria are array columns rather than child tables: spec section 37
 * names no child tables for templates, a template is edited as a whole
 * document in one admin form, and nothing queries it by individual code.
 *
 * **Soft delete.** Profiles reference the template they were created from for
 * analytics; deleting a retired template would rewrite that history.
 */
export const serviceTemplates = pgTable(
  'service_templates',
  {
    id: primaryId(),
    /** Stable machine key, e.g. `bygg-og-anlegg-utforende`. */
    slug: text('slug').notNull(),
    /** Norwegian display name shown during onboarding. */
    name: text('name').notNull(),
    description: text('description').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),

    /**
     * The one segmentation key (ADR-17 consequence 3). Plain text rather than
     * an enum: the list is editorial and grows, and an enum would turn adding
     * a category into a migration — while the thing that actually needs
     * protecting, the stability of the *existing* keys, is pinned by a test in
     * `@luma/content` rather than by the column type.
     */
    serviceCategory: text('service_category').notNull(),
    /**
     * Weights onboarding and groups analysis. Never read by the matcher —
     * `packages/matching/src/no-sector-assumptions.test.ts` fails if the
     * engine so much as names it.
     */
    supplierForm: supplierFormEnum('supplier_form').notNull(),
    /** One sentence of onboarding guidance. Nullable: admin may not have written one. */
    onboardingHint: text('onboarding_hint'),

    cpvInclude: varchar('cpv_include', { length: 8 }).array().notNull().default([]),
    cpvExclude: varchar('cpv_exclude', { length: 8 }).array().notNull().default([]),
    keywordsInclude: text('keywords_include').array().notNull().default([]),
    keywordsExclude: text('keywords_exclude').array().notNull().default([]),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamptz('deleted_at'),
  },
  (table) => [
    uniqueIndex('service_templates_slug_key').on(table.slug),
    index('service_templates_active_sort_idx').on(table.active, table.sortOrder),
    // Reporting reads by category far more often than by id, and the demand
    // map per category is the whole point of having the column.
    index('service_templates_category_idx').on(table.serviceCategory),
    check('service_templates_slug_format', sql`${table.slug} ~ '^[a-z0-9-]+$'`),
  ],
);

/**
 * A user's statement of which tenders they want to hear about.
 *
 * **Soft delete.** Spec section 11 lets a user pause *and* delete a profile,
 * and a deleted profile still has notification history and feedback pointing
 * at it. `deleted_at` keeps that history readable and makes an accidental
 * deletion recoverable. Deleting the *account* is different: the foreign key
 * below cascades, because at that point the profile is personal data with no
 * remaining lawful purpose.
 */
export const alertProfiles = pgTable(
  'alert_profiles',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      // cascade: a profile is the user's own criteria and nothing else needs it
      // after the account is gone.
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    active: boolean('active').notNull().default(true),
    /**
     * Recorded for analytics only. Spec section 11.2 is explicit that it must
     * not influence matching beyond the values it pre-filled, so the matcher
     * never reads this column.
     */
    serviceTemplateId: uuid('service_template_id').references(() => serviceTemplates.id, {
      // set null: retiring a template must not delete the users' profiles.
      onDelete: 'set null',
    }),

    /** Free-text lists with no hierarchy, so no child table earns its keep. */
    noticeTypes: text('notice_types').array().notNull().default([]),
    procedureTypes: text('procedure_types').array().notNull().default([]),
    /** Spec change log item 33: planned procurements are on by default. */
    includePlannedProcurements: boolean('include_planned_procurements').notNull().default(true),

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
    /** Filters out competitions whose remaining time is too short to bid on. */
    deadlineMinimumDays: smallint('deadline_minimum_days'),

    frequency: alertFrequencyEnum('frequency').notNull().default('daily'),
    digestHourLocal: smallint('digest_hour_local').notNull().default(7),
    /** IANA zone. The digest job resolves the local hour against it. */
    timezone: text('timezone').notNull().default('Europe/Oslo'),
    minimumMatchScore: numeric('minimum_match_score', {
      precision: 5,
      scale: 2,
      mode: 'number',
    })
      .notNull()
      .default(0),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamptz('deleted_at'),
  },
  (table) => [
    index('alert_profiles_user_id_idx').on(table.userId),
    // The digest scheduler sweeps by frequency and local hour every 15 minutes
    // (spec section 38), across all users.
    index('alert_profiles_schedule_idx').on(table.active, table.frequency, table.digestHourLocal),
    check('alert_profiles_digest_hour_range', sql`${table.digestHourLocal} BETWEEN 0 AND 23`),
    check('alert_profiles_minimum_score_range', sql`${table.minimumMatchScore} BETWEEN 0 AND 100`),
    check(
      'alert_profiles_deadline_minimum_days_range',
      sql`${table.deadlineMinimumDays} IS NULL OR ${table.deadlineMinimumDays} BETWEEN 0 AND 365`,
    ),
    // A floor above the ceiling silently excludes every tender. The domain
    // refinement catches it at the API boundary; this catches an admin script.
    check(
      'alert_profiles_value_range_ordered',
      sql`${table.estimatedValueMinNok} IS NULL
          OR ${table.estimatedValueMaxNok} IS NULL
          OR ${table.estimatedValueMinNok} <= ${table.estimatedValueMaxNok}`,
    ),
  ],
);

/**
 * CPV criteria. `mode` distinguishes include from exclude, so spec section
 * 37's single `alert_profile_cpv_codes` table covers both.
 */
export const alertProfileCpvCodes = pgTable(
  'alert_profile_cpv_codes',
  {
    alertProfileId: uuid('alert_profile_id')
      .notNull()
      .references(() => alertProfiles.id, { onDelete: 'cascade' }),
    mode: criterionModeEnum('mode').notNull(),
    cpvCode: varchar('cpv_code', { length: 8 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.alertProfileId, table.mode, table.cpvCode] }),
    index('alert_profile_cpv_codes_code_idx').on(table.cpvCode),
  ],
);

export const alertProfileKeywords = pgTable(
  'alert_profile_keywords',
  {
    alertProfileId: uuid('alert_profile_id')
      .notNull()
      .references(() => alertProfiles.id, { onDelete: 'cascade' }),
    mode: criterionModeEnum('mode').notNull(),
    /** As the user typed it. Shown back as match evidence. */
    keyword: text('keyword').notNull(),
    /**
     * `normalizeSearchText(keyword)` from `@luma/domain`, supplied by the
     * writer. Stored rather than computed in SQL so that the folding rule for
     * æ/ø/å lives in exactly one place, in TypeScript, where it is tested.
     */
    normalizedKeyword: text('normalized_keyword').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.alertProfileId, table.mode, table.normalizedKeyword] }),
    index('alert_profile_keywords_normalized_idx').on(table.normalizedKeyword),
  ],
);

/**
 * Geography criteria. `kind` separates the region level from the municipality
 * level; both are include-only, matching the domain model, which has no
 * `regionsExclude`.
 */
export const alertProfileGeographies = pgTable(
  'alert_profile_geographies',
  {
    alertProfileId: uuid('alert_profile_id')
      .notNull()
      .references(() => alertProfiles.id, { onDelete: 'cascade' }),
    kind: geographyKindEnum('kind').notNull(),
    code: text('code').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.alertProfileId, table.kind, table.code] }),
    index('alert_profile_geographies_code_idx').on(table.kind, table.code),
  ],
);

export const alertProfileBuyers = pgTable(
  'alert_profile_buyers',
  {
    alertProfileId: uuid('alert_profile_id')
      .notNull()
      .references(() => alertProfiles.id, { onDelete: 'cascade' }),
    mode: criterionModeEnum('mode').notNull(),
    buyerName: text('buyer_name').notNull(),
    normalizedBuyerName: text('normalized_buyer_name').notNull(),
    /**
     * Set when the user picked a buyer by organisation number rather than name.
     *
     * Plain `text`, deliberately not `varchar(9)`. This value is compared
     * against `tenders.buyer_organization_number`, and Doffin's buyer
     * identifiers are not all Norwegian nine-digit numbers: observed lengths
     * include 3, 11, 17 and 49 for foreign buyers
     * (docs/doffin-api-findings.md section 9). A nine-character column would
     * make a legitimate foreign buyer unstoreable, and the exclusion the user
     * asked for would silently never fire.
     */
    organizationNumber: text('organization_number'),
  },
  (table) => [
    primaryKey({ columns: [table.alertProfileId, table.mode, table.normalizedBuyerName] }),
    index('alert_profile_buyers_normalized_idx').on(table.normalizedBuyerName),
  ],
);

/**
 * What happened to a profile when the industry templates became service
 * templates (ADR-17).
 *
 * The five old templates map onto the eight new ones, and the map is lossy in
 * two places that no data in the system can settle. `drift-renhold-og-fm`
 * splits into cleaning and property operations, and existing profiles were all
 * sent to the cleaning side. `tekniske-tjenester` has no real successor and
 * was sent to `drift-og-vedlikehold-av-eiendom`. Both are editorial calls made
 * on the user's behalf, without asking them.
 *
 * So the migration does not quietly rewrite the pointer and move on. Every
 * profile it touched is recorded here with the name it was carrying before, so
 * that "which of our users are now filed under a category we guessed at" is a
 * query rather than an archaeology exercise. `needs_review` marks the two
 * judgement calls; the other three are exact renames and are recorded too,
 * because a remap log that only lists the *suspect* rows cannot be used to
 * check its own coverage.
 *
 * **Append-only in intent.** Nothing writes to this table except the
 * migration; a later reclassification is a new row on a new migration, not an
 * update of this one.
 */
export const alertProfileTemplateRemaps = pgTable(
  'alert_profile_template_remaps',
  {
    id: primaryId(),
    alertProfileId: uuid('alert_profile_id')
      .notNull()
      // cascade: the record exists to explain a profile. Without the profile
      // it explains nothing, and it names that profile's owner by reference.
      .references(() => alertProfiles.id, { onDelete: 'cascade' }),
    /**
     * The template row as it stands now. Nullable and `set null`, because the
     * evidence must outlive the template — a retired successor is exactly when
     * someone will need to read this.
     */
    serviceTemplateId: uuid('service_template_id').references(() => serviceTemplates.id, {
      onDelete: 'set null',
    }),
    /** Text, not a foreign key: the old row no longer exists under this name. */
    fromSlug: text('from_slug').notNull(),
    fromName: text('from_name').notNull(),
    toSlug: text('to_slug').notNull(),
    toName: text('to_name').notNull(),
    /** True where no data decided the destination and an editor must confirm it. */
    needsReview: boolean('needs_review').notNull().default(false),
    /** Why this destination, in the words an editor will need to argue with. */
    rationale: text('rationale').notNull(),
    remappedAt: timestamptz('remapped_at').notNull().defaultNow(),
  },
  (table) => [
    index('alert_profile_template_remaps_profile_idx').on(table.alertProfileId),
    // The working query: "what still needs a human?"
    index('alert_profile_template_remaps_review_idx').on(table.needsReview, table.remappedAt),
  ],
);

export const serviceTemplatesRelations = relations(serviceTemplates, ({ many }) => ({
  profiles: many(alertProfiles),
  remaps: many(alertProfileTemplateRemaps),
}));

export const alertProfileTemplateRemapsRelations = relations(
  alertProfileTemplateRemaps,
  ({ one }) => ({
    profile: one(alertProfiles, {
      fields: [alertProfileTemplateRemaps.alertProfileId],
      references: [alertProfiles.id],
    }),
    template: one(serviceTemplates, {
      fields: [alertProfileTemplateRemaps.serviceTemplateId],
      references: [serviceTemplates.id],
    }),
  }),
);

export const alertProfilesRelations = relations(alertProfiles, ({ one, many }) => ({
  user: one(users, { fields: [alertProfiles.userId], references: [users.id] }),
  serviceTemplate: one(serviceTemplates, {
    fields: [alertProfiles.serviceTemplateId],
    references: [serviceTemplates.id],
  }),
  templateRemaps: many(alertProfileTemplateRemaps),
  cpvCodes: many(alertProfileCpvCodes),
  keywords: many(alertProfileKeywords),
  geographies: many(alertProfileGeographies),
  buyers: many(alertProfileBuyers),
}));

export const alertProfileCpvCodesRelations = relations(alertProfileCpvCodes, ({ one }) => ({
  profile: one(alertProfiles, {
    fields: [alertProfileCpvCodes.alertProfileId],
    references: [alertProfiles.id],
  }),
}));

export const alertProfileKeywordsRelations = relations(alertProfileKeywords, ({ one }) => ({
  profile: one(alertProfiles, {
    fields: [alertProfileKeywords.alertProfileId],
    references: [alertProfiles.id],
  }),
}));

export const alertProfileGeographiesRelations = relations(alertProfileGeographies, ({ one }) => ({
  profile: one(alertProfiles, {
    fields: [alertProfileGeographies.alertProfileId],
    references: [alertProfiles.id],
  }),
}));

export const alertProfileBuyersRelations = relations(alertProfileBuyers, ({ one }) => ({
  profile: one(alertProfiles, {
    fields: [alertProfileBuyers.alertProfileId],
    references: [alertProfiles.id],
  }),
}));

export type AlertProfileRow = typeof alertProfiles.$inferSelect;
export type NewAlertProfileRow = typeof alertProfiles.$inferInsert;
export type ServiceTemplateRow = typeof serviceTemplates.$inferSelect;
export type AlertProfileTemplateRemapRow = typeof alertProfileTemplateRemaps.$inferSelect;
