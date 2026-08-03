import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import type { Database } from './db';
import {
  evaluateShareAccess,
  sharedTenderViewSchema,
  type MatchReasonType,
  type ShareAccessResult,
  type SharedTenderView,
} from '@luma/domain';

/**
 * The shared view (spec section 17, ADR-15).
 *
 * This is the only page in the service that is public, unauthenticated and
 * built from another person's data, which makes it the place where a privacy
 * mistake would be most expensive. Three things keep it safe, and all three are
 * mechanical rather than a matter of remembering:
 *
 * 1. The payload is **constructed field by field and then parsed through
 *    `sharedTenderViewSchema`**. Zod object schemas strip undeclared keys, so a
 *    field added to `tenders` or to this file's query cannot reach the page
 *    without someone also adding it to the schema in `@luma/domain`.
 * 2. The query **never selects** `created_by_user_id`, and never joins `users`
 *    or `alert_profiles`. There is no sharer identity in scope to leak.
 * 3. The match explanation is reduced to reason **types** before it leaves this
 *    module. Profile keywords, CPV codes the profile asked for, buyer names and
 *    the score are not read at all.
 *
 * Spec section 51 point 11 makes "the shared view leaks no personal data" a
 * launch blocker, and `shares.integration.test.ts` is the check.
 */

export type SharedViewResult =
  | { readonly kind: 'ok'; readonly view: SharedTenderView }
  | { readonly kind: 'unavailable'; readonly reason: ShareAccessResult['kind'] };

/**
 * Resolves a share token to the public projection of the tender.
 *
 * Expired, revoked and unknown tokens all produce `unavailable`. The reason is
 * returned for logging, not for display: telling a visitor "revoked" rather
 * than "never existed" would confirm that a guessed token was once real.
 */
export async function getSharedTenderView(
  db: Database,
  input: { token: string; now: Date },
): Promise<SharedViewResult> {
  const { token, now } = input;

  // A token shorter than the database's own floor cannot be a real one, so it
  // is rejected before it reaches the index.
  if (token.length < 32) return { kind: 'unavailable', reason: 'not_found' };

  const [share] = await db
    .select({
      id: schema.tenderShares.id,
      tenderId: schema.tenderShares.tenderId,
      expiresAt: schema.tenderShares.expiresAt,
      revokedAt: schema.tenderShares.revokedAt,
      viewCount: schema.tenderShares.viewCount,
      createdAt: schema.tenderShares.createdAt,
    })
    .from(schema.tenderShares)
    .where(eq(schema.tenderShares.token, token))
    .limit(1);

  // `evaluateShareAccess` wants the domain shape. The two fields it does not
  // read — `createdByUserId` and `token` — are supplied as constants rather
  // than fetched, so this file never holds the sharer's id in a variable.
  const access = evaluateShareAccess(
    share === undefined
      ? undefined
      : {
          id: share.id,
          tenderId: share.tenderId,
          createdByUserId: PLACEHOLDER_UUID,
          token: PLACEHOLDER_TOKEN,
          expiresAt: share.expiresAt,
          ...(share.revokedAt ? { revokedAt: share.revokedAt } : {}),
          viewCount: share.viewCount,
          createdAt: share.createdAt,
        },
    now,
  );

  if (access.kind !== 'ok' || share === undefined) {
    return { kind: 'unavailable', reason: access.kind };
  }

  const [tender] = await db
    .select({
      title: schema.tenders.title,
      buyerName: schema.tenders.buyerName,
      description: schema.tenders.description,
      noticeCategory: schema.tenders.noticeCategory,
      status: schema.tenders.status,
      deadlineAt: schema.tenders.deadlineAt,
      publishedAt: schema.tenders.publishedAt,
      sourceUrl: schema.tenders.sourceUrl,
      lastSyncedAt: schema.tenders.lastSyncedAt,
    })
    .from(schema.tenders)
    .where(and(eq(schema.tenders.id, share.tenderId), isNull(schema.tenders.suppressedAt)))
    .limit(1);

  // A suppressed or deleted tender behaves exactly like an expired link.
  if (!tender) return { kind: 'unavailable', reason: 'not_found' };

  const [cpvCodes, regions, matchReasonTypes] = await Promise.all([
    db
      .select({ cpvCode: schema.tenderCpvCodes.cpvCode })
      .from(schema.tenderCpvCodes)
      .where(eq(schema.tenderCpvCodes.tenderId, share.tenderId))
      .then((rows) => rows.map((row) => row.cpvCode)),
    db
      .select({ regionCode: schema.tenderRegions.regionCode })
      .from(schema.tenderRegions)
      .where(eq(schema.tenderRegions.tenderId, share.tenderId))
      .then((rows) => rows.map((row) => row.regionCode)),
    sharedReasonTypes(db, share.tenderId),
  ]);

  /**
   * Parsed rather than cast. `sharedTenderViewSchema` is a Zod object, so it
   * strips anything not declared on it — this is the mechanical guarantee that
   * the page cannot render a field nobody reviewed.
   */
  const view = sharedTenderViewSchema.parse({
    title: tender.title,
    buyerName: tender.buyerName,
    ...(tender.description ? { description: tender.description } : {}),
    noticeCategory: tender.noticeCategory,
    status: tender.status,
    cpvCodes,
    regions,
    ...(tender.deadlineAt ? { deadlineAt: tender.deadlineAt } : {}),
    publishedAt: tender.publishedAt,
    sourceUrl: tender.sourceUrl,
    lastSyncedAt: tender.lastSyncedAt,
    matchReasonTypes,
  });

  return { kind: 'ok', view };
}

/**
 * The distinct reason *types* behind every match on this tender.
 *
 * Deliberately not scoped to the sharer's profile. Scoping it would make the
 * result a statement about one person's criteria; taking the distinct set
 * across all matches makes it a statement about the notice. Neither the label,
 * the evidence, the score nor the profile id is selected.
 */
async function sharedReasonTypes(db: Database, tenderId: string): Promise<MatchReasonType[]> {
  const rows = await db
    .selectDistinct({ reasonType: schema.tenderMatchReasons.reasonType })
    .from(schema.tenderMatchReasons)
    .innerJoin(schema.tenderMatches, eq(schema.tenderMatches.id, schema.tenderMatchReasons.matchId))
    .where(
      and(
        eq(schema.tenderMatches.tenderId, tenderId),
        eq(schema.tenderMatches.included, true),
        eq(schema.tenderMatchReasons.entryType, 'reason'),
      ),
    );

  return rows.map((row) => row.reasonType).filter((type): type is MatchReasonType => type !== null);
}

/** Never read from the database; only present because the domain type needs a value. */
const PLACEHOLDER_UUID = '00000000-0000-0000-0000-000000000000';
const PLACEHOLDER_TOKEN = 'x'.repeat(32);

/** Records a view. Approximate by design (ADR-15): bots inflate it. */
export async function recordShareView(db: Database, token: string): Promise<void> {
  await db
    .update(schema.tenderShares)
    .set({ viewCount: sql`${schema.tenderShares.viewCount} + 1` })
    .where(eq(schema.tenderShares.token, token));
}

export interface OwnShare {
  readonly id: string;
  readonly tenderId: string;
  readonly tenderTitle: string;
  readonly buyerName: string;
  readonly token: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly viewCount: number;
  readonly createdAt: Date;
}

/** The user's own share links, for /delinger (spec sections 4.4 and 17). */
export async function listOwnShares(db: Database, userId: string): Promise<OwnShare[]> {
  return db
    .select({
      id: schema.tenderShares.id,
      tenderId: schema.tenderShares.tenderId,
      tenderTitle: schema.tenders.title,
      buyerName: schema.tenders.buyerName,
      token: schema.tenderShares.token,
      expiresAt: schema.tenderShares.expiresAt,
      revokedAt: schema.tenderShares.revokedAt,
      viewCount: schema.tenderShares.viewCount,
      createdAt: schema.tenderShares.createdAt,
    })
    .from(schema.tenderShares)
    .innerJoin(schema.tenders, eq(schema.tenders.id, schema.tenderShares.tenderId))
    .where(eq(schema.tenderShares.createdByUserId, userId))
    .orderBy(desc(schema.tenderShares.createdAt))
    .limit(200);
}

/** An existing, still-valid link for this tender, so a second click reuses it. */
export async function findActiveShare(
  db: Database,
  input: { tenderId: string; userId: string; now: Date },
): Promise<{ token: string; expiresAt: Date } | null> {
  const [row] = await db
    .select({ token: schema.tenderShares.token, expiresAt: schema.tenderShares.expiresAt })
    .from(schema.tenderShares)
    .where(
      and(
        eq(schema.tenderShares.tenderId, input.tenderId),
        eq(schema.tenderShares.createdByUserId, input.userId),
        isNull(schema.tenderShares.revokedAt),
        gte(schema.tenderShares.expiresAt, input.now),
      ),
    )
    .orderBy(desc(schema.tenderShares.createdAt))
    .limit(1);
  return row ?? null;
}
