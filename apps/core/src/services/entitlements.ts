import { and, eq } from 'drizzle-orm';
import type { Database } from '@luma/db';
import { userEntitlements } from '@luma/db';
import { hasProduct, isEntitlementActive, type Entitlement, type ProductCode } from '@luma/domain';

/**
 * Reading and granting paid access (IDE Agent Spec v3, section 4.2).
 *
 * The decision itself lives in `@luma/domain`'s `isEntitlementActive`, pure and
 * clock-injected. This module only fetches rows and hands them over, which is
 * what lets the web app, the API and the MCP server reach the same verdict
 * without three copies of the rule.
 *
 * **No price and no payment.** Access is granted by an administrator after a
 * manual invoice is paid (ADR-0010). There is no charge call to make here and
 * no amount to store — the invoice is the only record that can be right about
 * the figure, the VAT and the year it was agreed.
 */

export async function listEntitlements(db: Database, userId: string): Promise<Entitlement[]> {
  const rows = await db
    .select({
      productCode: userEntitlements.productCode,
      grantedAt: userEntitlements.grantedAt,
      expiresAt: userEntitlements.expiresAt,
      revokedAt: userEntitlements.revokedAt,
    })
    .from(userEntitlements)
    .where(eq(userEntitlements.userId, userId));
  return rows;
}

/** Whether the user may use a paid product right now. */
export async function hasEntitlement(
  db: Database,
  input: { userId: string; productCode: ProductCode; now: Date },
): Promise<boolean> {
  const rows = await db
    .select({
      productCode: userEntitlements.productCode,
      grantedAt: userEntitlements.grantedAt,
      expiresAt: userEntitlements.expiresAt,
      revokedAt: userEntitlements.revokedAt,
    })
    .from(userEntitlements)
    .where(
      and(
        eq(userEntitlements.userId, input.userId),
        eq(userEntitlements.productCode, input.productCode),
      ),
    );

  return hasProduct(rows, input.productCode, input.now);
}

export interface GrantInput {
  readonly userId: string;
  readonly productCode: ProductCode;
  readonly expiresAt: Date | null;
  readonly grantedByAdminId?: string | undefined;
  readonly orderRequestId?: string | undefined;
  readonly now: Date;
}

/**
 * Grants or renews access.
 *
 * A renewal **extends the existing row** rather than inserting a second one.
 * The unique index makes that structural, and the reason is that two
 * overlapping grants for one product make "when does this lapse" unanswerable
 * — which is precisely the question the renewal report exists to ask.
 *
 * Renewing also clears `revoked_at`. An administrator granting access to
 * someone previously revoked has decided the revocation is over, and leaving
 * the timestamp would produce a row that reads as live and behaves as dead.
 */
export async function grantEntitlement(db: Database, input: GrantInput): Promise<void> {
  await db
    .insert(userEntitlements)
    .values({
      userId: input.userId,
      productCode: input.productCode,
      grantedAt: input.now,
      expiresAt: input.expiresAt,
      grantedByAdminId: input.grantedByAdminId ?? null,
      orderRequestId: input.orderRequestId ?? null,
    })
    .onConflictDoUpdate({
      target: [userEntitlements.userId, userEntitlements.productCode],
      set: {
        expiresAt: input.expiresAt,
        grantedByAdminId: input.grantedByAdminId ?? null,
        orderRequestId: input.orderRequestId ?? null,
        revokedAt: null,
        revokedReason: null,
      },
    });
}

/**
 * Withdraws access now, without deleting the record that it was granted.
 *
 * A refund, a chargeback, or a grant made in error. The row stays because it
 * is the audit trail for a manual billing flow — deleting it would leave an
 * invoice with nothing on this side to explain it.
 */
export async function revokeEntitlement(
  db: Database,
  input: { userId: string; productCode: ProductCode; reason: string; now: Date },
): Promise<void> {
  await db
    .update(userEntitlements)
    .set({ revokedAt: input.now, revokedReason: input.reason })
    .where(
      and(
        eq(userEntitlements.userId, input.userId),
        eq(userEntitlements.productCode, input.productCode),
      ),
    );
}

/**
 * Entitlements lapsing inside a window, for the admin renewal reminder
 * (IDE Agent Spec v3, section 4.2).
 *
 * There is no renewal engine and no automatic charge; this is a list a person
 * reads and acts on. Rows with no expiry never appear, which is correct — they
 * do not lapse.
 */
export async function expiringEntitlements(
  db: Database,
  input: { now: Date; withinDays?: number },
): Promise<{ userId: string; productCode: string; expiresAt: Date }[]> {
  const horizon = new Date(input.now.getTime() + (input.withinDays ?? 60) * 86_400_000);
  const rows = await db
    .select({
      userId: userEntitlements.userId,
      productCode: userEntitlements.productCode,
      expiresAt: userEntitlements.expiresAt,
      grantedAt: userEntitlements.grantedAt,
      revokedAt: userEntitlements.revokedAt,
    })
    .from(userEntitlements);

  return rows
    .filter(
      (row): row is typeof row & { expiresAt: Date } =>
        row.expiresAt !== null &&
        row.expiresAt <= horizon &&
        // Still live today: something already lapsed is not a renewal
        // reminder, it is history, and mixing the two makes the list useless.
        isEntitlementActive(row, input.now),
    )
    .map((row) => ({
      userId: row.userId,
      productCode: row.productCode,
      expiresAt: row.expiresAt,
    }));
}
