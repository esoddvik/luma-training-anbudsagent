import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { createdAt, primaryId, timestamptz, updatedAt } from './columns.js';
import {
  consentSourceEnum,
  consentStatusEnum,
  consentTypeEnum,
  legalDocumentKindEnum,
} from './enums.js';

/**
 * Consent and legal acceptance (spec sections 19 to 21, ADR-9 and ADR-11).
 *
 * Under GDPR, consent is not a current state — it is a claim about a past
 * event the controller must be able to demonstrate. Everything in this file
 * follows from that: nothing is overwritten, the literal Norwegian wording the
 * user saw is captured by reference, and every event names its source.
 *
 * The immutability rule is not left to convention. Migration
 * `0001_append_only_consent_guard.sql` installs a trigger that raises on any
 * `DELETE`, and on any `UPDATE` other than the account-deletion severing
 * described below. That trigger is the ADR-9 verification hook, and
 * `consent-immutability.integration.test.ts` proves it fires.
 */

/**
 * The literal wording a user was shown, versioned.
 *
 * ADR-9 rule 3: changing the wording creates a new version and never edits an
 * existing one, because an edited row would silently rewrite what thousands of
 * people are recorded as having agreed to.
 */
export const consentTextVersions = pgTable(
  'consent_text_versions',
  {
    id: primaryId(),
    consentType: consentTypeEnum('consent_type').notNull(),
    /** Matches `CURRENT_MARKETING_CONSENT_TEXT_VERSION` and friends. */
    version: text('version').notNull(),
    /** Norwegian bokmål, exactly as rendered next to the checkbox. */
    body: text('body').notNull(),
    effectiveFrom: timestamptz('effective_from').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // The composite key that `consent_events` references.
    //
    // A unique *constraint* rather than a unique index, and that is load
    // bearing: drizzle-kit emits `CREATE TABLE`, then the foreign keys, then
    // the indexes. A composite foreign key pointing at a unique index would be
    // added before the index exists, and the migration fails with "there is no
    // unique constraint matching given keys". A constraint is emitted inline
    // with the table.
    unique('consent_text_versions_type_version_key').on(table.consentType, table.version),
  ],
);

/**
 * The append-only consent log (spec section 21, ADR-9).
 *
 * Insert only. Withdrawal inserts a `withdrawn` row; re-granting inserts a new
 * `granted` row; a superseded text produces a `superseded` row. Current status
 * is derived by `isConsentActive()` in `@luma/domain` from the latest event.
 *
 * **`user_id` is nullable and severs on account deletion.** ADR-9's open
 * question is whether a deleted account's consent rows are retained with the
 * reference severed or kept intact for a fixed period; until legal review
 * concludes, severing is the conservative option and is the one implemented
 * here. That severing is an `UPDATE`, so the immutability trigger has to
 * permit exactly one shape of update — `user_id` going from a value to null
 * with every other column byte-identical — and reject everything else.
 */
export const consentEvents = pgTable(
  'consent_events',
  {
    id: primaryId(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    consentType: consentTypeEnum('consent_type').notNull(),
    status: consentStatusEnum('status').notNull(),
    source: consentSourceEnum('source').notNull(),
    /** ADR-9 rule 4: mandatory for `admin_recorded` and `imported`. */
    sourceDetail: text('source_detail'),
    policyVersion: text('policy_version'),
    termsVersion: text('terms_version'),
    /** Resolves to a `consent_text_versions` row. Never inferred later. */
    consentTextVersion: text('consent_text_version').notNull(),
    /** When the person actually consented, which an admin may backdate. */
    occurredAt: timestamptz('occurred_at').notNull(),
    /** Hashed, never raw: spec section 40 requires data minimisation. */
    ipAddressHash: text('ip_address_hash'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (table) => [
    // ADR-9 rule 3, enforced rather than assumed: an event cannot name a text
    // version that does not exist. `restrict` on delete because removing a
    // wording that people consented to would destroy the evidence.
    foreignKey({
      name: 'consent_events_text_version_fk',
      columns: [table.consentType, table.consentTextVersion],
      foreignColumns: [consentTextVersions.consentType, consentTextVersions.version],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    // Deriving current status is "latest event for this pair", so this index
    // is what keeps ADR-9's negative trade-off (a read is an ordering, not a
    // column read) from mattering.
    index('consent_events_user_type_occurred_idx').on(
      table.userId,
      table.consentType,
      table.occurredAt.desc(),
    ),
    index('consent_events_type_status_occurred_idx').on(
      table.consentType,
      table.status,
      table.occurredAt.desc(),
    ),
    // ADR-9 rule 4: spec section 21 says admin may not create consent without
    // documented grounds, so the grounds are structurally required.
    check(
      'consent_events_admin_source_detail_required',
      sql`${table.source} NOT IN ('admin_recorded', 'imported')
          OR (${table.sourceDetail} IS NOT NULL AND length(btrim(${table.sourceDetail})) > 0)`,
    ),
  ],
);

/**
 * The terms and the privacy notice as documents (spec section 19, ADR-11).
 * One row per kind; the versions hang off it.
 */
export const legalDocuments = pgTable(
  'legal_documents',
  {
    id: primaryId(),
    kind: legalDocumentKindEnum('kind').notNull(),
    /** Norwegian title, e.g. «Vilkår for bruk». */
    title: text('title').notNull(),
    /** Points at the version currently in force. */
    currentVersion: text('current_version'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('legal_documents_kind_key').on(table.kind)],
);

export const legalDocumentVersions = pgTable(
  'legal_document_versions',
  {
    id: primaryId(),
    legalDocumentId: uuid('legal_document_id')
      .notNull()
      .references(() => legalDocuments.id, { onDelete: 'restrict' }),
    /** Denormalised from the parent so acceptances can key on (kind, version). */
    kind: legalDocumentKindEnum('kind').notNull(),
    version: text('version').notNull(),
    /** Norwegian bokmål, Markdown. */
    body: text('body').notNull(),
    /**
     * Blocks public launch while true (spec section 51 item 8). A placeholder
     * that reached production would mean users accepted text nobody wrote.
     */
    isPlaceholder: boolean('is_placeholder').notNull().default(true),
    effectiveFrom: timestamptz('effective_from').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // A constraint, not an index, for the same ordering reason as
    // `consent_text_versions` above: `user_legal_acceptances` references it.
    unique('legal_document_versions_kind_version_key').on(table.kind, table.version),
    index('legal_document_versions_effective_from_idx').on(table.effectiveFrom.desc()),
  ],
);

/**
 * Which version of which document a user accepted, and when (ADR-11).
 *
 * Same evidential character as `consent_events`, so it gets the same
 * treatment: insert only, guarded by the same trigger, and the user reference
 * severs rather than cascading on account deletion.
 */
export const userLegalAcceptances = pgTable(
  'user_legal_acceptances',
  {
    id: primaryId(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: legalDocumentKindEnum('kind').notNull(),
    version: text('version').notNull(),
    acceptedAt: timestamptz('accepted_at').notNull(),
    ipAddressHash: text('ip_address_hash'),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'user_legal_acceptances_version_fk',
      columns: [table.kind, table.version],
      foreignColumns: [legalDocumentVersions.kind, legalDocumentVersions.version],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    // NULLs stay distinct here, deliberately: after severing, two deleted
    // users' acceptances of the same version must both survive.
    uniqueIndex('user_legal_acceptances_user_kind_version_key').on(
      table.userId,
      table.kind,
      table.version,
    ),
    index('user_legal_acceptances_kind_version_idx').on(table.kind, table.version),
  ],
);

export const consentEventsRelations = relations(consentEvents, ({ one }) => ({
  user: one(users, { fields: [consentEvents.userId], references: [users.id] }),
}));

export const legalDocumentsRelations = relations(legalDocuments, ({ many }) => ({
  versions: many(legalDocumentVersions),
}));

export const legalDocumentVersionsRelations = relations(legalDocumentVersions, ({ one }) => ({
  document: one(legalDocuments, {
    fields: [legalDocumentVersions.legalDocumentId],
    references: [legalDocuments.id],
  }),
}));

export const userLegalAcceptancesRelations = relations(userLegalAcceptances, ({ one }) => ({
  user: one(users, { fields: [userLegalAcceptances.userId], references: [users.id] }),
}));

export type ConsentEventRow = typeof consentEvents.$inferSelect;
export type NewConsentEventRow = typeof consentEvents.$inferInsert;
export type ConsentTextVersionRow = typeof consentTextVersions.$inferSelect;
export type LegalDocumentVersionRow = typeof legalDocumentVersions.$inferSelect;
export type UserLegalAcceptanceRow = typeof userLegalAcceptances.$inferSelect;
