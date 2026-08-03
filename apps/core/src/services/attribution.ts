import { attributionEvents } from '@luma/db';
import { UTM_SOURCE } from '@luma/domain';
import type { ApiContext } from './context.js';

/**
 * Writing attribution events (spec §44, §49 "isolér attribusjon", ADR-6).
 *
 * ## The direction of the arrow
 *
 * Everything in this module writes. Nothing reads. That is the ADR-6 boundary
 * expressed in the smallest possible way: matching cannot be influenced by
 * attribution if no matching code path can obtain an attribution row, and the
 * cheapest way to guarantee that is for the module to expose no query.
 *
 * The schema holds the other half — `attribution_events` has no foreign key
 * into `tender_matches`, `tender_match_reasons` or `alert_profiles`, and
 * `attribution-isolation.integration.test.ts` reads `information_schema` to
 * prove it. `tender_id` is the one permitted tender-side reference and it is
 * for reporting (spec §37).
 *
 * ## Failure policy
 *
 * A measurement write must never fail the thing it measures. Spec §44.3 says
 * these numbers are reported and never steer product logic; a share link that
 * could not be created because a reporting insert failed would be the product
 * being steered by attribution in the most literal way available. So both
 * functions swallow and log.
 */

export interface ShareCreatedInput {
  readonly userId: string;
  readonly tenderId: string;
  readonly shareId: string;
}

/** `share_created` (spec §44.1, §17, ADR-15). */
export async function recordShareCreated(ctx: ApiContext, input: ShareCreatedInput): Promise<void> {
  await write(ctx, 'share_created', {
    type: 'share_created',
    userId: input.userId,
    tenderId: input.tenderId,
    shareId: input.shareId,
    utmSource: UTM_SOURCE,
    occurredAt: ctx.now(),
  });
}

export interface ShareViewedInput {
  readonly tenderId: string;
  readonly shareId: string;
}

/**
 * `share_viewed` (spec §44.1, §17, §40, ADR-15).
 *
 * **No viewer identity is written, and there is nowhere in this call to put
 * one.** The input carries a tender and a share and nothing else: the shared
 * view is public and unauthenticated, the recipient never agreed to anything,
 * and spec §17 says the view exposes no personal data in either direction.
 *
 * So `user_id` is explicitly null rather than merely omitted — a reviewer
 * reading this should see the decision, not an absence. The address, the user
 * agent and the referrer are not passed in at all, which is stronger than
 * choosing not to store them.
 *
 * `share_id` identifies the *link*, which belongs to the person who created it
 * and is already theirs. It is what makes "signups per share" (§44.3)
 * computable, and it says nothing about who opened it.
 */
export async function recordShareViewed(ctx: ApiContext, input: ShareViewedInput): Promise<void> {
  await write(ctx, 'share_viewed', {
    type: 'share_viewed',
    userId: null,
    tenderId: input.tenderId,
    shareId: input.shareId,
    utmSource: UTM_SOURCE,
    utmMedium: 'shared_view',
    occurredAt: ctx.now(),
  });
}

async function write(
  ctx: ApiContext,
  label: string,
  values: typeof attributionEvents.$inferInsert,
): Promise<void> {
  try {
    await ctx.db.insert(attributionEvents).values(values);
  } catch (error) {
    ctx.logger.warn({ err: error, type: label }, 'attribusjonshendelse kunne ikke lagres');
  }
}
