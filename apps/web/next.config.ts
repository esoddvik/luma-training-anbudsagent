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
  poweredByHeader: false,
  outputFileTracingRoot: workspaceRoot,
};

export default nextConfig;
