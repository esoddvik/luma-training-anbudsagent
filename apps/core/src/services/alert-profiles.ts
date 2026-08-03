import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import {
  alertProfileBuyers,
  alertProfileCpvCodes,
  alertProfileGeographies,
  alertProfileKeywords,
  alertProfiles,
  industryTemplates,
  type Database,
} from '@luma/db';
import {
  alertProfileInputSchema,
  normalizeSearchText,
  type AlertProfile,
  type AlertProfileInput,
} from '@luma/domain';
import { matchTender, MATCHING_VERSION } from '@luma/matching';
import { notFound, parseOrThrow } from '../routes/errors.js';
import { requireOwnershipAudited } from './audit.js';
import { loadTendersForMatching } from './tender-projection.js';
import { decodeCursor, toPage, type Page, type PaginationQuery } from './pagination.js';
import type { Actor, ApiContext } from './context.js';

/**
 * Alert profiles (spec §11).
 *
 * A profile is stored across five tables: the profile row plus one child table
 * per criterion kind. Writes therefore run in a transaction and replace the
 * children wholesale — a partial update would leave a profile whose CPV codes
 * and keywords came from different versions of the user's intent, and matching
 * would then be explainable but wrong.
 *
 * Every function takes the `Actor` and calls `requireOwnership` before it
 * touches anything (spec §39). No route in this codebase filters by user id on
 * its own; the check is here so that forgetting it is impossible rather than
 * merely unlikely.
 */

/** Cap on how many tenders a preview evaluates. Preview is interactive. */
const PREVIEW_TENDER_LIMIT = 300;
const PREVIEW_RESULT_LIMIT = 25;

export interface AlertProfileView extends AlertProfile {
  readonly industryTemplateSlug?: string;
}

/** Assembles the domain object from a profile row and its child rows. */
function assembleProfile(
  row: typeof alertProfiles.$inferSelect,
  children: {
    cpv: (typeof alertProfileCpvCodes.$inferSelect)[];
    keywords: (typeof alertProfileKeywords.$inferSelect)[];
    geographies: (typeof alertProfileGeographies.$inferSelect)[];
    buyers: (typeof alertProfileBuyers.$inferSelect)[];
  },
): AlertProfile {
  const mine = <T extends { alertProfileId: string }>(list: T[]) =>
    list.filter((entry) => entry.alertProfileId === row.id);

  const profile: AlertProfile = {
    id: row.id,
    userId: row.userId,
    name: row.name,
    active: row.active,
    cpvInclude: mine(children.cpv)
      .filter((entry) => entry.mode === 'include')
      .map((entry) => entry.cpvCode),
    cpvExclude: mine(children.cpv)
      .filter((entry) => entry.mode === 'exclude')
      .map((entry) => entry.cpvCode),
    keywordsInclude: mine(children.keywords)
      .filter((entry) => entry.mode === 'include')
      .map((entry) => entry.keyword),
    keywordsExclude: mine(children.keywords)
      .filter((entry) => entry.mode === 'exclude')
      .map((entry) => entry.keyword),
    regionsInclude: mine(children.geographies)
      .filter((entry) => entry.kind === 'region')
      .map((entry) => entry.code),
    municipalitiesInclude: mine(children.geographies)
      .filter((entry) => entry.kind === 'municipality')
      .map((entry) => entry.code),
    buyerInclude: mine(children.buyers)
      .filter((entry) => entry.mode === 'include')
      .map((entry) => entry.buyerName),
    buyerExclude: mine(children.buyers)
      .filter((entry) => entry.mode === 'exclude')
      .map((entry) => entry.buyerName),
    noticeTypes: row.noticeTypes,
    includePlannedProcurements: row.includePlannedProcurements,
    procedureTypes: row.procedureTypes,
    frequency: row.frequency,
    digestHourLocal: row.digestHourLocal,
    timezone: row.timezone,
    minimumMatchScore: row.minimumMatchScore,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  if (row.description) profile.description = row.description;
  if (row.industryTemplateId) profile.industryTemplateId = row.industryTemplateId;
  if (row.estimatedValueMinNok !== null) profile.estimatedValueMinNok = row.estimatedValueMinNok;
  if (row.estimatedValueMaxNok !== null) profile.estimatedValueMaxNok = row.estimatedValueMaxNok;
  if (row.deadlineMinimumDays !== null) profile.deadlineMinimumDays = row.deadlineMinimumDays;

  return profile;
}

async function loadChildren(db: Database, ids: readonly string[]) {
  if (ids.length === 0) return { cpv: [], keywords: [], geographies: [], buyers: [] };
  const list = [...ids];
  const [cpv, keywords, geographies, buyers] = await Promise.all([
    db
      .select()
      .from(alertProfileCpvCodes)
      .where(inArray(alertProfileCpvCodes.alertProfileId, list)),
    db
      .select()
      .from(alertProfileKeywords)
      .where(inArray(alertProfileKeywords.alertProfileId, list)),
    db
      .select()
      .from(alertProfileGeographies)
      .where(inArray(alertProfileGeographies.alertProfileId, list)),
    db.select().from(alertProfileBuyers).where(inArray(alertProfileBuyers.alertProfileId, list)),
  ]);
  return { cpv, keywords, geographies, buyers };
}

/**
 * Loads a profile and asserts the caller may have it.
 *
 * Ownership is checked *after* the row is read but *before* anything is
 * returned or written, which is the only ordering that can tell "not yours"
 * apart from "does not exist". Both answer 403 to the caller; the distinction
 * exists so an administrator's legitimate access is not reported as a miss.
 */
async function loadOwnedProfile(
  ctx: ApiContext,
  actor: Actor,
  profileId: string,
): Promise<AlertProfile> {
  const rows = await ctx.db
    .select()
    .from(alertProfiles)
    .where(and(eq(alertProfiles.id, profileId), isNull(alertProfiles.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('Varslingsprofilen finnes ikke.');

  await requireOwnershipAudited(ctx, {
    actor,
    resourceOwnerId: row.userId,
    action: 'alert_profile.accessed_as_admin',
    entityType: 'alert_profile',
    entityId: row.id,
  });

  const children = await loadChildren(ctx.db, [row.id]);
  return assembleProfile(row, children);
}

export async function listAlertProfiles(
  ctx: ApiContext,
  actor: Actor,
  query: PaginationQuery,
): Promise<Page<AlertProfile>> {
  const cursor = decodeCursor(query.cursor);
  const rows = await ctx.db
    .select()
    .from(alertProfiles)
    .where(
      and(
        eq(alertProfiles.userId, actor.userId),
        isNull(alertProfiles.deletedAt),
        cursor
          ? or(
              lt(alertProfiles.createdAt, new Date(cursor.key)),
              and(
                eq(alertProfiles.createdAt, new Date(cursor.key)),
                lt(alertProfiles.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(alertProfiles.createdAt), desc(alertProfiles.id))
    .limit(query.limit + 1);

  const children = await loadChildren(
    ctx.db,
    rows.map((row) => row.id),
  );
  const profiles = rows.map((row) => assembleProfile(row, children));

  return toPage(profiles, query.limit, (profile) => ({
    key: profile.createdAt.toISOString(),
    id: profile.id,
  }));
}

export async function getAlertProfile(
  ctx: ApiContext,
  actor: Actor,
  profileId: string,
): Promise<AlertProfile> {
  return loadOwnedProfile(ctx, actor, profileId);
}

/** Writes the four child tables for a profile, replacing whatever was there. */
async function writeCriteria(
  tx: Database,
  profileId: string,
  input: AlertProfileInput,
): Promise<void> {
  await tx.delete(alertProfileCpvCodes).where(eq(alertProfileCpvCodes.alertProfileId, profileId));
  await tx.delete(alertProfileKeywords).where(eq(alertProfileKeywords.alertProfileId, profileId));
  await tx
    .delete(alertProfileGeographies)
    .where(eq(alertProfileGeographies.alertProfileId, profileId));
  await tx.delete(alertProfileBuyers).where(eq(alertProfileBuyers.alertProfileId, profileId));

  const cpvRows = [
    ...[...new Set(input.cpvInclude)].map((cpvCode) => ({
      alertProfileId: profileId,
      mode: 'include' as const,
      cpvCode,
    })),
    ...[...new Set(input.cpvExclude)].map((cpvCode) => ({
      alertProfileId: profileId,
      mode: 'exclude' as const,
      cpvCode,
    })),
  ];
  if (cpvRows.length > 0) await tx.insert(alertProfileCpvCodes).values(cpvRows);

  // The primary key is (profile, mode, normalized keyword), so two spellings
  // that fold to the same normalised form would collide. De-duplicating here
  // keeps a user typing both "Rørlegger" and "rorlegger" from getting a
  // database error instead of a saved profile.
  const keywordRows = (['include', 'exclude'] as const).flatMap((mode) => {
    const source = mode === 'include' ? input.keywordsInclude : input.keywordsExclude;
    const seen = new Set<string>();
    return source.flatMap((keyword) => {
      const normalizedKeyword = normalizeSearchText(keyword);
      if (normalizedKeyword.length === 0 || seen.has(normalizedKeyword)) return [];
      seen.add(normalizedKeyword);
      return [{ alertProfileId: profileId, mode, keyword, normalizedKeyword }];
    });
  });
  if (keywordRows.length > 0) await tx.insert(alertProfileKeywords).values(keywordRows);

  const geographyRows = [
    ...[...new Set(input.regionsInclude)].map((code) => ({
      alertProfileId: profileId,
      kind: 'region' as const,
      code,
    })),
    ...[...new Set(input.municipalitiesInclude)].map((code) => ({
      alertProfileId: profileId,
      kind: 'municipality' as const,
      code,
    })),
  ];
  if (geographyRows.length > 0) await tx.insert(alertProfileGeographies).values(geographyRows);

  const buyerRows = (['include', 'exclude'] as const).flatMap((mode) => {
    const source = mode === 'include' ? input.buyerInclude : input.buyerExclude;
    const seen = new Set<string>();
    return source.flatMap((buyerName) => {
      const normalizedBuyerName = normalizeSearchText(buyerName);
      if (normalizedBuyerName.length === 0 || seen.has(normalizedBuyerName)) return [];
      seen.add(normalizedBuyerName);
      return [{ alertProfileId: profileId, mode, buyerName, normalizedBuyerName }];
    });
  });
  if (buyerRows.length > 0) await tx.insert(alertProfileBuyers).values(buyerRows);
}

/** Rejects an `industryTemplateId` that does not exist, before the FK does. */
async function assertTemplateExists(ctx: ApiContext, templateId: string | undefined) {
  if (!templateId) return;
  const rows = await ctx.db
    .select({ id: industryTemplates.id })
    .from(industryTemplates)
    .where(and(eq(industryTemplates.id, templateId), isNull(industryTemplates.deletedAt)))
    .limit(1);
  if (rows.length === 0) throw notFound('Bransjemalen finnes ikke.');
}

export async function createAlertProfile(
  ctx: ApiContext,
  actor: Actor,
  body: unknown,
): Promise<AlertProfile> {
  const input = parseOrThrow(alertProfileInputSchema, body);
  await assertTemplateExists(ctx, input.industryTemplateId);
  const now = ctx.now();

  const profileId = await ctx.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(alertProfiles)
      .values({
        userId: actor.userId,
        name: input.name,
        description: input.description ?? null,
        active: input.active,
        industryTemplateId: input.industryTemplateId ?? null,
        noticeTypes: input.noticeTypes,
        procedureTypes: input.procedureTypes,
        includePlannedProcurements: input.includePlannedProcurements,
        estimatedValueMinNok: input.estimatedValueMinNok ?? null,
        estimatedValueMaxNok: input.estimatedValueMaxNok ?? null,
        deadlineMinimumDays: input.deadlineMinimumDays ?? null,
        frequency: input.frequency,
        digestHourLocal: input.digestHourLocal,
        timezone: input.timezone,
        minimumMatchScore: input.minimumMatchScore,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: alertProfiles.id });

    const id = inserted[0]?.id;
    if (!id) throw new Error('insert returned no alert profile id');
    await writeCriteria(tx, id, input);
    return id;
  });

  return loadOwnedProfile(ctx, actor, profileId);
}

export async function updateAlertProfile(
  ctx: ApiContext,
  actor: Actor,
  profileId: string,
  body: unknown,
): Promise<AlertProfile> {
  // Ownership first. A caller must not be able to learn that a profile exists
  // by watching validation succeed or fail on someone else's id.
  const existing = await loadOwnedProfile(ctx, actor, profileId);

  // A PATCH is applied over the current state and then validated as a whole,
  // so a partial edit can never produce a profile that would have been
  // rejected on create — a value floor above its ceiling, for instance.
  const merged = { ...toInput(existing), ...(body as Record<string, unknown>) };
  const input = parseOrThrow(alertProfileInputSchema, merged);
  await assertTemplateExists(ctx, input.industryTemplateId);

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(alertProfiles)
      .set({
        name: input.name,
        description: input.description ?? null,
        active: input.active,
        industryTemplateId: input.industryTemplateId ?? null,
        noticeTypes: input.noticeTypes,
        procedureTypes: input.procedureTypes,
        includePlannedProcurements: input.includePlannedProcurements,
        estimatedValueMinNok: input.estimatedValueMinNok ?? null,
        estimatedValueMaxNok: input.estimatedValueMaxNok ?? null,
        deadlineMinimumDays: input.deadlineMinimumDays ?? null,
        frequency: input.frequency,
        digestHourLocal: input.digestHourLocal,
        timezone: input.timezone,
        minimumMatchScore: input.minimumMatchScore,
        updatedAt: ctx.now(),
      })
      .where(eq(alertProfiles.id, profileId));
    await writeCriteria(tx, profileId, input);
  });

  return loadOwnedProfile(ctx, actor, profileId);
}

/** Soft delete (spec §11: profiles can be paused *and* deleted). */
export async function deleteAlertProfile(
  ctx: ApiContext,
  actor: Actor,
  profileId: string,
): Promise<void> {
  await loadOwnedProfile(ctx, actor, profileId);
  const now = ctx.now();
  await ctx.db
    .update(alertProfiles)
    .set({ deletedAt: now, active: false, updatedAt: now })
    .where(eq(alertProfiles.id, profileId));
}

/** The domain object as the input schema wants it, for merging a PATCH. */
function toInput(profile: AlertProfile): AlertProfileInput {
  const { id: _id, userId: _userId, createdAt: _c, updatedAt: _u, ...rest } = profile;
  return rest;
}

export interface PreviewMatch {
  readonly tenderId: string;
  readonly title: string;
  readonly buyerName: string;
  readonly noticeCategory: string;
  readonly publishedAt: Date;
  readonly deadlineAt?: Date;
  readonly score: number;
  readonly confidence: string;
  readonly included: boolean;
  readonly reasons: readonly { type: string; label: string; evidence: readonly string[] }[];
  readonly exclusions: readonly { type: string; label: string; evidence: readonly string[] }[];
}

export interface PreviewResult {
  readonly matchingVersion: string;
  readonly tendersEvaluated: number;
  readonly includedCount: number;
  readonly included: readonly PreviewMatch[];
  /** The near misses, so the user can see *why* something was left out (§11). */
  readonly excluded: readonly PreviewMatch[];
}

/**
 * Previews what a profile would match (spec §11: "Brukeren kan forhåndsvise
 * treff" and see why something was included or excluded).
 *
 * Writes nothing. Preview runs the same pure engine as the scheduled job, but
 * persisting its output would create `tender_matches` rows the digest would
 * then treat as new, and every edit of a profile would email its owner.
 *
 * An optional body previews *unsaved* edits, which is what makes the profile
 * editor usable: the user sees the effect of a change before committing to it.
 */
export async function previewAlertProfile(
  ctx: ApiContext,
  actor: Actor,
  profileId: string,
  body?: unknown,
): Promise<PreviewResult> {
  const stored = await loadOwnedProfile(ctx, actor, profileId);

  const profile: AlertProfile =
    body && typeof body === 'object' && Object.keys(body).length > 0
      ? {
          ...parseOrThrow(alertProfileInputSchema, {
            ...toInput(stored),
            ...(body as Record<string, unknown>),
          }),
          id: stored.id,
          userId: stored.userId,
          createdAt: stored.createdAt,
          updatedAt: stored.updatedAt,
        }
      : stored;

  const now = ctx.now();
  const candidates = await loadTendersForMatching(ctx.db, { limit: PREVIEW_TENDER_LIMIT });

  const evaluated = candidates.map((tender) => {
    const result = matchTender(tender, profile, { now });
    const view: PreviewMatch = {
      tenderId: tender.id,
      title: tender.title,
      buyerName: tender.buyerName,
      noticeCategory: tender.noticeCategory,
      publishedAt: tender.publishedAt,
      ...(tender.deadlineAt ? { deadlineAt: tender.deadlineAt } : {}),
      score: result.score,
      confidence: result.confidence,
      included: result.included,
      reasons: result.reasons.map((reason) => ({
        type: reason.type,
        label: reason.label,
        evidence: reason.evidence,
      })),
      exclusions: result.exclusions.map((exclusion) => ({
        type: exclusion.type,
        label: exclusion.label,
        evidence: exclusion.evidence,
      })),
    };
    return view;
  });

  const included = evaluated
    .filter((entry) => entry.included)
    .sort((a, b) => b.score - a.score)
    .slice(0, PREVIEW_RESULT_LIMIT);
  const excluded = evaluated
    .filter((entry) => !entry.included)
    .sort((a, b) => b.score - a.score)
    .slice(0, PREVIEW_RESULT_LIMIT);

  return {
    matchingVersion: MATCHING_VERSION,
    tendersEvaluated: evaluated.length,
    includedCount: evaluated.filter((entry) => entry.included).length,
    included,
    excluded,
  };
}
