import { z } from 'zod';

/**
 * The shape of a Doffin search hit, as observed against the live API on
 * 2026-08-03. Every field here was read out of a real response; see
 * `docs/doffin-api-findings.md` for the evidence behind each one.
 *
 * The schema is deliberately permissive about what may be null, because the
 * observed null rates are high and type-dependent: `estimatedValue` is null in
 * 53% of notices, `deadline` in 31%, and `status` in 40% (it is populated only
 * for live competitions). Being strict here would reject roughly half the real
 * database.
 *
 * It is deliberately *not* permissive about unknown fields being dropped: the
 * whole hit is preserved as `rawPayload`, so a field the API adds later is
 * still available without a re-ingest.
 */

export const doffinPartySchema = z.object({
  id: z.string(),
  /**
   * Not always a nine-digit Norwegian organisation number: string lengths of
   * 3, 9, 11, 17 and 49 were observed, the longer ones on foreign buyers.
   * Validating this as an org number would reject real notices.
   */
  organizationId: z.string().nullable().optional(),
  name: z.string(),
});

export const doffinWinnerSchema = z.object({
  id: z.string().optional(),
  organizationId: z.string().nullable().optional(),
  name: z.string(),
});

export const doffinLotSchema = z.object({
  heading: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  /**
   * Present on award notices (219/219 sampled) and also on intention notices
   * (20/20), because a VEAT names the supplier the buyer intends to award to
   * without competition. Presence of a winner does not mean "this is an award".
   */
  winner: z.array(doffinWinnerSchema).nullable().optional(),
});

export const doffinEstimatedValueSchema = z.object({
  amount: z.number().nullable().optional(),
  /** Observed `NOK` and `PLN`. Not safe to assume NOK. */
  currencyCode: z.string().nullable().optional(),
});

export const doffinSearchHitSchema = z.object({
  id: z.string(),
  buyer: z.array(doffinPartySchema).default([]),
  heading: z.string(),
  description: z.string().nullable().optional(),
  /** NUTS codes, plus the special non-NUTS value `anyw` meaning nationwide. */
  locationId: z.array(z.string()).nullable().optional(),
  estimatedValue: doffinEstimatedValueSchema.nullable().optional(),
  type: z.string(),
  /**
   * Roll-up tags. Not a clean partition: a notice can carry both PLANNING and
   * COMPETITION, and ANNOUNCEMENT_OF_INTENT rolls up to RESULT. Never derive
   * the notice category from this array.
   */
  allTypes: z.array(z.string()).default([]),
  status: z.string().nullable().optional(),
  /** Full UTC timestamp. Filterable by day, but not sortable. */
  issueDate: z.string().nullable().optional(),
  deadline: z.string().nullable().optional(),
  /** Date only, no time component. Sortable, but not filterable. */
  publicationDate: z.string(),
  receivedTenders: z.number().nullable().optional(),
  allReceivedTenders: z
    .array(z.object({ type: z.string(), total: z.number() }))
    .nullable()
    .optional(),
  cpvCodes: z.array(z.string()).default([]),
  limitedDataFlag: z.unknown().nullable().optional(),
  doffinClassicUrl: z.string().nullable().optional(),
  lots: z.array(doffinLotSchema).nullable().optional(),
});

export type DoffinSearchHit = z.infer<typeof doffinSearchHitSchema>;

export const doffinSearchResponseSchema = z.object({
  numHitsTotal: z.number(),
  /** Always min(numHitsTotal, 1000): the API refuses to page past 1000. */
  numHitsAccessible: z.number(),
  hits: z.array(doffinSearchHitSchema).default([]),
});

export type DoffinSearchResponse = z.infer<typeof doffinSearchResponseSchema>;

/**
 * Parses Doffin's bare `publicationDate` into an instant, returning undefined
 * rather than an Invalid Date when the value is malformed. A silent Invalid
 * Date would propagate into the watermark and stall the sync.
 */
export function parsePublicationDateSafe(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * A notice as returned by any source adapter.
 *
 * Kept source-neutral (ADR-7): a future TED adapter implements the same
 * contract, so the payload is opaque here and only the adapter's own
 * normaliser knows how to read it.
 */
export interface SourceTenderNotice {
  /** Stable identifier within the source system. */
  sourceId: string;
  /** Sort key the sync job watermarks on. */
  publishedAt: Date;
  /** The untouched source payload, preserved verbatim. */
  payload: unknown;
}
