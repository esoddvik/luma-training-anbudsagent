/**
 * `@luma/db` — the Drizzle schema and the connection to PostgreSQL.
 *
 * This package owns the schema. Every table, index, constraint and migration
 * lives here, and the generated SQL in `drizzle/` is the only way the database
 * changes (docs/architecture.md). No other package writes DDL.
 *
 * See `README.md` for the table map, how to run and reset migrations, and
 * which constraints exist for a legal reason rather than a technical one.
 */

export {
  checkDatabaseHealth,
  closeDb,
  createDatabase,
  databaseDependencyCheck,
  getDb,
  schema,
  type CreateDatabaseOptions,
  type Database,
} from './client.js';

export {
  runMigrations,
  resolveMigrationDatabaseUrl,
  MIGRATIONS_FOLDER,
  type RunMigrationsOptions,
} from './migrate.js';

export {
  checkSchemaDrift,
  schemaDriftDependencyCheck,
  type SchemaDriftReport,
} from './schema-drift.js';

export * from './schema/index.js';
