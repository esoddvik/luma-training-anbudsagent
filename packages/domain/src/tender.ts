import { z } from 'zod';

/**
 * The normalised tender model (spec section 13).
 *
 * Everything downstream of ingestion speaks this vocabulary. Source-specific
 * field names never leak past the adapter boundary, so a future TED adapter
 * can populate the same shape (ADR-7).
 */

/**
 * Product-level grouping of a notice, derived deterministically from the
 * source notice type (spec section 13).
 *
 * - `planned`     prior information and intention notices. Surfaced as
 *                 "Planlagt anskaffelse" everywhere in the product.
 * - `competition` an active competition a supplier can bid on.
 * - `award`       contract award notice. Ingested and stored in the MVP
 *                 because it arrives in the same stream, but excluded from
 *                 matching until phase 8.
 * - `other`       anything else, kept rather than discarded.
 */
export const noticeCategorySchema = z.enum(['planned', 'competition', 'award', 'other']);
export type NoticeCategory = z.infer<typeof noticeCategorySchema>;

export const tenderStatusSchema = z.enum(['open', 'closed', 'cancelled', 'awarded', 'unknown']);
export type TenderStatus = z.infer<typeof tenderStatusSchema>;

export const tenderSourceSchema = z.enum(['doffin']);
export type TenderSource = z.infer<typeof tenderSourceSchema>;

/** A CPV code: eight digits, optionally followed by a check digit. */
export const cpvCodeSchema = z
  .string()
  .regex(/^\d{8}(-\d)?$/, 'must be an 8-digit CPV code, optionally with a check digit');

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const tenderSchema = z.object({
  id: z.uuid(),
  source: tenderSourceSchema,
  /** Stable identifier within the source system. Unique together with source. */
  sourceId: z.string().min(1),
  /** Publication identifier when the source distinguishes it from sourceId. */
  noticeId: z.string().min(1).optional(),
  sourceUrl: z.url(),

  title: z.string().min(1),
  description: z.string().optional(),
  buyerName: z.string().min(1),
  buyerOrganizationNumber: z.string().optional(),

  cpvCodes: z.array(cpvCodeSchema),
  regions: z.array(z.string()),
  municipalities: z.array(z.string()),

  noticeType: z.string().optional(),
  noticeCategory: noticeCategorySchema,
  procedureType: z.string().optional(),

  estimatedValueMinNok: z.number().nonnegative().optional(),
  estimatedValueMaxNok: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),

  publishedAt: z.date(),
  modifiedAt: z.date().optional(),
  /** Absent for planned procurements, which have no bid deadline yet. */
  deadlineAt: z.date().optional(),

  status: tenderStatusSchema,

  sourceRevision: z.string().optional(),
  /** Hash of the source payload, used to detect a genuine change on re-ingest. */
  sourcePayloadHash: z.string().min(1),
  rawPayload: jsonValueSchema,

  createdAt: z.date(),
  updatedAt: z.date(),
  lastSyncedAt: z.date(),
});

export type Tender = z.infer<typeof tenderSchema>;

/**
 * Kinds of change that are material enough to notify a user about
 * (spec section 13). A change not on this list updates the record silently.
 */
export const tenderChangeKindSchema = z.enum([
  'deadline_changed',
  'cancelled',
  'title_changed',
  'description_changed',
  'cpv_changed',
  'attachment_or_revision_changed',
  'buyer_changed',
  'value_changed',
  'procedure_changed',
  'status_changed',
  /** A planned procurement has become an active competition. */
  'planned_became_competition',
]);
export type TenderChangeKind = z.infer<typeof tenderChangeKindSchema>;

export const tenderChangeEventSchema = z.object({
  id: z.uuid(),
  tenderId: z.uuid(),
  kind: tenderChangeKindSchema,
  /** Norwegian, customer-facing description of what changed. */
  summary: z.string().min(1),
  previousValue: z.string().optional(),
  currentValue: z.string().optional(),
  detectedAt: z.date(),
  sourceRevision: z.string().optional(),
});

export type TenderChangeEvent = z.infer<typeof tenderChangeEventSchema>;

/** True when the category is one a supplier can act on as an opportunity. */
export function isOpportunity(category: NoticeCategory): boolean {
  return category === 'planned' || category === 'competition';
}

/**
 * Planned procurements have no bid deadline. Scoring and display both need
 * this distinction, so it lives in the domain rather than being re-derived.
 */
export function expectsDeadline(category: NoticeCategory): boolean {
  return category === 'competition';
}
