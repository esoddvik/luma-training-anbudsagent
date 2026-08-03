import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { generateToken, hashToken } from '@luma/auth';
import { alertProfiles, tenderMatches, tenderShares, tenders } from '@luma/db';
import {
  evaluateShareAccess,
  sharedTenderViewSchema,
  SHARE_INVITATION_NB,
  SHARE_UNAVAILABLE_NB,
  type SharedTenderView,
  type TenderShare,
} from '@luma/domain';
import { z } from 'zod';
import { gone, notFound, parseOrThrow } from '../routes/errors.js';
import { requireOwnershipAudited } from './audit.js';
import { decodeCursor, toPage, type Page, type PaginationQuery } from './pagination.js';
import { assertTenderAccess, reasonTypesForMatches } from './tenders.js';
import { loadTenderChildren } from './tender-projection.js';
import type { Actor, ApiContext } from './context.js';

/**
 * Sharing a tender (spec §17, §40, ADR-0015).
 *
 * The shared view is public and unauthenticated, which makes this the one file
 * where a mistake is visible to the whole internet. Three rules hold it
 * together:
 *
 * 1. **The stored value is a hash, not the link.** The `token` column holds a
 *    peppered SHA-256 digest; the usable token is returned once, at creation.
 *    A database dump therefore yields no working links, which ADR-0015 asks
 *    for and which the plain-token reading of the column would not give.
 * 2. **Every failure is 410, including "no such token".** A 404 for an unknown
 *    token and a 410 for a revoked one would together form an oracle telling
 *    an enumerator which tokens are real.
 * 3. **The response is built by `sharedTenderViewSchema.parse`**, which strips
 *    anything not declared. Widening the public payload then requires editing
 *    the domain schema, in a diff a reviewer will notice.
 */

/** Where the recipient lands. The web app renders the same data. */
const SHARE_PATH = '/delt';

export const createShareInputSchema = z.object({
  expiresInDays: z.number().int().positive().max(365).optional(),
});

export interface CreatedShare {
  readonly id: string;
  /** Shown exactly once. Never stored, never logged. */
  readonly url: string;
  readonly expiresAt: Date;
}

export async function createShare(
  ctx: ApiContext,
  actor: Actor,
  tenderId: string,
  body: unknown,
): Promise<CreatedShare> {
  const input = parseOrThrow(createShareInputSchema, body ?? {});
  // Only a tender the user can actually see may be shared. Otherwise the
  // share endpoint would be a way to mint public pages for arbitrary ids.
  await assertTenderAccess(ctx, actor, tenderId);

  const now = ctx.now();
  const ttlDays = input.expiresInDays ?? ctx.config.shareDefaultTtlDays;
  const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000);

  const { token, tokenHash } = generateToken(ctx.config.shareTokenSecret);

  const inserted = await ctx.db
    .insert(tenderShares)
    .values({
      tenderId,
      createdByUserId: actor.userId,
      token: tokenHash,
      expiresAt,
      createdAt: now,
    })
    .returning({ id: tenderShares.id });

  const id = inserted[0]?.id;
  if (!id) throw new Error('insert returned no share id');

  ctx.logger.info({ shareId: id, tenderId }, 'delingslenke opprettet');

  return { id, url: `${ctx.config.appUrl.replace(/\/$/, '')}${SHARE_PATH}/${token}`, expiresAt };
}

export interface ShareListItem {
  readonly id: string;
  readonly tenderId: string;
  readonly tenderTitle: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly viewCount: number;
  readonly active: boolean;
}

/** The user's own shares (spec §17: visible at /delinger, revocable). */
export async function listShares(
  ctx: ApiContext,
  actor: Actor,
  query: PaginationQuery,
): Promise<Page<ShareListItem>> {
  const cursor = decodeCursor(query.cursor);
  const now = ctx.now();

  const rows = await ctx.db
    .select({
      id: tenderShares.id,
      tenderId: tenderShares.tenderId,
      tenderTitle: tenders.title,
      createdAt: tenderShares.createdAt,
      expiresAt: tenderShares.expiresAt,
      revokedAt: tenderShares.revokedAt,
      viewCount: tenderShares.viewCount,
    })
    .from(tenderShares)
    .innerJoin(tenders, eq(tenders.id, tenderShares.tenderId))
    .where(
      and(
        eq(tenderShares.createdByUserId, actor.userId),
        cursor
          ? or(
              lt(tenderShares.createdAt, new Date(cursor.key)),
              and(eq(tenderShares.createdAt, new Date(cursor.key)), lt(tenderShares.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(tenderShares.createdAt), desc(tenderShares.id))
    .limit(query.limit + 1);

  // The token is deliberately absent from this projection. A user who has lost
  // the link creates a new share; the old one is not recoverable, because the
  // server does not hold it either.
  const items = rows.map((row) => ({
    ...row,
    active: row.revokedAt === null && row.expiresAt > now,
  }));

  return toPage(items, query.limit, (row) => ({
    key: row.createdAt.toISOString(),
    id: row.id,
  }));
}

export async function revokeShare(
  ctx: ApiContext,
  actor: Actor,
  shareId: string,
): Promise<{ id: string; revokedAt: Date }> {
  const rows = await ctx.db
    .select()
    .from(tenderShares)
    .where(eq(tenderShares.id, shareId))
    .limit(1);
  const share = rows[0];
  if (!share) throw notFound('Delingslenken finnes ikke.');

  await requireOwnershipAudited(ctx, {
    actor,
    resourceOwnerId: share.createdByUserId,
    action: 'tender_share.revoked_as_admin',
    entityType: 'tender_share',
    entityId: shareId,
  });

  // Revoking twice is not an error. The user pressed the button again because
  // the first press was not obviously acknowledged, and failing here would be
  // a worse answer than the idempotent one.
  const revokedAt = share.revokedAt ?? ctx.now();
  if (!share.revokedAt) {
    await ctx.db.update(tenderShares).set({ revokedAt }).where(eq(tenderShares.id, shareId));
  }

  return { id: shareId, revokedAt };
}

export interface SharedViewResponse {
  readonly tender: SharedTenderView;
  readonly invitation: typeof SHARE_INVITATION_NB;
}

/**
 * The public shared view.
 *
 * Takes no actor, on purpose: there is nobody to authorise. What protects the
 * data is that the projection contains nothing worth protecting, not that the
 * caller was checked.
 */
export async function viewSharedTender(
  ctx: ApiContext,
  token: string,
): Promise<SharedViewResponse> {
  const unavailable = () => gone('share_unavailable', SHARE_UNAVAILABLE_NB.body);

  // A token that is not even the right shape never reaches the database.
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw unavailable();

  const tokenHash = hashToken(token, ctx.config.shareTokenSecret);
  const shareRows = await ctx.db
    .select()
    .from(tenderShares)
    .where(eq(tenderShares.token, tokenHash))
    .limit(1);
  const shareRow = shareRows[0];

  const share: TenderShare | undefined = shareRow
    ? {
        id: shareRow.id,
        tenderId: shareRow.tenderId,
        createdByUserId: shareRow.createdByUserId,
        token: shareRow.token,
        expiresAt: shareRow.expiresAt,
        ...(shareRow.revokedAt ? { revokedAt: shareRow.revokedAt } : {}),
        viewCount: shareRow.viewCount,
        createdAt: shareRow.createdAt,
      }
    : undefined;

  const access = evaluateShareAccess(share, ctx.now());
  // `not_found`, `revoked` and `expired` all end here, with the same status and
  // the same body. That is the enumeration defence (§40).
  if (access.kind !== 'ok' || !shareRow) throw unavailable();

  const tenderRows = await ctx.db
    .select()
    .from(tenders)
    .where(and(eq(tenders.id, shareRow.tenderId), isNull(tenders.suppressedAt)))
    .limit(1);
  const tender = tenderRows[0];
  // A tender an administrator has suppressed as invalid (§45) stops being
  // visible through old share links too.
  if (!tender) throw unavailable();

  const children = await loadTenderChildren(ctx.db, [tender.id]);

  // Reason *types* only, and taken from the sharer's own matches. The values
  // behind them — keywords, regions, buyer names — are the sharer's
  // competitively sensitive profile and never leave the account (§17).
  const matchIds = await ctx.db
    .select({ id: tenderMatches.id })
    .from(tenderMatches)
    .innerJoin(alertProfiles, eq(alertProfiles.id, tenderMatches.alertProfileId))
    .where(
      and(
        eq(tenderMatches.tenderId, tender.id),
        eq(alertProfiles.userId, shareRow.createdByUserId),
        eq(tenderMatches.included, true),
      ),
    );
  const matchReasonTypes = await reasonTypesForMatches(
    ctx,
    matchIds.map((row) => row.id),
  );

  await ctx.db
    .update(tenderShares)
    .set({ viewCount: sql`${tenderShares.viewCount} + 1` })
    .where(eq(tenderShares.id, shareRow.id));

  // Built by parsing, not by spreading. Anything not named in
  // `sharedTenderViewSchema` is dropped here rather than shipped.
  const view = sharedTenderViewSchema.parse({
    title: tender.title,
    buyerName: tender.buyerName,
    description: tender.description ?? undefined,
    noticeCategory: tender.noticeCategory,
    status: tender.status,
    cpvCodes: children.cpv.get(tender.id) ?? [],
    regions: children.regions.get(tender.id) ?? [],
    deadlineAt: tender.deadlineAt ?? undefined,
    publishedAt: tender.publishedAt,
    sourceUrl: tender.sourceUrl,
    lastSyncedAt: tender.lastSyncedAt,
    matchReasonTypes,
  });

  return { tender: view, invitation: SHARE_INVITATION_NB };
}
