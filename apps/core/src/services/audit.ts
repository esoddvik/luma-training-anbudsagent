import { desc, lt, or, and, eq } from 'drizzle-orm';
import { requireAdmin, requireOwnership } from '@luma/auth';
import { adminAuditEvents } from '@luma/db';
import type { JsonValue } from '@luma/domain';
import { decodeCursor, toPage, type Page, type PaginationQuery } from './pagination.js';
import type { Actor, ApiContext } from './context.js';

/**
 * The administrative audit trail (spec §40, §45: "Alt skal logges").
 *
 * Every administrative action writes one row here, including the ones that
 * only read another user's data. The rule the callers follow is that the row
 * is written in the same request as the action, never batched and never
 * best-effort, because an audit trail that can be skipped on the error path is
 * an audit trail with holes exactly where the interesting events are.
 */

export interface AuditInput {
  readonly actor: Actor;
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string;
  readonly before?: JsonValue;
  readonly after?: JsonValue;
  readonly reason?: string;
  readonly ipAddressHash?: string | null;
}

export async function writeAuditEvent(ctx: ApiContext, input: AuditInput): Promise<void> {
  await ctx.db.insert(adminAuditEvents).values({
    adminUserId: input.actor.userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    beforeState: input.before ?? null,
    afterState: input.after ?? null,
    reason: input.reason ?? null,
    ipAddressHash: input.ipAddressHash ?? null,
    occurredAt: ctx.now(),
  });
}

/**
 * `requireOwnership`, plus the audit row its admin escape hatch requires.
 *
 * `requireOwnership` lets an administrator reach a user's data for support, and
 * `packages/auth/src/authorization.ts` states that every such access is written
 * to `admin_audit_events` **by the caller**. That obligation is easy to forget
 * at a call site, so it is discharged here instead: ownership checks on
 * user-scoped resources go through this function, and an override is recorded
 * whether the caller remembered or not.
 *
 * Nothing is written when the caller owns the resource. An audit log that also
 * records ordinary self-service traffic is one nobody reads.
 */
export async function requireOwnershipAudited(
  ctx: ApiContext,
  input: {
    actor: Actor;
    resourceOwnerId: string | undefined;
    action: string;
    entityType: string;
    entityId?: string;
  },
): Promise<void> {
  requireOwnership({
    resourceOwnerId: input.resourceOwnerId,
    actorId: input.actor.userId,
    actorRole: input.actor.role,
  });

  if (input.resourceOwnerId === input.actor.userId) return;

  await writeAuditEvent(ctx, {
    actor: input.actor,
    action: input.action,
    entityType: input.entityType,
    ...(input.entityId ? { entityId: input.entityId } : {}),
    after: { accessedOwnerId: input.resourceOwnerId ?? null },
    reason: 'Administratortilgang til en annen brukers data.',
  });
}

export interface AuditEventView {
  readonly id: string;
  readonly adminUserId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly reason: string | null;
  readonly occurredAt: Date;
}

/** The audit log, newest first (spec §45: admin can "se audit-logg"). */
export async function listAuditEvents(
  ctx: ApiContext,
  actor: Actor,
  query: PaginationQuery & { action?: string },
): Promise<Page<AuditEventView>> {
  requireAdmin(actor.role);

  const cursor = decodeCursor(query.cursor);
  const filters = [
    query.action ? eq(adminAuditEvents.action, query.action) : undefined,
    cursor
      ? or(
          lt(adminAuditEvents.occurredAt, new Date(cursor.key)),
          and(
            eq(adminAuditEvents.occurredAt, new Date(cursor.key)),
            lt(adminAuditEvents.id, cursor.id),
          ),
        )
      : undefined,
  ].filter((clause) => clause !== undefined);

  const rows = await ctx.db
    .select({
      id: adminAuditEvents.id,
      adminUserId: adminAuditEvents.adminUserId,
      action: adminAuditEvents.action,
      entityType: adminAuditEvents.entityType,
      entityId: adminAuditEvents.entityId,
      reason: adminAuditEvents.reason,
      occurredAt: adminAuditEvents.occurredAt,
    })
    .from(adminAuditEvents)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(adminAuditEvents.occurredAt), desc(adminAuditEvents.id))
    .limit(query.limit + 1);

  return toPage(rows, query.limit, (row) => ({
    key: row.occurredAt.toISOString(),
    id: row.id,
  }));
}
