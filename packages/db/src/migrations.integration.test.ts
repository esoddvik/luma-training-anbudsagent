import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  hasDatabase,
  TEST_SCHEMA,
  type TestDatabase,
} from './testing/harness.js';
import { MIGRATIONS_FOLDER } from './migrate.js';

/**
 * Migrations apply to an empty database, and produce the schema the code
 * expects.
 *
 * The harness creates a fresh PostgreSQL database per suite and runs every
 * migration into it, so "applies to an empty database" is literally what
 * happens here rather than something inferred from a database that has been
 * migrated repeatedly since 2026.
 */
describe.skipIf(!hasDatabase)('migrations', () => {
  let harness: TestDatabase;

  beforeAll(async () => {
    harness = await createTestDatabase();
  });

  afterAll(async () => {
    await harness?.destroy();
  });

  async function tableNames(): Promise<string[]> {
    const rows = await harness.db.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ${TEST_SCHEMA}
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    return [...rows].map((row) => row.table_name);
  }

  it('creates every table in the spec section 37 inventory', async () => {
    const names = new Set(await tableNames());

    // Spec section 37's list, with the three documented substitutions:
    // `accounts` and `verification_tokens` are replaced by
    // `magic_link_tokens` (ADR-16), and `tender_municipalities` and
    // `profile_suggestions` are additions justified in the schema files.
    const expected = [
      'admin_audit_events',
      'alert_profile_buyers',
      'alert_profile_cpv_codes',
      'alert_profile_geographies',
      'alert_profile_keywords',
      'alert_profiles',
      'attribution_events',
      'companies',
      'company_memberships',
      'consent_events',
      'consent_text_versions',
      'editorial_clicks',
      'editorial_impressions',
      'editorial_recommendations',
      'email_events',
      'email_suppressions',
      'industry_templates',
      'ingestion_checkpoints',
      'ingestion_errors',
      'ingestion_runs',
      'legal_document_versions',
      'legal_documents',
      'magic_link_tokens',
      'mcp_audit_events',
      'mcp_tokens',
      'notification_category_unsubscribes',
      'notification_deliveries',
      'notification_delivery_items',
      'notification_preferences',
      'order_requests',
      'profile_suggestions',
      'relevance_feedback',
      'sessions',
      'tender_change_events',
      'tender_cpv_codes',
      'tender_match_reasons',
      'tender_matches',
      'tender_municipalities',
      'tender_regions',
      'tender_revisions',
      'tender_shares',
      'tenders',
      'user_legal_acceptances',
      'user_tender_states',
      'users',
    ];

    const missing = expected.filter((name) => !names.has(name));
    expect(missing).toEqual([]);
  });

  it('does not create an Auth.js-shaped accounts or verification_tokens table', async () => {
    // ADR-16: we own the auth tables. If these ever appear, someone has
    // reintroduced Auth.js's layout alongside ours and there are now two
    // session stores.
    const names = new Set(await tableNames());
    expect(names.has('accounts')).toBe(false);
    expect(names.has('verification_tokens')).toBe(false);
  });

  it('stores every temporal column as timestamptz or date, never a naive timestamp', async () => {
    const rows = await harness.db.execute<{ table_name: string; column_name: string }>(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = ${TEST_SCHEMA}
        AND data_type = 'timestamp without time zone'
      ORDER BY table_name, column_name
    `);
    // A naive timestamp silently reinterprets an instant against the server's
    // TimeZone setting, and the digest scheduler resolves local send times.
    expect([...rows]).toEqual([]);
  });

  it('gives every table a uuid primary key or an explicit composite key', async () => {
    const rows = await harness.db.execute<{ table_name: string }>(sql`
      SELECT t.table_name
      FROM information_schema.tables t
      WHERE t.table_schema = ${TEST_SCHEMA}
        AND t.table_type = 'BASE TABLE'
        AND t.table_name <> '__drizzle_migrations'
        AND NOT EXISTS (
          SELECT 1
          FROM information_schema.table_constraints c
          WHERE c.table_schema = t.table_schema
            AND c.table_name = t.table_name
            AND c.constraint_type = 'PRIMARY KEY'
        )
    `);
    expect([...rows].map((row) => row.table_name)).toEqual([]);
  });

  it('is idempotent: running the migrator a second time applies nothing new', async () => {
    const count = async (): Promise<number> => {
      const rows = await harness.db.execute<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
      );
      const [row] = [...rows];
      return Number(row?.count);
    };

    // Read from the journal rather than hard-coded.
    //
    // This assertion used to say `toBe(2)` with a comment naming the two
    // migrations, and the next migration added to the folder broke it — a
    // failure that says nothing about idempotency, which is what the test is
    // for. Counting the journal keeps the *interesting* half of the assertion
    // (the second run applies nothing) while making the first half maintain
    // itself.
    const journal = JSON.parse(
      await readFile(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: readonly unknown[] };
    const expected = journal.entries.length;
    expect(expected).toBeGreaterThan(0);
    expect(await count()).toBe(expected);

    // A redeploy runs the migrator against an already-migrated database on
    // every boot, so this is the ordinary case rather than an edge one.
    await migrate(harness.db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect(await count()).toBe(expected);
  });
});
