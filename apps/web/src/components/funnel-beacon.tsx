import { BASE_PATH } from '@/lib/site';

/**
 * A one-pixel request that counts a view of a statically rendered page.
 *
 * See `app/(public)/funnel-beacon/route.ts` for why the count cannot live in
 * the page body: these pages are prerendered, so their server code runs once
 * per revalidation rather than once per reader.
 *
 * `aria-hidden` and an empty `alt`, because it is not content. Assistive
 * technology should never announce it, and a reader with images disabled loses
 * a row in an analytics table and nothing else.
 */
export function FunnelBeacon({
  type,
  bransje,
  landsdel,
}: {
  type: 'picker_viewed' | 'trade_selected' | 'region_selected' | 'results_viewed';
  bransje?: string;
  landsdel?: string;
}) {
  const query = new URLSearchParams({
    type,
    ...(bransje ? { bransje } : {}),
    ...(landsdel ? { landsdel } : {}),
  });

  return (
    // Deliberately a plain `<img>`, not `next/image`: this is a beacon, not a
    // picture. `next/image` would route it through the optimiser, which
    // caches, and a cached beacon counts one view and then goes quiet.
    <img
      src={`${BASE_PATH}/funnel-beacon?${query.toString()}`}
      alt=""
      aria-hidden="true"
      width={1}
      height={1}
      style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
    />
  );
}
