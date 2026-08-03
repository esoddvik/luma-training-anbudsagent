import { z } from 'zod';
import type { MatchReasonType } from './matching.js';
import type { NoticeCategory, TenderStatus } from './tender.js';

/**
 * Tender sharing (spec section 17).
 *
 * The share link is both a user feature and the service's main organic growth
 * channel, and it is the place where a privacy mistake would be most visible:
 * the view is public and unauthenticated. The rule is absolute - a shared view
 * exposes the tender and the *types* of match reason, never who shared it and
 * never any value from their alert profile (ADR-15).
 */

export const tenderShareSchema = z.object({
  id: z.uuid(),
  tenderId: z.uuid(),
  createdByUserId: z.uuid(),
  /** Cryptographically random. Never derived from user or tender id. */
  token: z.string().min(32),
  expiresAt: z.date(),
  revokedAt: z.date().optional(),
  viewCount: z.number().int().nonnegative(),
  createdAt: z.date(),
});
export type TenderShare = z.infer<typeof tenderShareSchema>;

export type ShareAccessResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'revoked' }
  | { readonly kind: 'not_found' };

/**
 * Whether a share may be viewed. Expiry and revocation both produce a neutral
 * page and HTTP 410 (spec section 40), not a 404 that would let a caller
 * distinguish a real token from a guessed one.
 */
export function evaluateShareAccess(
  share: TenderShare | undefined,
  now: Date,
): ShareAccessResult {
  if (!share) return { kind: 'not_found' };
  if (share.revokedAt) return { kind: 'revoked' };
  if (share.expiresAt <= now) return { kind: 'expired' };
  return { kind: 'ok' };
}

/**
 * The public projection of a tender for the shared view.
 *
 * Modelled as its own type rather than a filtered `Tender` so that adding a
 * field to the tender model cannot silently widen what a public page exposes.
 * `matchReasonTypes` carries only the reason *kinds*, never the profile values
 * behind them.
 */
export const sharedTenderViewSchema = z.object({
  title: z.string(),
  buyerName: z.string(),
  description: z.string().optional(),
  noticeCategory: z.custom<NoticeCategory>(),
  status: z.custom<TenderStatus>(),
  cpvCodes: z.array(z.string()),
  regions: z.array(z.string()),
  deadlineAt: z.date().optional(),
  publishedAt: z.date(),
  sourceUrl: z.string(),
  lastSyncedAt: z.date(),
  /** Reason kinds only. No keywords, no profile name, no score breakdown. */
  matchReasonTypes: z.array(z.custom<MatchReasonType>()),
});
export type SharedTenderView = z.infer<typeof sharedTenderViewSchema>;

/**
 * Fields that must never appear in a shared view payload. Asserted against in
 * tests so a future refactor cannot reintroduce them.
 */
export const FORBIDDEN_SHARE_FIELDS: readonly string[] = [
  'createdByUserId',
  'userId',
  'sharedBy',
  'email',
  'alertProfileId',
  'profileName',
  'keywordsInclude',
  'keywordsExclude',
  'score',
  'reasons',
  'token',
];

/** The single invitation shown on a shared view (spec sections 17 and 43). */
export const SHARE_INVITATION_NB = {
  heading: 'Få dine egne anbudsvarsler',
  body: 'En kollega delte dette anbudet med deg via Luma Anbudsvarsling. Få dine egne anbudsvarsler, gratis, fra Luma Training.',
} as const;

/** Shown when a link has expired or been revoked. Deliberately neutral. */
export const SHARE_UNAVAILABLE_NB = {
  heading: 'Denne delingslenken er ikke lenger aktiv',
  body: 'Lenken kan ha utløpt eller blitt opphevet. Du kan opprette dine egne anbudsvarsler gratis hos Luma Training.',
} as const;
