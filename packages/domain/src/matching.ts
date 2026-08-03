import { z } from 'zod';

/**
 * Match results (spec section 14).
 *
 * Two rules govern this file and are enforced by tests elsewhere:
 *
 * 1. A score is a statement about how well a tender fits the profile. It is
 *    never a probability of winning and never a bid/no-bid recommendation
 *    (spec section 4.3). The customer-facing vocabulary below is the only
 *    approved way to describe a score.
 * 2. Nothing commercial may appear in this type. Course clicks, newsletter
 *    engagement and attribution data are not inputs to matching (ADR-6).
 */

export const matchReasonTypeSchema = z.enum([
  'cpv',
  'keyword',
  'geography',
  'buyer',
  'value',
  'notice_type',
  'procedure',
  'deadline',
]);
export type MatchReasonType = z.infer<typeof matchReasonTypeSchema>;

export const matchConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type MatchConfidence = z.infer<typeof matchConfidenceSchema>;

export const matchReasonSchema = z.object({
  type: matchReasonTypeSchema,
  /** Norwegian, customer-facing summary of this component. */
  label: z.string().min(1),
  contribution: z.number(),
  /** The concrete values that caused it: codes, keywords, place names. */
  evidence: z.array(z.string()),
});
export type MatchReason = z.infer<typeof matchReasonSchema>;

export const matchExclusionSchema = z.object({
  type: z.string().min(1),
  label: z.string().min(1),
  evidence: z.array(z.string()),
});
export type MatchExclusion = z.infer<typeof matchExclusionSchema>;

export const matchResultSchema = z.object({
  tenderId: z.uuid(),
  alertProfileId: z.uuid(),
  score: z.number().min(0).max(100),
  confidence: matchConfidenceSchema,
  included: z.boolean(),
  reasons: z.array(matchReasonSchema),
  exclusions: z.array(matchExclusionSchema),
  /** Same version plus same input must always produce the same result. */
  matchingVersion: z.string().min(1),
});
export type MatchResult = z.infer<typeof matchResultSchema>;

/**
 * Approved Norwegian phrasing for a score (spec section 4.3).
 *
 * Kept here, next to the type, so that no surface can invent its own wording.
 * The forbidden phrasings are equally part of the contract and are asserted
 * against in tests.
 */
export const CONFIDENCE_LABEL_NB: Readonly<Record<MatchConfidence, string>> = {
  high: 'Høy relevans',
  medium: 'Verdt å undersøke',
  low: 'Treff med lav sikkerhet',
};

/** The disclaimer that must accompany a score wherever it is shown. */
export const SCORE_DISCLAIMER_NB =
  'Treffscoren viser hvor godt anbudet passer varslingsprofilen din. Den sier ingenting om sannsynligheten for å vinne.';

export function confidenceLabel(confidence: MatchConfidence): string {
  return CONFIDENCE_LABEL_NB[confidence];
}

/**
 * Relevance feedback (spec section 15). Feedback informs quality measurement
 * and may *suggest* profile changes, but never edits a profile on its own.
 */
export const feedbackVerdictSchema = z.enum([
  'relevant',
  'not_relevant',
  'already_known',
  'wrong_geography',
  'wrong_service',
  'wrong_size',
  'wrong_buyer',
  'wrong_cpv',
  'other',
]);
export type FeedbackVerdict = z.infer<typeof feedbackVerdictSchema>;

export const FEEDBACK_LABEL_NB: Readonly<Record<FeedbackVerdict, string>> = {
  relevant: 'Relevant',
  not_relevant: 'Ikke relevant',
  already_known: 'Allerede kjent',
  wrong_geography: 'Feil geografi',
  wrong_service: 'Feil tjeneste',
  wrong_size: 'Feil størrelse',
  wrong_buyer: 'Feil oppdragsgiver',
  wrong_cpv: 'Feil CPV',
  other: 'Annet',
};

export const relevanceFeedbackSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  tenderId: z.uuid(),
  alertProfileId: z.uuid().optional(),
  verdict: feedbackVerdictSchema,
  comment: z.string().max(2000).optional(),
  matchingVersion: z.string().min(1),
  createdAt: z.date(),
});
export type RelevanceFeedback = z.infer<typeof relevanceFeedbackSchema>;

/**
 * A suggested profile change derived from feedback. Requires explicit user
 * approval before it is applied (spec section 15).
 */
export const profileSuggestionSchema = z.object({
  id: z.uuid(),
  alertProfileId: z.uuid(),
  field: z.enum([
    'cpvInclude',
    'cpvExclude',
    'keywordsInclude',
    'keywordsExclude',
    'buyerExclude',
    'regionsInclude',
    'estimatedValueMinNok',
    'estimatedValueMaxNok',
  ]),
  operation: z.enum(['add', 'remove', 'set']),
  value: z.string(),
  /** Norwegian explanation of why this is suggested. */
  rationale: z.string().min(1),
  status: z.enum(['pending', 'accepted', 'rejected']),
  createdAt: z.date(),
});
export type ProfileSuggestion = z.infer<typeof profileSuggestionSchema>;
