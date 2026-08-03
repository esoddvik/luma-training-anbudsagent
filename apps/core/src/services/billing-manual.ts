import { and, eq } from 'drizzle-orm';
import { orderRequests, type Database } from '@luma/db';
import {
  canTransitionOrder,
  type BillingProvider,
  type CreateOrderInput,
  type OrderRequest,
  type OrderStatus,
} from '@luma/domain';
import { conflict, notFound } from '../routes/errors.js';
import type { OrderStatusWriter } from './context.js';

/**
 * `ManualInvoiceBillingProvider` — the only implementation until phase 7
 * (spec §28.2, ADR-0010).
 *
 * There is no payment engine in the MVP. An order is a structured enquiry;
 * the invoice is raised in Luma's existing finance process, outside this
 * system. The `BillingProvider` seam exists now so that phase 7 adds an
 * implementation rather than rewriting every call site.
 *
 * The state machine is not this class's own invention: `canTransitionOrder`
 * lives in `@luma/domain` and is enforced on every write below, so an order
 * cannot leave a terminal state and cannot reach `activated` without passing
 * through `in_progress` — which is what keeps the audit trail able to name who
 * handled it.
 */

export function toOrderRequest(row: typeof orderRequests.$inferSelect): OrderRequest {
  const order: OrderRequest = {
    id: row.id,
    // `user_id` is nullable because deleting an account severs the reference
    // rather than the order (see `auth.ts` in the schema). An order without a
    // user is history, not a live request.
    userId: row.userId ?? '00000000-0000-0000-0000-000000000000',
    productCode: row.productCode,
    productName: row.productName,
    billingCompanyName: row.billingCompanyName,
    billingAddress: row.billingAddress,
    billingPostalCode: row.billingPostalCode,
    billingCity: row.billingCity,
    billingCountry: row.billingCountry,
    invoiceEmail: row.invoiceEmail,
    contactPerson: row.contactPerson,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.organizationNumber) order.organizationNumber = row.organizationNumber;
  if (row.customerReference) order.customerReference = row.customerReference;
  if (row.purchaseOrderNumber) order.purchaseOrderNumber = row.purchaseOrderNumber;
  if (row.adminNote) order.adminNote = row.adminNote;
  if (row.handledByAdminId) order.handledByAdminId = row.handledByAdminId;
  return order;
}

export class ManualInvoiceBillingProvider implements BillingProvider, OrderStatusWriter {
  readonly #db: Database;
  readonly #now: () => Date;

  constructor(db: Database, now: () => Date) {
    this.#db = db;
    this.#now = now;
  }

  async createOrder(input: CreateOrderInput & { userId: string }): Promise<OrderRequest> {
    const now = this.#now();
    const inserted = await this.#db
      .insert(orderRequests)
      .values({
        userId: input.userId,
        productCode: input.productCode,
        productName: input.productName,
        billingCompanyName: input.billingCompanyName,
        organizationNumber: input.organizationNumber ?? null,
        billingAddress: input.billingAddress,
        billingPostalCode: input.billingPostalCode,
        billingCity: input.billingCity,
        billingCountry: input.billingCountry,
        invoiceEmail: input.invoiceEmail,
        contactPerson: input.contactPerson,
        customerReference: input.customerReference ?? null,
        purchaseOrderNumber: input.purchaseOrderNumber ?? null,
        status: 'received',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const row = inserted[0];
    if (!row) throw new Error('insert returned no order request');
    return toOrderRequest(row);
  }

  async activateOrder(orderId: string, adminId: string): Promise<void> {
    await this.transition(orderId, 'activated', adminId);
  }

  async cancelOrder(orderId: string, adminId: string): Promise<void> {
    await this.transition(orderId, 'cancelled', adminId);
  }

  /**
   * Moves an order, refusing anything the domain calls illegal.
   *
   * The UPDATE carries the status it expects to find, so two administrators
   * pressing the same button race in PostgreSQL rather than in Node: the
   * second one matches no row and gets the conflict, instead of quietly
   * overwriting the first one's decision.
   */
  async transition(
    orderId: string,
    to: OrderStatus,
    adminId: string,
    adminNote?: string,
  ): Promise<OrderRequest> {
    const existing = await this.#db
      .select()
      .from(orderRequests)
      .where(eq(orderRequests.id, orderId))
      .limit(1);
    const row = existing[0];
    if (!row) throw notFound('Bestillingen finnes ikke.');

    if (row.status === to) {
      throw conflict('order_status_unchanged', `Bestillingen har allerede status «${to}».`);
    }
    if (!canTransitionOrder(row.status, to)) {
      throw conflict(
        'order_transition_not_allowed',
        `Bestillingen kan ikke gå fra «${row.status}» til «${to}».`,
      );
    }

    const now = this.#now();
    const updated = await this.#db
      .update(orderRequests)
      .set({
        status: to,
        handledByAdminId: adminId,
        adminNote: adminNote ?? row.adminNote,
        activatedAt: to === 'activated' ? now : row.activatedAt,
        updatedAt: now,
      })
      .where(and(eq(orderRequests.id, orderId), eq(orderRequests.status, row.status)))
      .returning();

    const result = updated[0];
    if (!result) {
      throw conflict(
        'order_status_changed',
        'Bestillingen ble endret av noen andre. Hent den på nytt og prøv igjen.',
      );
    }
    return toOrderRequest(result);
  }
}
