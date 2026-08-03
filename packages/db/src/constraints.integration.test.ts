import { randomBytes, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alertProfiles,
  consentTextVersions,
  notificationDeliveries,
  notificationDeliveryItems,
  tenderMatches,
  tenderShares,
  tenders,
  users,
} from './schema/index.js';
import {
  createTestDatabase,
  expectRejection,
  hasDatabase,
  type TestDatabase,
} from './testing/harness.js';

/**
 * The constraints spec section 37 makes explicit, proven by writing the row
 * the constraint is supposed to refuse and watching the database refuse it.
 *
 * A constraint that has only ever been read in a schema file is a constraint
 * nobody has tested. Every case here performs the offending write.
 */
describe.skipIf(!hasDatabase)('spec section 37 constraints', () => {
  let harness: TestDatabase;

  beforeAll(async () => {
    harness = await createTestDatabase();
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

  async function insertTender(sourceId = randomUUID()): Promise<string> {
    const [row] = await harness.db
      .insert(tenders)
      .values({
        source: 'doffin',
        sourceId,
        sourceUrl: `https://www.doffin.no/notices/${sourceId}`,
        title: 'Rammeavtale for rehabilitering av skolebygg',
        buyerName: 'Oslo kommune',
        noticeCategory: 'competition',
        publishedAt: new Date('2026-07-01T00:00:00Z'),
        sourcePayloadHash: randomUUID(),
        rawPayload: { id: sourceId },
      })
      .returning({ id: tenders.id });
    if (!row) throw new Error('tender insert returned no row');
    return row.id;
  }

  async function insertProfile(userId: string): Promise<string> {
    const [row] = await harness.db
      .insert(alertProfiles)
      .values({ userId, name: 'Bygg og rehabilitering' })
      .returning({ id: alertProfiles.id });
    if (!row) throw new Error('profile insert returned no row');
    return row.id;
  }

  it('rejects a second tender with the same (source, source_id)', async () => {
    const sourceId = randomUUID();
    await insertTender(sourceId);

    // This is what makes the ingest upsert idempotent, and therefore what
    // stops a re-fetched notice producing a second round of alerts
    // (spec section 52 item 5).
    await expectRejection(insertTender(sourceId), /tenders_source_source_id_key|duplicate key/i);
  });

  it('rejects a second match for the same (tender, profile, matching_version)', async () => {
    const userId = await insertUser();
    const tenderId = await insertTender();
    const alertProfileId = await insertProfile(userId);

    const values = {
      tenderId,
      alertProfileId,
      score: 82.5,
      confidence: 'high' as const,
      included: true,
      matchingVersion: 'v1',
    };

    await harness.db.insert(tenderMatches).values(values);
    await expectRejection(
      harness.db.insert(tenderMatches).values(values),
      /tender_matches_tender_profile_version_key|duplicate key/i,
    );
  });

  it('allows the same tender and profile at a different matching version', async () => {
    const userId = await insertUser();
    const tenderId = await insertTender();
    const alertProfileId = await insertProfile(userId);

    // Re-scoring under a new algorithm version must be possible, or the
    // versioning requirement in spec section 14 is unusable. The constraint
    // above must not be so broad that it forbids this.
    await harness.db.insert(tenderMatches).values({
      tenderId,
      alertProfileId,
      score: 40,
      confidence: 'low',
      included: true,
      matchingVersion: 'v1',
    });
    await harness.db.insert(tenderMatches).values({
      tenderId,
      alertProfileId,
      score: 71,
      confidence: 'medium',
      included: true,
      matchingVersion: 'v2',
    });

    const rows = await harness.db
      .select()
      .from(tenderMatches)
      .where(eq(tenderMatches.tenderId, tenderId));
    expect(rows).toHaveLength(2);
  });

  it('rejects the same tender twice in one notification', async () => {
    const userId = await insertUser();
    const tenderId = await insertTender();

    const [delivery] = await harness.db
      .insert(notificationDeliveries)
      .values({
        userId,
        kind: 'daily_digest',
        messageStream: 'tender_notifications',
        scheduledFor: new Date('2026-08-04T05:00:00Z'),
        idempotencyKey: randomUUID(),
      })
      .returning({ id: notificationDeliveries.id });
    if (!delivery) throw new Error('delivery insert returned no row');

    await harness.db
      .insert(notificationDeliveryItems)
      .values({ deliveryId: delivery.id, tenderId });

    // Spec section 37's "unik delivery item". This is the constraint behind
    // "duplikater gir ikke doble varsler" (spec section 52 item 5): two of the
    // user's profiles matching the same tender in one window still yields one
    // card in the email.
    await expectRejection(
      harness.db.insert(notificationDeliveryItems).values({ deliveryId: delivery.id, tenderId }),
      /notification_delivery_items_delivery_tender_key|duplicate key/i,
    );
  });

  it('rejects a duplicate notification idempotency key', async () => {
    const userId = await insertUser();
    const values = {
      userId,
      kind: 'daily_digest' as const,
      messageStream: 'tender_notifications' as const,
      scheduledFor: new Date('2026-08-04T05:00:00Z'),
      idempotencyKey: `digest:${userId}:2026-08-04`,
    };

    await harness.db.insert(notificationDeliveries).values(values);
    // At-least-once job delivery (spec section 38) means the digest preparer
    // will run twice sooner or later. This is what stops the second run
    // sending a second email.
    await expectRejection(
      harness.db.insert(notificationDeliveries).values(values),
      /notification_deliveries_idempotency_key|duplicate key/i,
    );
  });

  it('rejects a duplicate share token', async () => {
    const userId = await insertUser();
    const tenderId = await insertTender();

    const values = {
      tenderId,
      createdByUserId: userId,
      token: randomBytes(32).toString('base64url'),
      expiresAt: new Date('2026-09-01T00:00:00Z'),
    };

    await harness.db.insert(tenderShares).values(values);
    await expectRejection(
      harness.db.insert(tenderShares).values(values),
      /tender_shares_token_key|duplicate key/i,
    );
  });

  it('rejects a share token shorter than 32 characters', async () => {
    const userId = await insertUser();
    const tenderId = await insertTender();

    // The floor exists so a future caller cannot shorten the token "for nicer
    // URLs" and turn the public share page into an enumerable surface
    // (spec section 40).
    await expectRejection(
      harness.db.insert(tenderShares).values({
        tenderId,
        createdByUserId: userId,
        token: 'short-token',
        expiresAt: new Date('2026-09-01T00:00:00Z'),
      }),
      /tender_shares_token_length|check constraint/i,
    );
  });

  it('rejects a consent event naming a text version that does not exist', async () => {
    const userId = await insertUser();

    // ADR-9 rule 3: the exact wording is captured by reference, so an event
    // cannot claim a version nobody wrote.
    await expectRejection(
      harness.db.execute(sql`
        INSERT INTO consent_events
          (user_id, consent_type, status, source, consent_text_version, occurred_at)
        VALUES (${userId}, 'marketing_email', 'granted', 'signup', 'never-written', now())
      `),
      /consent_events_text_version_fk|foreign key/i,
    );
  });

  it('rejects admin-recorded consent without documented grounds', async () => {
    const userId = await insertUser();
    await harness.db.insert(consentTextVersions).values({
      consentType: 'marketing_email',
      version: '1.0',
      body: 'Ja, jeg ønsker å motta nyheter fra Luma Training på e-post.',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });

    // Spec section 21: an administrator may not create consent without a
    // documented basis. ADR-9 rule 4 makes that structural rather than a
    // review comment.
    await expectRejection(
      harness.db.execute(sql`
        INSERT INTO consent_events
          (user_id, consent_type, status, source, consent_text_version, occurred_at)
        VALUES (${userId}, 'marketing_email', 'granted', 'admin_recorded', '1.0', now())
      `),
      /consent_events_admin_source_detail_required|check constraint/i,
    );

    // The same event with grounds is accepted, so the constraint is not simply
    // blocking the whole source.
    await harness.db.execute(sql`
      INSERT INTO consent_events
        (user_id, consent_type, status, source, source_detail, consent_text_version, occurred_at)
      VALUES (${userId}, 'marketing_email', 'granted', 'admin_recorded',
              'Signert kursdeltakerskjema, sak 2026-118', '1.0', now())
    `);
  });

  it('rejects an alert profile whose value floor is above its ceiling', async () => {
    const userId = await insertUser();
    await expectRejection(
      harness.db.insert(alertProfiles).values({
        userId,
        name: 'Umulig',
        estimatedValueMinNok: 5_000_000,
        estimatedValueMaxNok: 1_000_000,
      }),
      /alert_profiles_value_range_ordered|check constraint/i,
    );
  });

  it('rejects a digest hour outside 0 to 23', async () => {
    const userId = await insertUser();
    await expectRejection(
      harness.db.insert(alertProfiles).values({
        userId,
        name: 'Time 24',
        digestHourLocal: 24,
      }),
      /alert_profiles_digest_hour_range|check constraint/i,
    );
  });

  it('rejects a match reason that claims to be a reason but carries no type', async () => {
    const userId = await insertUser();
    const tenderId = await insertTender();
    const alertProfileId = await insertProfile(userId);
    const [match] = await harness.db
      .insert(tenderMatches)
      .values({
        tenderId,
        alertProfileId,
        score: 55,
        confidence: 'medium',
        included: true,
        matchingVersion: 'v1',
      })
      .returning({ id: tenderMatches.id });
    if (!match) throw new Error('match insert returned no row');

    // The shape check keeps `entry_type`, `reason_type` and `contribution`
    // consistent, so a reason cannot be stored without the explanation spec
    // section 4.2 promises the user.
    await expectRejection(
      harness.db.execute(sql`
        INSERT INTO tender_match_reasons (match_id, entry_type, type_key, label)
        VALUES (${match.id}, 'reason', 'cpv', 'CPV-treff')
      `),
      /tender_match_reasons_shape|check constraint/i,
    );

    // An exclusion, whose type is an open string in the domain model, is
    // accepted without a `reason_type` or a contribution.
    await harness.db.execute(sql`
      INSERT INTO tender_match_reasons (match_id, entry_type, type_key, label)
      VALUES (${match.id}, 'exclusion', 'closed', 'Konkurransen er stengt')
    `);
  });

  it('rejects an MCP token with no scopes', async () => {
    const userId = await insertUser();
    // A scopeless token can do nothing; creating one is a bug in the token
    // creation path, not a deliberate choice.
    await expectRejection(
      harness.db.execute(sql`
        INSERT INTO mcp_tokens (user_id, name, prefix, token_hash, scopes)
        VALUES (${userId}, 'Tom', 'luma_00', ${randomBytes(32).toString('hex')}, '{}')
      `),
      /mcp_tokens_scopes_not_empty|check constraint/i,
    );
  });
});
