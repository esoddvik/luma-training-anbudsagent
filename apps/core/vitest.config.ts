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
    /**
     * The same argument, for the tests themselves rather than their hooks.
     *
     * The reasoning above was applied to `hookTimeout` and stopped there,
     * leaving 166 of this package's 176 integration tests on Vitest's
     * five-second default. `queue.integration.test.ts` worked around that by
     * declaring a timeout on every single test — a per-file fix for something
     * that belongs here, and one the next suite's author would have to know to
     * repeat.
     *
     * **What this does not fix, because the two are easy to confuse.** A
     * reported test duration is not the number `testTimeout` is compared
     * against. Vitest starts the duration clock before `beforeEach` and stops
     * it after `afterEach`, while the timeout's own timer starts inside the
     * wrapper around the test function — so hooks are counted in the duration
     * and guarded by `hookTimeout` instead. That is why a test here was
     * observed reporting 40114ms and passing under the five-second default:
     * roughly 38 seconds of it was a `truncate ... cascade` in `beforeEach`
     * waiting on ACCESS EXCLUSIVE against a PostgreSQL shared by fourteen
     * suites, and its body ran in the same ~1.6s as its two siblings.
     *
     * So this is insurance for test *bodies*, not an answer to those long
     * durations. It is worth having anyway: the queue suite's bodies alone run
     * two to thirteen seconds, and a body that drifts past five under load
     * would fail at random — which, after two false alarms, teaches everyone
     * to re-run rather than to look.
     *
     * Matched to `apps/web` and `packages/db`, which reached 30 seconds by the
     * same route.
     */
    testTimeout: 30_000,
  },
});
