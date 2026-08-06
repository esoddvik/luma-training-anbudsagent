/**
 * Where this app lives on the public web.
 *
 * Spec §9.1 step 1 sends the user to `luma-training.com/anbudsvarsling` and
 * §16 lists every route under that prefix, so the app is a Next.js Multi Zone
 * served under a path on Luma Training's existing domain rather than on a
 * subdomain of its own. `next.config.ts` reads `BASE_PATH` for `basePath`; the
 * marketing site (a separate repository) rewrites the prefix through to this
 * deployment. See `docs/deployment.md` §7 for the rewrite it needs.
 *
 * Everything that needs the prefix reads it from here, including
 * `next.config.ts`, so `basePath` and the values Next does **not** prefix for
 * us — the session cookie's `path`, a plain `<form action>`, `next/image`
 * sources, the Playwright base URL — cannot come to disagree.
 *
 * The one thing this module cannot reach is `APP_URL`, which is set per
 * environment and must carry the prefix too: `apps/core` builds magic links and
 * share links without knowing that Next has a `basePath`, so `APP_URL` is the
 * only thing that puts the prefix in them. `packages/email`'s `appUrlFor` test
 * is the guard on that.
 */

/** The path prefix every route in this app sits under. Spec §16. */
export const BASE_PATH = '/anbudsvarsling';

/** Luma Training's public origin. The marketing site owns the root. */
export const PRODUCTION_ORIGIN = 'https://luma-training.com';

/**
 * The canonical public root of this app.
 *
 * No trailing slash: `trailingSlash` is off, so Next serves the landing page at
 * `/anbudsvarsling` and redirects `/anbudsvarsling/` to it. A canonical URL
 * pointing at the redirect would ask search engines to index a hop.
 */
export const PRODUCTION_URL = `${PRODUCTION_ORIGIN}${BASE_PATH}`;

/** Prefixes an in-app absolute path for somewhere Next does not do it for us. */
export function basePathed(path: string): string {
  return `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}
