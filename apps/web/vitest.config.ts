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
    /**
     * Longer than the 10-second default, for the same reason as `apps/core`.
     *
     * Each integration suite creates its own PostgreSQL database and runs the
     * full migration set into it. Run alone that is fast; run alongside every
     * other package's suites against one local Postgres, it is not, and the
     * hooks that never set a timeout are the ones that lose.
     *
     * This matters more than an ordinary flake. The harness deliberately
     * hard-fails CI when `DATABASE_URL` is missing, so that a green run means
     * something. A suite that goes red at random defeats that from the other
     * direction: after two false alarms the habit becomes "just re-run it",
     * and at that point a real failure is indistinguishable from noise.
     *
     * Set at project level so a suite added later inherits it.
     */
    hookTimeout: 60_000,
  },
});
