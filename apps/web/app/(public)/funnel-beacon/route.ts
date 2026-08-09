import { z } from 'zod';
import { recordFunnelEvent, type FunnelEventType } from '@/server/funnel';

/**
 * Counting views of a statically rendered page
 * (IDE Agent Spec v3, section 3.2).
 *
 * ## Why this exists at all
 *
 * The first version of the funnel called `recordFunnelEvent` in the body of
 * `/finn-anbud` and the `/anbud-for` pages. That is wrong in a way that leaves
 * no trace: those pages are statically prerendered with `revalidate = 3600`,
 * so their server code runs **once per hour at revalidation**, not once per
 * visitor. `picker_viewed` would have been a count of revalidations — a number
 * that looks like a funnel, sits in a dashboard, and is not one.
 *
 * Making the pages dynamic would fix the count and break the requirement:
 * IDE Agent Spec v3 section 3.2 forbids `force-dynamic` on public pages,
 * because these are the surfaces meant to be indexed and instant. So the count
 * moves off the page and onto a request the browser makes for every view.
 *
 * ## Why an image and not `fetch`
 *
 * Every form in this app works without client JavaScript, deliberately — this
 * is the funnel a corporate proxy stripping bundles must not silently break.
 * An `<img>` is requested by the browser itself, so the count survives a reader
 * with no JavaScript at all. A `fetch` would quietly under-count exactly the
 * visitors the no-JS rule exists to protect.
 *
 * ## What it does not collect
 *
 * No cookie is set, nothing identifying is stored, and `funnel_events` has no
 * column that could hold a visitor. The row records which page kind was viewed
 * and under which trade — nothing about who viewed it. See the note on
 * `funnel_events` for what that costs (rates, not per-visitor paths) and why
 * the trade is deliberate.
 */

const query = z.object({
  type: z.enum(['picker_viewed', 'trade_selected', 'region_selected', 'results_viewed']),
  bransje: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(120)
    .optional(),
  landsdel: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(120)
    .optional(),
});

/** A 1×1 transparent GIF. The smallest thing a browser will fetch and draw. */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function pixel(): Response {
  return new Response(new Uint8Array(PIXEL), {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      // Never cached: a cached beacon is a beacon that counts one view and
      // then goes quiet, which is the failure this route was written to avoid.
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Content-Length': String(PIXEL.length),
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const parsed = query.safeParse({
    type: params.get('type') ?? '',
    ...(params.get('bransje') ? { bransje: params.get('bransje') } : {}),
    ...(params.get('landsdel') ? { landsdel: params.get('landsdel') } : {}),
  });

  // An unparseable beacon still returns the pixel. The alternative is a broken
  // image icon on a public page because someone hand-edited a query string.
  if (parsed.success) {
    await recordFunnelEvent({
      type: parsed.data.type as FunnelEventType,
      ...(parsed.data.bransje ? { serviceTemplateSlug: parsed.data.bransje } : {}),
      ...(parsed.data.landsdel ? { landsdelSlug: parsed.data.landsdel } : {}),
    });
  }

  return pixel();
}
