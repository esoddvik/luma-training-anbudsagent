import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  hasDatabase,
  TEST_SCHEMA,
  type TestDatabase,
} from './testing/harness.js';

/**
 * ADR-6's schema test, and spec section 37's last constraint:
 * `attribution_events` must not be linkable to matching logic.
 *
 * This reads `information_schema` rather than the TypeScript schema, because
 * the claim is about the database. A column added by a hand-written migration
 * would be invisible to a source-level check.
 */
describe.skipIf(!hasDatabase)('attribution is isolated from matching (ADR-6)', () => {
  let harness: TestDatabase;

  beforeAll(async () => {
    harness = await createTestDatabase();
  });

  afterAll(async () => {
    await harness?.destroy();
  });

  async function foreignKeyTargets(
    tableName: string,
  ): Promise<Array<{ column: string; target: string }>> {
    const rows = await harness.db.execute<{ column_name: string; foreign_table_name: string }>(sql`
      SELECT kcu.column_name, ccu.table_name AS foreign_table_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = ${TEST_SCHEMA}
        AND tc.table_name = ${tableName}
    `);
    return [...rows].map((row) => ({
      column: row.column_name,
      target: row.foreign_table_name,
    }));
  }

  it('has no foreign key from attribution_events into the match tables', async () => {
    const targets = await foreignKeyTargets('attribution_events');
    const forbidden = ['tender_matches', 'tender_match_reasons', 'alert_profiles'];

    const violations = targets.filter((fk) => forbidden.includes(fk.target));
    // If this fails, somebody has made it possible to rank tenders by the
    // revenue they produced, which spec section 44.3 and section 4.1 both
    // forbid — and which the product's central trust promise depends on.
    expect(violations).toEqual([]);
  });

  it('permits exactly the reporting references the spec allows', async () => {
    const targets = await foreignKeyTargets('attribution_events');
    const byTarget = targets.map((fk) => fk.target).sort();

    // `tender_id` is named in spec section 37 as the one permitted tender-side
    // reference. The other three are commercial-side and uncontroversial.
    expect(byTarget).toEqual(['editorial_recommendations', 'tender_shares', 'tenders', 'users']);
  });

  it('has no column on attribution_events that names a match or a profile', async () => {
    // Catches the shape a foreign-key check would miss: a bare
    // `alert_profile_id uuid` with no constraint, joined in application code.
    const rows = await harness.db.execute<{ column_name: string }>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${TEST_SCHEMA}
        AND table_name = 'attribution_events'
        AND (column_name LIKE '%match%' OR column_name LIKE '%profile%'
             OR column_name LIKE '%score%')
    `);
    expect([...rows].map((row) => row.column_name)).toEqual([]);
  });

  it('has no foreign key from the editorial tables into the match tables', async () => {
    // ADR-14: the promotion ladder must not read ranking either.
    for (const table of ['editorial_impressions', 'editorial_clicks']) {
      const targets = await foreignKeyTargets(table);
      const violations = targets.filter((fk) =>
        ['tender_matches', 'tender_match_reasons', 'alert_profiles'].includes(fk.target),
      );
      expect({ table, violations }).toEqual({ table, violations: [] });
    }
  });

  it('keeps marketing consent out of notification_preferences', async () => {
    // ADR-9: consent is an event log, never a boolean. A
    // `marketing_email_consent` column here would be a second source of truth
    // that cannot demonstrate what the user agreed to.
    const rows = await harness.db.execute<{ column_name: string }>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${TEST_SCHEMA}
        AND table_name = 'notification_preferences'
        AND column_name LIKE '%consent%'
    `);
    expect([...rows]).toEqual([]);
  });
});
