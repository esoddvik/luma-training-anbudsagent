import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Monorepo: the standalone output has to trace files up to the workspace root,
// otherwise the pnpm-linked @luma/ui files are left out of the image.
const workspaceRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Container image for anbudsvarsling.luma-training.com is built from the
  // standalone output (see apps/web/vercel.json for the Vercel path).
  output: 'standalone',
  // @luma/ui ships ESM built from TypeScript source; Next has to run it
  // through its own compiler so the tokens CSS and JSX land in the app bundle.
  transpilePackages: ['@luma/ui'],
  // `postgres` opens TCP sockets; it is required at runtime rather than
  // bundled. Note that the app imports `@luma/db/schema` and never the
  // package root: the root re-exports the migration runner, which resolves its
  // SQL folder with `new URL('../drizzle', import.meta.url)`, and a bundler
  // reads that as an import of a module called `../drizzle` and fails.
  serverExternalPackages: ['postgres'],
  poweredByHeader: false,
  outputFileTracingRoot: workspaceRoot,
};

export default nextConfig;
