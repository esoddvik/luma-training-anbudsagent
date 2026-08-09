import * as schema from '@luma/db/schema';
import { getWebDb } from './db';

/**
 * Recording the search-first funnel (IDE Agent Spec v3, section 3.2).
 *
 * The spec puts instrumentation in Fase B rather than in Fase D, and that
 * ordering is the point: the funnel's first job is to answer whether
 * search-first beats the plain form it replaced, and a comparison needs the
 * measurement to exist *before* the thing being measured ships. Instrumenting
 * afterwards produces a number with nothing to compare it to.
 *
 * ## Never let telemetry break the page
 *
 * Every function here swallows its own errors. A public, indexed page that
 *500s because an analytics insert failed would trade the product for the
 * measurement of the product, and these rows are counted in aggregate — a
 * handful lost to a database blip changes a conversion rate by nothing.
 *
 * The failure is logged rather than silently dropped, because a *systematic*
 * failure matters a great deal: a funnel that has quietly recorded nothing for
 * a week looks exactly like a funnel where nobody converted, and the second
 * reading is the one that gets acted on.
 */

export type FunnelEventType = (typeof schema.funnelEventTypeEnum.enumValues)[number];

export interface FunnelEventInput {
  readonly type: FunnelEventType;
  /** Null only for `picker_viewed`, which happens before a choice is made. */
  readonly serviceTemplateSlug?: string | undefined;
  readonly landsdelSlug?: string | undefined;
  /** Injectable so a test is not at the mercy of the clock. */
  readonly now?: Date | undefined;
}

export async function recordFunnelEvent(input: FunnelEventInput): Promise<void> {
  try {
    await getWebDb()
      .insert(schema.funnelEvents)
      .values({
        type: input.type,
        serviceTemplateSlug: input.serviceTemplateSlug ?? null,
        landsdelSlug: input.landsdelSlug ?? null,
        occurredAt: input.now ?? new Date(),
      });
  } catch (error) {
    // Deliberately not rethrown. See the note above: the page is worth more
    // than the row. Logged with the type so a run of these is visible.
    console.warn(
      `funnel event ${input.type} not recorded: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
}
