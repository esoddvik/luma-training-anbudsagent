import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit configuration.
 *
 * `packages/db` is the single owner of the schema (docs/architecture.md): the
 * generated migrations in `drizzle/` are the only way the database changes.
 * `db:push` exists for throwaway local experiments and must never be pointed
 * at a deployed environment — it diffs and applies without leaving a migration
 * behind, so the next `db:migrate` in CI would disagree with reality.
 *
 * The connection string is read straight from the environment rather than
 * through `@luma/config`, because drizzle-kit loads this file outside the
 * application runtime and a validation failure here would be reported as an
 * unhelpful tool crash.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://luma:luma@localhost:5432/luma_anbudsvarsling',
  },
  strict: true,
  verbose: true,
});
