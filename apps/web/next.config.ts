import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { BASE_PATH, PRODUCTION_ORIGIN } from './src/lib/site';

// Monorepo: the standalone output has to trace files up to the workspace root,
// otherwise the pnpm-linked @luma/ui files are left out of the image.
const workspaceRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

const productionHost = new URL(PRODUCTION_ORIGIN).host;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * The app is a Next.js Multi Zone under `luma-training.com/anbudsvarsling`
   * (spec §9.1 step 1 and §16), not a subdomain of its own. The marketing site
   * — a separate repository — rewrites `/anbudsvarsling/:path*` through to this
   * deployment; `docs/deployment.md` §7 holds the exact rewrite it needs.
   *
   * **No `assetPrefix`.** The Multi Zones guide reaches for one because its
   * example zones have no `basePath`. Next's `assetPrefix` reference says
   * plainly that `basePath` is better suited to hosting under a sub-path and
   * that a custom asset prefix is not suggested for it — `basePath` already
   * serves `/_next/…` under the prefix, so assets are namespaced against the
   * other zone without a second mechanism. Setting `assetPrefix` as well would
   * take asset URLs *away* from `basePath` and need its own `beforeFiles`
   * rewrite to resolve. One prefix, one rewrite family on the marketing side.
   *
   * Changing this value changes which `headers.source` in `vercel.json` match.
   * That file is strict JSON and cannot hold the note, so it lives here: Vercel
   * matches `source` against the request path as it arrives, prefix and all, so
   * the `X-Robots-Tag: noindex` the shared view requires (§17) must be sourced
   * at `/anbudsvarsling/delt/:path*`. If this prefix moves and that source does
   * not, a private share page silently becomes indexable.
   */
  basePath: BASE_PATH,
  // Container image built from the standalone output. The Vercel path in
  // apps/web/vercel.json does not use it.
  output: 'standalone',
  // @luma/ui ships ESM built from TypeScript source; Next has to run it
  // through its own compiler so the tokens CSS and JSX land in the app bundle.
  transpilePackages: ['@luma/ui'],
  // `postgres` opens TCP sockets; it is required at runtime rather than
  // bundled. Note that the app imports `@luma/db/schema` and never the
  // package root: the root re-exports the migration runner, which resolves its
  // SQL folder with `new URL('../drizzle', import.meta.url)`, and a bundler
  // reads that as an import of a module called `../drizzle` and fails.
  // `postmark` is the Postmark SDK, used by the login form to send the magic
  // link. Like `postgres` it opens sockets and reads no bundler-visible
  // module graph, so it is required at runtime rather than bundled.
  serverExternalPackages: ['postgres', 'postmark'],
  poweredByHeader: false,
  outputFileTracingRoot: workspaceRoot,
  experimental: {
    /**
     * Server Actions compare the browser's `Origin` against the `Host` the
     * request arrived on and refuse when they differ. Behind the marketing
     * site's rewrite they always differ: the browser sends
     * `Origin: https://luma-training.com` while this deployment sees its own
     * Vercel host. Without this list every Server Action — the login form
     * included — fails with a CSRF error that names neither the proxy nor the
     * origin. So it holds the user-facing hosts and nothing else; a wildcard
     * here would give the check away.
     */
    serverActions: {
      allowedOrigins: [productionHost, `www.${productionHost}`],
    },
  },
};

export default nextConfig;
