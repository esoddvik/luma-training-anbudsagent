import { z } from 'zod';

/**
 * Shared input pieces for the tool schemas (spec section 32.1).
 *
 * Every message is written in Norwegian at the field, because a rejected call
 * is read by the model and, through it, by the user (spec section 6). Zod's
 * own English fallback only surfaces for a raw type mismatch, and
 * `formatZodErrorNb` keeps the envelope Norwegian even then.
 *
 * The input shapes follow spec section 32.1 literally, including its enum
 * members. Where the spec's list is narrower than the domain's — `status` has
 * no `unknown`, `noticeCategory` has no `award` — the spec wins, and the note
 * on the field says why.
 */

/** Tender and profile ids are UUIDs throughout the system. */
export const idSchema = z.uuid({ error: 'må være en gyldig id (UUID) fra et tidligere svar' });

export const limitSchema = z
  .number({ error: 'må være et tall' })
  .int({ error: 'må være et heltall' })
  .min(1, { error: 'må være minst 1' })
  .optional();

export const cursorSchema = z
  .string({ error: 'må være verdien fra nesteCursor i forrige svar' })
  .min(1, { error: 'kan ikke være tom' })
  .optional();

/**
 * A date or timestamp as a string.
 *
 * Deliberately permissive about the format — a model will send `2026-08-01`,
 * `2026-08-01T00:00:00Z` and everything between — and strict about the result
 * being a real instant.
 */
export const dateStringSchema = z
  .string({ error: 'må være en dato som tekst, for eksempel 2026-08-01' })
  .refine((value) => Number.isFinite(Date.parse(value)), {
    error: 'er ikke en gyldig dato. Bruk ISO-format, for eksempel 2026-08-01',
  })
  .transform((value) => new Date(value));

export const cpvCodeInputSchema = z
  .string({ error: 'må være en CPV-kode som tekst' })
  .regex(/^\d{8}(-\d)?$/, {
    error: 'må være en CPV-kode med åtte siffer, eventuelt med kontrollsiffer',
  });

/** Spec section 32.1: `search_tenders` offers planned and competition only. */
export const searchNoticeCategorySchema = z.enum(['planned', 'competition'], {
  error: 'må være «planned» (planlagt anskaffelse) eller «competition» (aktiv konkurranse)',
});

/** Spec section 32.1: the four states a caller may filter on. */
export const searchStatusSchema = z.enum(['open', 'closed', 'cancelled', 'awarded'], {
  error: 'må være «open», «closed», «cancelled» eller «awarded»',
});

export const scoreSchema = z
  .number({ error: 'må være et tall' })
  .min(0, { error: 'kan ikke være lavere enn 0' })
  .max(100, { error: 'kan ikke være høyere enn 100' })
  .optional();

/** Spec section 32.1: the six topics `get_luma_learning_resource` accepts. */
export const learningTopicSchema = z.enum(
  [
    'utvelgelse',
    'krav_og_oppdragsforstaelse',
    'strategi',
    'bid_no_bid',
    'kvalitetssikring',
    'ai_sikkerhet',
  ],
  {
    error:
      'må være ett av emnene «utvelgelse», «krav_og_oppdragsforstaelse», «strategi», «bid_no_bid», «kvalitetssikring» eller «ai_sikkerhet»',
  },
);

export type LearningTopic = z.output<typeof learningTopicSchema>;
