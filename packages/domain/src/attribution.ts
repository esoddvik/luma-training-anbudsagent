import { z } from 'zod';

/**
 * Attribution measurement (spec section 44).
 *
 * These events measure the value the free service creates for Luma. They are
 * reported, and they never influence the product: attribution data is not an
 * input to matching, ranking, or recommendation choice beyond ladder rotation
 * (ADR-6). The database enforces the same boundary by keeping no foreign key
 * from these rows into the match tables.
 */

export const attributionEventTypeSchema = z.enum([
  /** A tool user orders or is activated for the Påfyll newsletter. */
  'tool_to_paafyll',
  /** A tool user clicks through to a webinar registration. */
  'tool_to_webinar',
  /** A tool user orders or registers for a course seat. */
  'tool_to_course_seat',
  /** A registration that arrived through a share link. */
  'share_to_signup',
]);
export type AttributionEventType = z.infer<typeof attributionEventTypeSchema>;

export const attributionEventSchema = z.object({
  id: z.uuid(),
  type: attributionEventTypeSchema,
  /** Absent for an anonymous share view that has not yet registered. */
  userId: z.uuid().optional(),
  /** Present when the event originated from a specific tender surface. */
  tenderId: z.uuid().optional(),
  editorialRecommendationId: z.uuid().optional(),
  shareId: z.uuid().optional(),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  occurredAt: z.date(),
  createdAt: z.date(),
});
export type AttributionEvent = z.infer<typeof attributionEventSchema>;

/** Every outbound Luma link carries this source (spec section 44.2). */
export const UTM_SOURCE = 'anbudsvarsling';

/** The surface a link was clicked from, used as `utm_medium`. */
export const utmMediumSchema = z.enum([
  'digest',
  'immediate',
  'tender_detail',
  'empty_state',
  'shared_view',
  'mcp',
  'landing',
]);
export type UtmMedium = z.infer<typeof utmMediumSchema>;

export interface UtmParams {
  medium: UtmMedium;
  /** Usually the recommendation slug or campaign name. */
  campaign?: string;
  content?: string;
}

/**
 * Appends consistent UTM parameters to an outbound Luma link.
 *
 * Existing query parameters are preserved, and an existing `utm_*` value is
 * overwritten rather than duplicated, so a link that passes through this
 * function twice is identical to one that passed through it once.
 */
export function withUtm(url: string, params: UtmParams): string {
  const parsed = new URL(url);
  parsed.searchParams.set('utm_source', UTM_SOURCE);
  parsed.searchParams.set('utm_medium', params.medium);
  if (params.campaign) parsed.searchParams.set('utm_campaign', params.campaign);
  if (params.content) parsed.searchParams.set('utm_content', params.content);
  return parsed.toString();
}
