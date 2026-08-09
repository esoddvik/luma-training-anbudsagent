import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { userEntitlements, users } from '@luma/db';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import {
  expiringEntitlements,
  grantEntitlement,
  hasEntitlement,
  revokeEntitlement,
} from './entitlements.js';

/**
 * Paid access against a real database (IDE Agent Spec v3, section 4.2).
 *
 * The properties here are the ones a manual billing flow has instead of a
 * payment processor: a grant that can be renewed without stacking, a
 * revocation that takes effect now and leaves the audit trail behind, and a
 * renewal list a person can act on. If any of them is wrong, the failure is
 * either a customer who paid and cannot use what they bought, or one who
 * stopped paying and still can.
 */

const describeDb = hasDatabase ? describe : describe.skip;
const NOW = new Date('2026-08-09T12:00:00Z');

describeDb('entitlements', () => {
  let harness: TestDatabase;
  let db: TestDatabase['db'];
  let userId: string;

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db;
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table ${users} restart identity cascade`);
    const [user] = await db
      .insert(users)
      .values({ email: 'kunde@entreprenor.no' })
      .returning({ id: users.id });
    userId = user!.id;
  });

  it('grants access that reads as live', async () => {
    await grantEntitlement(db, {
      userId,
      productCode: 'pluss',
      expiresAt: new Date('2027-01-01T00:00:00Z'),
      now: NOW,
    });

    expect(await hasEntitlement(db, { userId, productCode: 'pluss', now: NOW })).toBe(true);
  });

  it('gives no access to a user who was never granted any', async () => {
    expect(await hasEntitlement(db, { userId, productCode: 'pluss', now: NOW })).toBe(false);
  });

  it('renews by extending the one row rather than stacking a second', async () => {
    // Two overlapping grants would make "when does this lapse" unanswerable,
    // which is the question the renewal report exists to ask.
    await grantEntitlement(db, {
      userId,
      productCode: 'pluss',
      expiresAt: new Date('2026-09-01T00:00:00Z'),
      now: NOW,
    });
    await grantEntitlement(db, {
      userId,
      productCode: 'pluss',
      expiresAt: new Date('2027-09-01T00:00:00Z'),
      now: NOW,
    });

    const rows = await db
      .select()
      .from(userEntitlements)
      .where(eq(userEntitlements.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.expiresAt).toEqual(new Date('2027-09-01T00:00:00Z'));
  });

  it('stops access at expiry without anything having to run', async () => {
    // No job sweeps lapsed entitlements, and none should: access is decided by
    // reading the row against the clock, so a worker outage cannot accidentally
    // extend or terminate a subscription.
    await grantEntitlement(db, {
      userId,
      productCode: 'pluss',
      expiresAt: new Date('2026-08-01T00:00:00Z'),
      now: new Date('2025-08-01T00:00:00Z'),
    });

    expect(await hasEntitlement(db, { userId, productCode: 'pluss', now: NOW })).toBe(false);
  });

  it('revokes immediately and keeps the record of the grant', async () => {
    await grantEntitlement(db, {
      userId,
      productCode: 'pluss',
      expiresAt: new Date('2027-01-01T00:00:00Z'),
      now: NOW,
    });
    await revokeEntitlement(db, {
      userId,
      productCode: 'pluss',
      reason: 'Refundert etter feilbestilling.',
      now: NOW,
    });

    expect(await hasEntitlement(db, { userId, productCode: 'pluss', now: NOW })).toBe(false);

    // The row survives: it is the audit trail for an invoice raised by hand,
    // and deleting it would leave the invoice with nothing to explain it.
    const [row] = await db
      .select()
      .from(userEntitlements)
      .where(eq(userEntitlements.userId, userId));
    expect(row!.revokedReason).toBe('Refundert etter feilbestilling.');
  });

  it('restores access when a revoked customer is granted again', async () => {
    await grantEntitlement(db, { userId, productCode: 'pluss', expiresAt: null, now: NOW });
    await revokeEntitlement(db, { userId, productCode: 'pluss', reason: 'Feil', now: NOW });
    await grantEntitlement(db, { userId, productCode: 'pluss', expiresAt: null, now: NOW });

    // A row that reads as live and behaves as dead is the worst of both.
    expect(await hasEntitlement(db, { userId, productCode: 'pluss', now: NOW })).toBe(true);
    const [row] = await db
      .select()
      .from(userEntitlements)
      .where(eq(userEntitlements.userId, userId));
    expect(row!.revokedAt).toBeNull();
    expect(row!.revokedReason).toBeNull();
  });

  it('takes access with the account when it is deleted', async () => {
    // Spec section 40 requires deletion to work; an entitlement is the
    // person's own access and cascades rather than severing.
    await grantEntitlement(db, { userId, productCode: 'pluss', expiresAt: null, now: NOW });
    await db.delete(users).where(eq(users.id, userId));
    expect(await db.$count(userEntitlements)).toBe(0);
  });

  describe('the renewal reminder', () => {
    it('lists what lapses inside the window', async () => {
      await grantEntitlement(db, {
        userId,
        productCode: 'pluss',
        expiresAt: new Date('2026-09-15T00:00:00Z'),
        now: NOW,
      });

      const due = await expiringEntitlements(db, { now: NOW, withinDays: 60 });
      expect(due.map((entry) => entry.productCode)).toEqual(['pluss']);
    });

    it('leaves out what lapses beyond it', async () => {
      await grantEntitlement(db, {
        userId,
        productCode: 'pluss',
        expiresAt: new Date('2027-06-01T00:00:00Z'),
        now: NOW,
      });
      expect(await expiringEntitlements(db, { now: NOW, withinDays: 60 })).toEqual([]);
    });

    it('leaves out grants that never expire', async () => {
      // They do not lapse, so they are not a renewal reminder. Reading a null
      // as "expired long ago" would fill the list with permanent access.
      await grantEntitlement(db, { userId, productCode: 'pluss', expiresAt: null, now: NOW });
      expect(await expiringEntitlements(db, { now: NOW, withinDays: 60 })).toEqual([]);
    });

    it('leaves out what has already lapsed', async () => {
      // Already gone is history, not a reminder. Mixing the two makes the list
      // something an administrator stops reading.
      await grantEntitlement(db, {
        userId,
        productCode: 'pluss',
        expiresAt: new Date('2026-01-01T00:00:00Z'),
        now: new Date('2025-01-01T00:00:00Z'),
      });
      expect(await expiringEntitlements(db, { now: NOW, withinDays: 60 })).toEqual([]);
    });

    it('leaves out a revoked grant even if its expiry is still ahead', async () => {
      await grantEntitlement(db, {
        userId,
        productCode: 'pluss',
        expiresAt: new Date('2026-09-15T00:00:00Z'),
        now: NOW,
      });
      await revokeEntitlement(db, { userId, productCode: 'pluss', reason: 'Refundert', now: NOW });
      expect(await expiringEntitlements(db, { now: NOW, withinDays: 60 })).toEqual([]);
    });
  });
});
