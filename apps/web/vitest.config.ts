import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The `@/*` alias from `tsconfig.json`. Next resolves it during a build and
  // `tsc` resolves it during a typecheck, but Vitest runs the modules directly
  // through Node, so without this a server module that imports `@/lib/...`
  // typechecks and builds and then cannot be loaded by a test — which reads as
  // "the test is broken" rather than "the alias is missing".
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    name: 'web',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
