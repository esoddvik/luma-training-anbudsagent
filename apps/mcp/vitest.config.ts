import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'mcp',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /**
     * Longer than the 10-second default, matching `apps/core`, `apps/web` and
     * `packages/db`.
     *
     * The adapter suite creates its own PostgreSQL database and migrates it.
     * That is quick in isolation and not quick when every package's suites
     * contend for one local Postgres, and a hook without an explicit timeout
     * is the one that loses.
     */
    hookTimeout: 60_000,
  },
});
