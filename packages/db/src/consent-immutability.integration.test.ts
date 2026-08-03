import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isConsentActive, type ConsentEvent } from '@luma/domain';
import { consentEvents, consentTextVersions, users } from './schema/index.js';
import {
  createTestDatabase,
  expectRejection,
  hasDatabase,
  TEST_SCHEMA,
  type TestDatabase,
} from './testing/harness.js';

/**
 * ADR-9's verification hook: the append-only guarantee on `consent_events` is
 * enforced by the database, not by convention.
 *
 * The trigger in `0001_append_only_consent_guard.sql` is the thing under test.
 * If someone drops it, or rewrites it to a no-op, these tests go red — which
 * is the point. An assertion that "application code only inserts" would pass
 * against a completely unguarded table.
 */
describe.skipIf(!hasDatabase)('consent_events immutability (ADR-9)', () => {
  let harness: TestDatabase;

  beforeAll(async () => {
    harness = await createTestDatabase();
    await harness.db.insert(consentTextVersions).values([
      {
        consentType: 'marketing_email',
        version: '1.0',
        body: 'Ja, jeg ønsker å motta nyheter, faglig innhold og informasjon om kurs fra Luma Training på e-post.',
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      },
      {
        consentType: 'terms_acceptance',
        version: '1.0',
        body: 'Jeg godtar vilkårene for bruk.',
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
  });

  afterAll(async () => {
    await harness?.destroy();
  });

  async function insertUser(): Promise<string> {
    const [row] = await harness.db
      .insert(users)
      .values({ email: `${randomUUID()}@example.test` })
      .returning({ id: users.id });
    if (!row) throw new Error('user insert returned no row');
    return row.id;
  }

  async function record(userId: string, occurredAt: Date, status: 'granted' | 'withdrawn') {
    const [row] = await harness.db
      .insert(consentEvents)
      .values({
        userId,
        consentType: 'marketing_email',
        status,
        source: 'account_settings',
        consentTextVersion: '1.0',
        occurredAt,
      })
      .returning();
    if (!row) throw new Error('consent insert returned no row');
    return row;
  }

  it('refuses an UPDATE', async () => {
    const userId = await insertUser();
    const event = await record(userId, new Date('2026-02-01T09:00:00Z'), 'granted');

    await expectRejection(
      harness.db
        .update(consentEvents)
        .set({ status: 'withdrawn' })
        .where(eq(consentEvents.id, event.id)),
      /append-only/i,
    );

    const [after] = await harness.db
      .select()
      .from(consentEvents)
      .where(eq(consentEvents.id, event.id));
    expect(after?.status).toBe('granted');
  });

  it('refuses a DELETE', async () => {
    const userId = await insertUser();
    const event = await record(userId, new Date('2026-02-01T09:00:00Z'), 'granted');

    await expectRejection(
      harness.db.delete(consentEvents).where(eq(consentEvents.id, event.id)),
      /append-only/i,
    );

    const rows = await harness.db
      .select()
      .from(consentEvents)
      .where(eq(consentEvents.id, event.id));
    expect(rows).toHaveLength(1);
  });

  it('refuses a bulk DELETE that would clear the whole log', async () => {
    const userId = await insertUser();
    await record(userId, new Date('2026-02-01T09:00:00Z'), 'granted');

    await expectRejection(harness.db.execute(sql`DELETE FROM consent_events`), /append-only/i);
  });

  it('refuses an UPDATE that nulls user_id while also changing another column', async () => {
    const userId = await insertUser();
    const event = await record(userId, new Date('2026-02-01T09:00:00Z'), 'granted');

    // The account-deletion exemption must not be usable as a side door: this
    // nulls the reference *and* flips the status in one statement.
    await expectRejection(
      harness.db.execute(sql`
        UPDATE consent_events
        SET user_id = NULL, status = 'withdrawn'
        WHERE id = ${event.id}
      `),
      /append-only/i,
    );

    const [after] = await harness.db
      .select()
      .from(consentEvents)
      .where(eq(consentEvents.id, event.id));
    expect(after?.status).toBe('granted');
    expect(after?.userId).toBe(userId);
  });

  it('permits exactly one UPDATE: severing user_id on account deletion', async () => {
    const userId = await insertUser();
    const event = await record(userId, new Date('2026-02-01T09:00:00Z'), 'granted');

    // This is the ON DELETE SET NULL path. Spec section 40 requires account
    // deletion to work; ADR-9 requires the event to survive it. Both.
    await harness.db.delete(users).where(eq(users.id, userId));

    const [after] = await harness.db
      .select()
      .from(consentEvents)
      .where(eq(consentEvents.id, event.id));

    expect(after).toBeDefined();
    expect(after?.userId).toBeNull();
    // Everything else is unchanged.
    expect(after?.status).toBe('granted');
    expect(after?.consentTextVersion).toBe('1.0');
    expect(after?.source).toBe('account_settings');
    expect(after?.occurredAt.toISOString()).toBe(event.occurredAt.toISOString());
  });

  it('records grant, withdraw and re-grant as three rows, and derives the latest', async () => {
    const userId = await insertUser();
    const first = await record(userId, new Date('2026-02-01T09:00:00Z'), 'granted');
    await record(userId, new Date('2026-03-01T09:00:00Z'), 'withdrawn');
    await record(userId, new Date('2026-04-01T09:00:00Z'), 'granted');

    const rows = await harness.db
      .select()
      .from(consentEvents)
      .where(
        and(eq(consentEvents.userId, userId), eq(consentEvents.consentType, 'marketing_email')),
      );

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.status).sort()).toEqual(['granted', 'granted', 'withdrawn']);

    // The first row is untouched by everything that came after it.
    const original = rows.find((row) => row.id === first.id);
    expect(original?.status).toBe('granted');
    expect(original?.occurredAt.toISOString()).toBe(first.occurredAt.toISOString());

    // And the derived status agrees with the domain function, which is the
    // only sanctioned reader of this log.
    const asDomain = rows.map((row): ConsentEvent => ({
      id: row.id,
      userId: row.userId ?? userId,
      consentType: row.consentType,
      status: row.status,
      source: row.source,
      consentTextVersion: row.consentTextVersion,
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
    }));
    expect(isConsentActive(asDomain, 'marketing_email')).toBe(true);
  });

  it('guards user_legal_acceptances the same way', async () => {
    const userId = await insertUser();
    const documentId = randomUUID();
    await harness.db.execute(sql`
      INSERT INTO legal_documents (id, kind, title)
      VALUES (${documentId}, 'terms', 'Vilkår for bruk')
    `);
    await harness.db.execute(sql`
      INSERT INTO legal_document_versions
        (legal_document_id, kind, version, body, is_placeholder, effective_from)
      VALUES (${documentId}, 'terms', '1.0', 'Vilkår for bruk ...', false, now())
    `);

    const acceptanceId = randomUUID();
    await harness.db.execute(sql`
      INSERT INTO user_legal_acceptances (id, user_id, kind, version, accepted_at)
      VALUES (${acceptanceId}, ${userId}, 'terms', '1.0', now())
    `);

    await expectRejection(
      harness.db.execute(
        sql`UPDATE user_legal_acceptances SET accepted_at = now() WHERE id = ${acceptanceId}`,
      ),
      /append-only/i,
    );

    await expectRejection(
      harness.db.execute(sql`DELETE FROM user_legal_acceptances WHERE id = ${acceptanceId}`),
      /append-only/i,
    );

    // Account deletion still works, and still leaves the acceptance behind.
    await harness.db.delete(users).where(eq(users.id, userId));
    const rows = await harness.db.execute<{ user_id: string | null }>(
      sql`SELECT user_id FROM user_legal_acceptances WHERE id = ${acceptanceId}`,
    );
    const [surviving] = [...rows];
    expect(surviving).toBeDefined();
    expect(surviving?.user_id).toBeNull();
  });

  it('has the guard trigger installed on both tables', async () => {
    // A direct check on the guard's existence, so a dropped trigger fails with
    // a clear message rather than as a mysteriously-passing update above.
    const rows = await harness.db.execute<{ event_object_table: string }>(sql`
      SELECT DISTINCT event_object_table
      FROM information_schema.triggers
      WHERE trigger_schema = ${TEST_SCHEMA}
        AND action_statement LIKE '%luma_append_only_guard%'
      ORDER BY event_object_table
    `);
    expect([...rows].map((row) => row.event_object_table)).toEqual([
      'consent_events',
      'user_legal_acceptances',
    ]);
  });
});
