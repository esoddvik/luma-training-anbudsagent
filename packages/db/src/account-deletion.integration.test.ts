import { randomBytes, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alertProfiles,
  attributionEvents,
  consentEvents,
  consentTextVersions,
  mcpTokens,
  notificationPreferences,
  orderRequests,
  sessions,
  tenderShares,
  tenders,
  users,
} from './schema/index.js';
import { createTestDatabase, hasDatabase, type TestDatabase } from './testing/harness.js';

/**
 * What account deletion actually does (spec section 40, section 52 item 14).
 *
 * The schema comments claim a specific behaviour per foreign key: cascade for
 * the person's own activity, sever for evidence and aggregates. This suite is
 * where those claims are checked, because a wrong `onDelete` is invisible
 * until the day someone exercises their right to erasure and the delete either
 * fails outright or takes the accounting records with it.
 */
describe.skipIf(!hasDatabase)('account deletion', () => {
  let harness: TestDatabase;

  beforeAll(async () => {
    harness = await createTestDatabase();
    await harness.db.insert(consentTextVersions).values({
      consentType: 'marketing_email',
      version: '1.0',
      body: 'Ja, jeg ønsker å motta nyheter fra Luma Training på e-post.',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });
  });

  afterAll(async () => {
    await harness?.destroy();
  });

  async function seedUserWithEverything() {
    const [user] = await harness.db
      .insert(users)
      .values({ email: `${randomUUID()}@example.test` })
      .returning({ id: users.id });
    if (!user) throw new Error('user insert returned no row');
    const userId = user.id;

    const sourceId = randomUUID();
    const [tender] = await harness.db
      .insert(tenders)
      .values({
        source: 'doffin',
        sourceId,
        sourceUrl: `https://www.doffin.no/notices/${sourceId}`,
        title: 'Renhold av kommunale bygg',
        buyerName: 'Bergen kommune',
        noticeCategory: 'competition',
        publishedAt: new Date('2026-07-01T00:00:00Z'),
        sourcePayloadHash: randomUUID(),
        rawPayload: { id: sourceId },
      })
      .returning({ id: tenders.id });
    if (!tender) throw new Error('tender insert returned no row');

    await harness.db.insert(sessions).values({
      userId,
      tokenHash: randomBytes(32).toString('hex'),
      expiresAt: new Date('2026-09-01T00:00:00Z'),
    });
    await harness.db.insert(alertProfiles).values({ userId, name: 'Renhold' });
    await harness.db.insert(notificationPreferences).values({ userId });
    await harness.db.insert(mcpTokens).values({
      userId,
      name: 'Claude Desktop',
      prefix: 'luma_ab',
      tokenHash: randomBytes(32).toString('hex'),
      scopes: ['tenders:read'],
    });

    const [share] = await harness.db
      .insert(tenderShares)
      .values({
        tenderId: tender.id,
        createdByUserId: userId,
        token: randomBytes(32).toString('base64url'),
        expiresAt: new Date('2026-09-01T00:00:00Z'),
      })
      .returning({ id: tenderShares.id });
    if (!share) throw new Error('share insert returned no row');

    await harness.db.insert(consentEvents).values({
      userId,
      consentType: 'marketing_email',
      status: 'granted',
      source: 'signup',
      consentTextVersion: '1.0',
      occurredAt: new Date('2026-02-01T09:00:00Z'),
    });

    const [order] = await harness.db
      .insert(orderRequests)
      .values({
        userId,
        productCode: 'paafyll',
        productName: 'Påfyll',
        billingCompanyName: 'Testfirma AS',
        organizationNumber: '123456789',
        billingAddress: 'Storgata 1',
        billingPostalCode: '0155',
        billingCity: 'Oslo',
        invoiceEmail: 'faktura@testfirma.test',
        contactPerson: 'Kari Nordmann',
      })
      .returning({ id: orderRequests.id });
    if (!order) throw new Error('order insert returned no row');

    const [attribution] = await harness.db
      .insert(attributionEvents)
      .values({
        type: 'tool_to_paafyll',
        userId,
        tenderId: tender.id,
        shareId: share.id,
        occurredAt: new Date('2026-03-01T09:00:00Z'),
      })
      .returning({ id: attributionEvents.id });
    if (!attribution) throw new Error('attribution insert returned no row');

    return { userId, tenderId: tender.id, shareId: share.id, orderId: order.id };
  }

  it('succeeds, and is not blocked by any restricted reference', async () => {
    const seeded = await seedUserWithEverything();
    // If any foreign key to `users` were RESTRICT, this would throw and the
    // right to erasure would be unimplementable.
    await expect(
      harness.db.delete(users).where(eq(users.id, seeded.userId)),
    ).resolves.toBeDefined();
  });

  it('removes the personal activity: sessions, profiles, preferences, tokens, shares', async () => {
    const seeded = await seedUserWithEverything();
    await harness.db.delete(users).where(eq(users.id, seeded.userId));

    const remaining = await Promise.all([
      harness.db.select().from(sessions).where(eq(sessions.userId, seeded.userId)),
      harness.db.select().from(alertProfiles).where(eq(alertProfiles.userId, seeded.userId)),
      harness.db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, seeded.userId)),
      harness.db.select().from(mcpTokens).where(eq(mcpTokens.userId, seeded.userId)),
      harness.db.select().from(tenderShares).where(eq(tenderShares.createdByUserId, seeded.userId)),
    ]);

    expect(remaining.map((rows) => rows.length)).toEqual([0, 0, 0, 0, 0]);
  });

  it('retains the consent event with the user reference severed', async () => {
    const seeded = await seedUserWithEverything();
    await harness.db.delete(users).where(eq(users.id, seeded.userId));

    // ADR-9: the controller must still be able to demonstrate the basis for
    // marketing sent before deletion.
    const rows = await harness.db.execute<{ user_id: string | null; status: string }>(sql`
      SELECT user_id, status FROM consent_events WHERE consent_text_version = '1.0'
    `);
    const severed = [...rows].filter((row) => row.user_id === null);
    expect(severed.length).toBeGreaterThan(0);
  });

  it('retains the order request as an accounting record, with the reference severed', async () => {
    const seeded = await seedUserWithEverything();
    await harness.db.delete(users).where(eq(users.id, seeded.userId));

    const [order] = await harness.db
      .select()
      .from(orderRequests)
      .where(eq(orderRequests.id, seeded.orderId));

    expect(order).toBeDefined();
    expect(order?.userId).toBeNull();
    // The invoice basis itself survives.
    expect(order?.billingCompanyName).toBe('Testfirma AS');
  });

  it('retains the attribution event so past quarters are not restated', async () => {
    const seeded = await seedUserWithEverything();
    const before = await harness.db
      .select()
      .from(attributionEvents)
      .where(eq(attributionEvents.type, 'tool_to_paafyll'));

    await harness.db.delete(users).where(eq(users.id, seeded.userId));

    const after = await harness.db
      .select()
      .from(attributionEvents)
      .where(eq(attributionEvents.type, 'tool_to_paafyll'));

    // Same count, no user reference. Deleting the share cascades from the
    // user, so `share_id` severs too — but the event is still counted.
    expect(after).toHaveLength(before.length);
    const affected = after.filter((row) => row.userId === null);
    expect(affected.length).toBeGreaterThan(0);
  });
});
