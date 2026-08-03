import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'core',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /**
     * Teardown needs longer than the 10-second default.
     *
     * Every integration suite here creates its own PostgreSQL database in
     * `beforeAll` and drops it in `afterAll` (see `@luma/db/testing`). The
     * `beforeAll` hooks already pass an explicit timeout because migrating a
     * fresh database is visibly slow; the `afterAll` hooks did not, and once
     * this package grew past seven integration suites the concurrent
     * `DROP DATABASE` calls at the end of a run started exceeding ten seconds.
     *
     * The symptom is worth naming, because it reads like a real failure and is
     * not: every test passes, and the run still exits 1 with four "Hook timed
     * out in 10000ms" errors pointing at `afterAll`. The drop itself is already
     * `WITH (FORCE)`, so nothing is blocked — it is simply slower than the
     * default allows under load.
     *
     * Set at the project level rather than on each hook so that a suite added
     * tomorrow inherits it without its author having to discover this.
     */
    hookTimeout: 60_000,
  },
});
