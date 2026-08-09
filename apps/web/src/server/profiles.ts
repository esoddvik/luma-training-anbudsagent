import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { SERVICE_TEMPLATE_SEEDS } from '@luma/content';
import { getWebDb, type Database } from './db';
import type {
  AlertFrequency,
  AlertProfile,
  MatchResult,
  NoticeCategory,
  Tender,
} from '@luma/domain';
import { matchTender } from '@luma/matching';

/**
 * Alert profiles (spec section 11) and the match preview (spec section 9.1
 * step 11).
 *
 * The profile is stored across a parent row and four criterion tables, so
 * `loadProfile` reassembles the domain shape rather than letting every caller
 * remember which table holds keywords. That reassembled `AlertProfile` is
 * exactly what the matching engine takes, which is what makes a *real* preview
 * possible: the preview runs the same pure function the nightly job runs, so
 * what the user sees while editing is what they will be sent.
 */

export interface ProfileSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly frequency: AlertFrequency;
  readonly includePlannedProcurements: boolean;
  readonly createdAt: Date;
  readonly matchCount: number;
}

export async function listProfiles(db: Database, userId: string): Promise<ProfileSummary[]> {
  const rows = await db
    .select({
      id: schema.alertProfiles.id,
      name: schema.alertProfiles.name,
      description: schema.alertProfiles.description,
      active: schema.alertProfiles.active,
      frequency: schema.alertProfiles.frequency,
      includePlannedProcurements: schema.alertProfiles.includePlannedProcurements,
      createdAt: schema.alertProfiles.createdAt,
    })
    .from(schema.alertProfiles)
    .where(and(eq(schema.alertProfiles.userId, userId), isNull(schema.alertProfiles.deletedAt)))
    .orderBy(desc(schema.alertProfiles.createdAt));

  if (rows.length === 0) return [];

  const counts = await db
    .select({
      profileId: schema.tenderMatches.alertProfileId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.tenderMatches)
    .innerJoin(
      schema.alertProfiles,
      eq(schema.alertProfiles.id, schema.tenderMatches.alertProfileId),
    )
    .where(
      and(
        eq(schema.alertProfiles.userId, userId),
        isNull(schema.alertProfiles.deletedAt),
        eq(schema.tenderMatches.included, true),
      ),
    )
    .groupBy(schema.tenderMatches.alertProfileId);

  const byProfile = new Map(counts.map((row) => [row.profileId, row.count]));
  return rows.map((row) => ({ ...row, matchCount: byProfile.get(row.id) ?? 0 }));
}

/**
 * One profile in the domain shape, or `null`.
 *
 * Scoped by `userId`, so a profile id typed into the URL bar cannot read
 * someone else's criteria.
 */
export async function loadProfile(
  db: Database,
  input: { profileId: string; userId: string },
): Promise<AlertProfile | null> {
  const [row] = await db
    .select()
    .from(schema.alertProfiles)
    .where(
      and(
        eq(schema.alertProfiles.id, input.profileId),
        eq(schema.alertProfiles.userId, input.userId),
        isNull(schema.alertProfiles.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  const [cpv, keywords, geographies, buyers] = await Promise.all([
    db
      .select({
        mode: schema.alertProfileCpvCodes.mode,
        value: schema.alertProfileCpvCodes.cpvCode,
      })
      .from(schema.alertProfileCpvCodes)
      .where(eq(schema.alertProfileCpvCodes.alertProfileId, row.id)),
    db
      .select({
        mode: schema.alertProfileKeywords.mode,
        value: schema.alertProfileKeywords.keyword,
      })
      .from(schema.alertProfileKeywords)
      .where(eq(schema.alertProfileKeywords.alertProfileId, row.id)),
    db
      .select({
        kind: schema.alertProfileGeographies.kind,
        value: schema.alertProfileGeographies.code,
      })
      .from(schema.alertProfileGeographies)
      .where(eq(schema.alertProfileGeographies.alertProfileId, row.id)),
    db
      .select({ mode: schema.alertProfileBuyers.mode, value: schema.alertProfileBuyers.buyerName })
      .from(schema.alertProfileBuyers)
      .where(eq(schema.alertProfileBuyers.alertProfileId, row.id)),
  ]);

  const pick = <T extends { mode: 'include' | 'exclude'; value: string }>(
    rows: readonly T[],
    mode: 'include' | 'exclude',
  ) => rows.filter((entry) => entry.mode === mode).map((entry) => entry.value);

  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    active: row.active,
    ...(row.serviceTemplateId ? { serviceTemplateId: row.serviceTemplateId } : {}),
    cpvInclude: pick(cpv, 'include'),
    cpvExclude: pick(cpv, 'exclude'),
    keywordsInclude: pick(keywords, 'include'),
    keywordsExclude: pick(keywords, 'exclude'),
    regionsInclude: geographies.filter((g) => g.kind === 'region').map((g) => g.value),
    // Always empty in practice: the source exposes no municipality field. See
    // docs/spec-deviations.md — this is not a missing ingest step.
    municipalitiesInclude: geographies.filter((g) => g.kind === 'municipality').map((g) => g.value),
    buyerInclude: pick(buyers, 'include'),
    buyerExclude: pick(buyers, 'exclude'),
    noticeTypes: row.noticeTypes,
    includePlannedProcurements: row.includePlannedProcurements,
    procedureTypes: row.procedureTypes,
    ...(row.estimatedValueMinNok !== null
      ? { estimatedValueMinNok: row.estimatedValueMinNok }
      : {}),
    ...(row.estimatedValueMaxNok !== null
      ? { estimatedValueMaxNok: row.estimatedValueMaxNok }
      : {}),
    ...(row.deadlineMinimumDays !== null ? { deadlineMinimumDays: row.deadlineMinimumDays } : {}),
    frequency: row.frequency,
    digestHourLocal: row.digestHourLocal,
    timezone: row.timezone,
    minimumMatchScore: row.minimumMatchScore,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface PreviewItem {
  readonly tenderId: string;
  readonly title: string;
  readonly buyerName: string;
  readonly noticeCategory: NoticeCategory;
  readonly deadlineAt: Date | null;
  readonly publishedAt: Date;
  readonly result: MatchResult;
}

export interface PreviewResult {
  readonly items: readonly PreviewItem[];
  /** How many recent notices the preview was run against. */
  readonly candidatesConsidered: number;
  /** How far back the preview looked, in days. */
  readonly windowDays: number;
}

/** How far back a preview looks. Long enough to be representative, short enough to be fast. */
export const PREVIEW_WINDOW_DAYS = 60;
const PREVIEW_CANDIDATE_LIMIT = 400;
const PREVIEW_RESULT_LIMIT = 10;

/**
 * A live preview of what a profile would match (spec section 9.1 step 11).
 *
 * Runs the real engine over recently published notices rather than reading
 * stored matches, because during onboarding and while editing there are no
 * stored matches yet — and a preview built from a different rule set than the
 * one that sends the emails would be a lie the user only discovers later.
 *
 * `now` is a parameter, not a clock read, so a preview is reproducible.
 */
export async function previewMatches(
  db: Database,
  input: { profile: AlertProfile; now: Date; limit?: number },
): Promise<PreviewResult> {
  const since = new Date(input.now.getTime() - PREVIEW_WINDOW_DAYS * 86_400_000);

  const rows = await db
    .select({
      id: schema.tenders.id,
      source: schema.tenders.source,
      sourceId: schema.tenders.sourceId,
      noticeId: schema.tenders.noticeId,
      sourceUrl: schema.tenders.sourceUrl,
      title: schema.tenders.title,
      description: schema.tenders.description,
      buyerName: schema.tenders.buyerName,
      buyerOrganizationNumber: schema.tenders.buyerOrganizationNumber,
      noticeType: schema.tenders.noticeType,
      noticeCategory: schema.tenders.noticeCategory,
      procedureType: schema.tenders.procedureType,
      estimatedValueMinNok: schema.tenders.estimatedValueMinNok,
      estimatedValueMaxNok: schema.tenders.estimatedValueMaxNok,
      currency: schema.tenders.currency,
      publishedAt: schema.tenders.publishedAt,
      modifiedAt: schema.tenders.modifiedAt,
      deadlineAt: schema.tenders.deadlineAt,
      status: schema.tenders.status,
      sourceRevision: schema.tenders.sourceRevision,
      sourcePayloadHash: schema.tenders.sourcePayloadHash,
      createdAt: schema.tenders.createdAt,
      updatedAt: schema.tenders.updatedAt,
      lastSyncedAt: schema.tenders.lastSyncedAt,
    })
    .from(schema.tenders)
    .where(
      and(
        gte(schema.tenders.publishedAt, since),
        isNull(schema.tenders.suppressedAt),
        // Awards are ingested but are not opportunities until phase 8, so a
        // preview that included them would overstate what the profile catches.
        sql`${schema.tenders.noticeCategory} in ('planned', 'competition')`,
      ),
    )
    .orderBy(desc(schema.tenders.publishedAt))
    .limit(PREVIEW_CANDIDATE_LIMIT);

  if (rows.length === 0) {
    return { items: [], candidatesConsidered: 0, windowDays: PREVIEW_WINDOW_DAYS };
  }

  const tenderIds = rows.map((row) => row.id);
  const [cpvByTender, regionsByTender] = await Promise.all([
    db
      .select({
        tenderId: schema.tenderCpvCodes.tenderId,
        cpvCode: schema.tenderCpvCodes.cpvCode,
      })
      .from(schema.tenderCpvCodes)
      .where(inArray(schema.tenderCpvCodes.tenderId, tenderIds)),
    db
      .select({
        tenderId: schema.tenderRegions.tenderId,
        regionCode: schema.tenderRegions.regionCode,
      })
      .from(schema.tenderRegions)
      .where(inArray(schema.tenderRegions.tenderId, tenderIds)),
  ]);

  const cpvMap = new Map<string, string[]>();
  for (const row of cpvByTender) {
    cpvMap.set(row.tenderId, [...(cpvMap.get(row.tenderId) ?? []), row.cpvCode]);
  }
  const regionMap = new Map<string, string[]>();
  for (const row of regionsByTender) {
    regionMap.set(row.tenderId, [...(regionMap.get(row.tenderId) ?? []), row.regionCode]);
  }

  const items: PreviewItem[] = [];
  for (const row of rows) {
    const tender: Tender = {
      id: row.id,
      source: row.source,
      sourceId: row.sourceId,
      ...(row.noticeId ? { noticeId: row.noticeId } : {}),
      sourceUrl: row.sourceUrl,
      title: row.title,
      ...(row.description ? { description: row.description } : {}),
      buyerName: row.buyerName,
      ...(row.buyerOrganizationNumber
        ? { buyerOrganizationNumber: row.buyerOrganizationNumber }
        : {}),
      cpvCodes: cpvMap.get(row.id) ?? [],
      regions: regionMap.get(row.id) ?? [],
      municipalities: [],
      ...(row.noticeType ? { noticeType: row.noticeType } : {}),
      noticeCategory: row.noticeCategory,
      ...(row.procedureType ? { procedureType: row.procedureType } : {}),
      ...(row.estimatedValueMinNok !== null
        ? { estimatedValueMinNok: row.estimatedValueMinNok }
        : {}),
      ...(row.estimatedValueMaxNok !== null
        ? { estimatedValueMaxNok: row.estimatedValueMaxNok }
        : {}),
      ...(row.currency ? { currency: row.currency } : {}),
      publishedAt: row.publishedAt,
      ...(row.modifiedAt ? { modifiedAt: row.modifiedAt } : {}),
      ...(row.deadlineAt ? { deadlineAt: row.deadlineAt } : {}),
      status: row.status,
      ...(row.sourceRevision ? { sourceRevision: row.sourceRevision } : {}),
      sourcePayloadHash: row.sourcePayloadHash,
      // The engine never reads the raw payload, and it is a large JSON blob, so
      // the preview query does not fetch it.
      rawPayload: null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastSyncedAt: row.lastSyncedAt,
    };

    const result = matchTender(tender, input.profile, { now: input.now });
    if (!result.included) continue;

    items.push({
      tenderId: row.id,
      title: row.title,
      buyerName: row.buyerName,
      noticeCategory: row.noticeCategory,
      deadlineAt: row.deadlineAt,
      publishedAt: row.publishedAt,
      result,
    });
  }

  items.sort((a, b) => b.result.score - a.result.score);

  return {
    items: items.slice(0, input.limit ?? PREVIEW_RESULT_LIMIT),
    candidatesConsidered: rows.length,
    windowDays: PREVIEW_WINDOW_DAYS,
  };
}

export interface ServiceTemplateOption {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  /**
   * The onboarding sentence written for this template's supplier form
   * (ADR-17). Nullable, because a template created in admin may not have one
   * yet — the page shows nothing rather than inventing generic advice.
   */
  readonly onboardingHint: string | null;
  readonly cpvInclude: readonly string[];
  readonly keywordsInclude: readonly string[];
}

/**
 * The service templates offered during onboarding (spec section 11.2).
 *
 * Read from the database, because the templates are editorial content that
 * admin maintains without a deploy. `SERVICE_TEMPLATE_SEEDS` in
 * `@luma/content` is the seed for an empty database, not the source of truth,
 * so the onboarding page falls back to it only when nothing has been seeded.
 */
/** What the anonymous surfaces need. Seeds have no `id` to offer. */
export interface ServiceTemplateChoice {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  /**
   * `cross_sector` or `sector_bound` (ADR-17).
   *
   * Read by the public pages for one rule: a `cross_sector` template's
   * national page must show a region selector above the results (IDE Agent
   * Spec v3, section 3.2). For a supplier whose buyer can be anyone, national
   * *is* the correct default view, and the selector is how they narrow it
   * themselves rather than having a landsdel guessed for them.
   *
   * It never reaches matching. `packages/matching`'s
   * `no-sector-assumptions.test.ts` fails if the engine so much as names it.
   */
  readonly supplierForm: 'cross_sector' | 'sector_bound';
  readonly cpvInclude: readonly string[];
  readonly keywordsInclude: readonly string[];
}

/**
 * The picker's options, resolvable without a database.
 *
 * The landing page is statically prerendered, and a static prerender runs at
 * build time on a machine with no `DATABASE_URL` — which is exactly how the
 * first version of the search-first form broke the build: `Error occurred
 * prerendering page "/"`, `DATABASE_URL mangler`. Making the page dynamic would
 * have fixed it and broken something worse, since IDE Agent Spec v3 section 3.2
 * forbids `force-dynamic` on public pages for the same reason it wants them
 * indexable and fast.
 *
 * So the fallback is on *configuration*, not on failure:
 *
 * - No `DATABASE_URL` at all means a build-time prerender. Fall back to the
 *   editorial seeds, which is what they are for.
 * - A configured database that returns nothing means nothing has been seeded
 *   yet, which `listServiceTemplates` already documents as the seeds' other
 *   job.
 * - A configured database that *throws* is a real failure and is allowed to
 *   propagate. Catching it here would quietly serve the seed list in
 *   production while admin's curated templates sat unreachable, and the page
 *   would look perfectly healthy while offering the wrong choices.
 */
export async function listServiceTemplateChoices(): Promise<ServiceTemplateChoice[]> {
  // No `active` filter: a seed is editorial content that ships with the build,
  // and retiring one is an edit to `@luma/content`. Only rows in the database
  // carry an `active` flag, because only they can be retired without a deploy.
  const seeds: ServiceTemplateChoice[] = SERVICE_TEMPLATE_SEEDS.slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((seed) => ({
      slug: seed.slug,
      name: seed.name,
      description: seed.description,
      supplierForm: seed.supplierForm,
      cpvInclude: seed.cpvInclude,
      keywordsInclude: seed.keywordsInclude,
    }));

  if (!process.env['DATABASE_URL']) return seeds;

  const rows = await getWebDb()
    .select({
      slug: schema.serviceTemplates.slug,
      name: schema.serviceTemplates.name,
      description: schema.serviceTemplates.description,
      supplierForm: schema.serviceTemplates.supplierForm,
      cpvInclude: schema.serviceTemplates.cpvInclude,
      keywordsInclude: schema.serviceTemplates.keywordsInclude,
    })
    .from(schema.serviceTemplates)
    .where(and(eq(schema.serviceTemplates.active, true), isNull(schema.serviceTemplates.deletedAt)))
    .orderBy(schema.serviceTemplates.sortOrder)
    .catch(() => []);

  return rows.length > 0 ? rows : seeds;
}

/** One template by slug, resolvable without a database. Null when unknown. */
export async function loadTemplateChoice(slug: string): Promise<ServiceTemplateChoice | null> {
  const templates = await listServiceTemplateChoices();
  return templates.find((template) => template.slug === slug) ?? null;
}

export async function listServiceTemplates(db: Database): Promise<ServiceTemplateOption[]> {
  const rows = await db
    .select({
      id: schema.serviceTemplates.id,
      slug: schema.serviceTemplates.slug,
      name: schema.serviceTemplates.name,
      description: schema.serviceTemplates.description,
      onboardingHint: schema.serviceTemplates.onboardingHint,
      cpvInclude: schema.serviceTemplates.cpvInclude,
      keywordsInclude: schema.serviceTemplates.keywordsInclude,
    })
    .from(schema.serviceTemplates)
    .where(and(eq(schema.serviceTemplates.active, true), isNull(schema.serviceTemplates.deletedAt)))
    .orderBy(schema.serviceTemplates.sortOrder);
  return rows;
}
