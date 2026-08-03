import { and, desc, eq, lt, or } from 'drizzle-orm';
import { requireAdmin } from '@luma/auth';
import { orderRequests, users } from '@luma/db';
import {
  createOrderInputSchema,
  orderStatusSchema,
  type OrderRequest,
  type OrderStatus,
} from '@luma/domain';
import {
  renderOrderAdminNotification,
  renderOrderReceived,
  renderPaidAccessActivated,
} from '@luma/email';
import { z } from 'zod';
import { notFound, parseOrThrow } from '../routes/errors.js';
import { requireOwnershipAudited, writeAuditEvent } from './audit.js';
import { toOrderRequest } from './billing-manual.js';
import { baseEmailContext } from './email-context.js';
import { decodeCursor, toPage, type Page, type PaginationQuery } from './pagination.js';
import type { Actor, ApiContext } from './context.js';

/**
 * Order requests for paid Luma products (spec §28.2).
 *
 * The flow is five steps and all five are here: the customer submits, a
 * confirmation goes out, `BILLING_ADMIN_EMAIL` is notified, an administrator
 * moves the status, and an activation email follows. Step six — "alle
 * statusendringer logges i admin_audit_events" — is why every transition below
 * writes an audit row before it returns.
 *
 * Invoice language only. Spec §28.2 forbids card payment, Stripe and "Betal
 * nå" anywhere near this surface; the copy lives in `INVOICE_COPY_NB` in the
 * domain and the email package asserts against `FORBIDDEN_PAYMENT_TERMS`.
 */

/**
 * Where the billing administrator lands from the notification email.
 *
 * `/admin/bestillinger`, taken from what `apps/web` actually mounts rather than
 * from spec §16's route list: the web app drops the `/anbudsvarsling` prefix
 * because it deploys to its own subdomain, so the path in §16 — and in the
 * doc comment on `OrderAdminNotificationContext` — would 404.
 *
 * There is no per-order page to deep-link to; the queue is one screen.
 */
function adminOrderUrl(ctx: ApiContext): string {
  return `${ctx.config.appUrl.replace(/\/$/, '')}/admin/bestillinger`;
}

export const adminOrderUpdateSchema = z.object({
  status: orderStatusSchema,
  adminNote: z.string().trim().max(4000).optional(),
  /** Only used for `activated`, where the customer is told where to go. */
  accessUrl: z.url().optional(),
});

export async function createOrderRequest(
  ctx: ApiContext,
  actor: Actor,
  body: unknown,
): Promise<OrderRequest> {
  const input = parseOrThrow(createOrderInputSchema, body);

  const order = await ctx.billing.createOrder({ ...input, userId: actor.userId });

  const rendered = renderOrderReceived({
    ...baseEmailContext(ctx, actor.email),
    order: input,
    status: order.status,
  });

  // The customer's confirmation (step 1).
  await ctx.email.sendTransactional(rendered, {
    to: actor.email,
    metadata: { orderRequestId: order.id, productCode: order.productCode },
  });

  // Step 2: the billing administrator is notified, with their own template.
  //
  // It used to be a second copy of the customer's confirmation, addressed to
  // the customer and sent to the billing mailbox. That carried the invoicing
  // fields but read as a receipt, and it silently dropped every optional field
  // the customer had left blank — which an administrator cannot tell from a
  // field the template forgot.
  await ctx.email.sendTransactional(
    renderOrderAdminNotification({
      ...baseEmailContext(ctx, ctx.config.billingAdminEmail),
      order: input,
      orderId: order.id,
      status: order.status,
      adminOrderUrl: adminOrderUrl(ctx),
    }),
    {
      to: ctx.config.billingAdminEmail,
      metadata: { orderRequestId: order.id, productCode: order.productCode, copy: 'billing-admin' },
    },
  );

  ctx.logger.info(
    { orderRequestId: order.id, productCode: order.productCode },
    'bestilling mottatt',
  );

  return order;
}

export async function listOwnOrderRequests(
  ctx: ApiContext,
  actor: Actor,
  query: PaginationQuery,
): Promise<Page<OrderRequest>> {
  const cursor = decodeCursor(query.cursor);
  const rows = await ctx.db
    .select()
    .from(orderRequests)
    .where(
      and(
        eq(orderRequests.userId, actor.userId),
        cursor
          ? or(
              lt(orderRequests.createdAt, new Date(cursor.key)),
              and(
                eq(orderRequests.createdAt, new Date(cursor.key)),
                lt(orderRequests.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(orderRequests.createdAt), desc(orderRequests.id))
    .limit(query.limit + 1);

  return toPage(rows.map(toOrderRequest), query.limit, (order) => ({
    key: order.createdAt.toISOString(),
    id: order.id,
  }));
}

export async function getOrderRequest(
  ctx: ApiContext,
  actor: Actor,
  orderId: string,
): Promise<OrderRequest> {
  const rows = await ctx.db
    .select()
    .from(orderRequests)
    .where(eq(orderRequests.id, orderId))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('Bestillingen finnes ikke.');

  await requireOwnershipAudited(ctx, {
    actor,
    resourceOwnerId: row.userId ?? undefined,
    action: 'order_request.accessed_as_admin',
    entityType: 'order_request',
    entityId: orderId,
  });

  return toOrderRequest(row);
}

/** Every order, for the admin queue (spec §45). */
export async function listAllOrderRequests(
  ctx: ApiContext,
  actor: Actor,
  query: PaginationQuery & { status?: OrderStatus },
): Promise<Page<OrderRequest>> {
  requireAdmin(actor.role);
  const cursor = decodeCursor(query.cursor);

  const rows = await ctx.db
    .select()
    .from(orderRequests)
    .where(
      and(
        query.status ? eq(orderRequests.status, query.status) : undefined,
        cursor
          ? or(
              lt(orderRequests.createdAt, new Date(cursor.key)),
              and(
                eq(orderRequests.createdAt, new Date(cursor.key)),
                lt(orderRequests.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(orderRequests.createdAt), desc(orderRequests.id))
    .limit(query.limit + 1);

  return toPage(rows.map(toOrderRequest), query.limit, (order) => ({
    key: order.createdAt.toISOString(),
    id: order.id,
  }));
}

/**
 * An administrator moves an order (spec §28.2 steps 4 to 6).
 *
 * The transition is validated by `canTransitionOrder` inside the provider, the
 * change is audited here, and the activation email goes out only after both
 * have succeeded — so a customer is never told their access is live by an
 * operation that then failed to record itself.
 */
export async function handleOrderRequest(
  ctx: ApiContext,
  actor: Actor,
  orderId: string,
  body: unknown,
): Promise<OrderRequest> {
  requireAdmin(actor.role);
  const input = parseOrThrow(adminOrderUpdateSchema, body);

  const beforeRows = await ctx.db
    .select()
    .from(orderRequests)
    .where(eq(orderRequests.id, orderId))
    .limit(1);
  const before = beforeRows[0];
  if (!before) throw notFound('Bestillingen finnes ikke.');

  // Routed through the two interface methods where they apply, so the seam
  // spec §28.3 asks for is exercised rather than merely declared.
  const updated =
    input.status === 'activated'
      ? await activateThrough(ctx, orderId, actor.userId, input.adminNote)
      : input.status === 'cancelled'
        ? await cancelThrough(ctx, orderId, actor.userId, input.adminNote)
        : await ctx.billing.transition(orderId, input.status, actor.userId, input.adminNote);

  await writeAuditEvent(ctx, {
    actor,
    action: 'order_request.status_changed',
    entityType: 'order_request',
    entityId: orderId,
    before: { status: before.status },
    after: { status: updated.status },
    ...(input.adminNote ? { reason: input.adminNote } : {}),
  });

  if (updated.status === 'activated') {
    const customer = before.userId
      ? (
          await ctx.db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, before.userId))
            .limit(1)
        )[0]
      : undefined;

    if (customer) {
      const rendered = renderPaidAccessActivated({
        ...baseEmailContext(ctx, customer.email),
        productName: updated.productName,
        accessUrl: input.accessUrl ?? ctx.config.appUrl,
      });
      await ctx.email.sendTransactional(rendered, {
        to: customer.email,
        metadata: { orderRequestId: orderId },
      });
    }
  }

  return updated;
}

async function activateThrough(
  ctx: ApiContext,
  orderId: string,
  adminId: string,
  adminNote?: string,
): Promise<OrderRequest> {
  if (adminNote !== undefined) {
    await ctx.db.update(orderRequests).set({ adminNote }).where(eq(orderRequests.id, orderId));
  }
  await ctx.billing.activateOrder(orderId, adminId);
  return reload(ctx, orderId);
}

async function cancelThrough(
  ctx: ApiContext,
  orderId: string,
  adminId: string,
  adminNote?: string,
): Promise<OrderRequest> {
  if (adminNote !== undefined) {
    await ctx.db.update(orderRequests).set({ adminNote }).where(eq(orderRequests.id, orderId));
  }
  await ctx.billing.cancelOrder(orderId, adminId);
  return reload(ctx, orderId);
}

async function reload(ctx: ApiContext, orderId: string): Promise<OrderRequest> {
  const rows = await ctx.db
    .select()
    .from(orderRequests)
    .where(eq(orderRequests.id, orderId))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('Bestillingen finnes ikke.');
  return toOrderRequest(row);
}
