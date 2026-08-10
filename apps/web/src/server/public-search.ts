import { and, desc, gte, inArray, isNull, sql } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { countyCodesIn, landsdelOf, NATIONWIDE_LOCATION_ID, type Landsdel } from '@luma/domain';
import { getWebDb } from './db';

/**
 * The anonymous search surface's reads (IDE Agent Spec v3, section 3.2).
 *
 * These pages are public, unauthenticated and indexable, which changes the
 * rules in one specific way that is easy to get wrong: **`suppressedAt` is
 * enforced here explicitly.** The signed-in read path leans on
 * `assertTenderAccess`, and nothing on this path calls it — by design, since
 * there is no actor to check. So the suppression filter is written into every
 * query below rather than inherited, and a test asserts it, because an admin
 * suppressing an invalid notice must not leave it reachable through a public
 * URL that Google has already cached.
 *
 * Only announcement data is read. That is the boundary ADR-0018 draws: the
 * structured notice is open data under CC BY 4.0 and may be published; the
 * competition documents are not and are always user-scoped.
 */

/** How far back a public page looks. Matches the density measurement window. */
export const PUBLIC_WINDOW_DAYS = 90;
const PUBLIC_RESULT_LIMIT = 30;

export interface PublicTenderSummary {
  readonly id: string;
  readonly title: string;
  readonly buyerName: string;
  readonly noticeCategory: 'planned' | 'competition' | 'award' | 'other';
  readonly deadlineAt: Date | null;
  readonly publishedAt: Date;
  readonly regionCodes: readonly string[];
  /** True when the notice applies to the whole country rather than a region. */
  readonly nationwide: boolean;
}

export interface PublicSearchResult {
  /** Notices whose own region falls inside the landsdel being viewed. */
  readonly regional: readonly PublicTenderSummary[];
  /**
   * Notices that apply to the whole country.
   *
   * Kept as a separate list rather than merged into `regional`, and that is a
   * decision with a reason that got sharper the more data arrived. Over 94
   * days `it-tjenester-og-konsulentbistand` has **144** nationwide notices
   * against 20–128 regional ones per landsdel, so a merged list would make its
   * six pages between 53% and 88% the same content — near-duplicate pages
   * differing mostly in their heading.
   *
   * Two labelled sections keep each page's regional half genuinely its own
   * while still showing the reader every competition they can bid on. The same
   * numbers are why a page's *existence* is decided on regional notices alone
   * (`qualifying-pages.ts`): the shared pool is worth showing and not worth
   * building a page around. See `docs/search-surface-density.md`.
   */
  readonly nationwide: readonly PublicTenderSummary[];
  readonly totalConsidered: number;
}

interface Row {
  id: string;
  title: string;
  buyerName: string;
  noticeCategory: 'planned' | 'competition' | 'award' | 'other';
  deadlineAt: Date | null;
  publishedAt: Date;
}

/**
 * Active notices matching a service template, optionally cut to one landsdel.
 *
 * Matched on the template's CPV codes, which is what the density measurement
 * counted and therefore what the page-existence decision was made on. It is an
 * approximation of demand, deliberately: the real matcher also weighs
 * keywords, exclusions and value bounds against a profile that does not exist
 * yet for an anonymous visitor.
 */
export async function searchPublicTenders(input: {
  cpvInclude: readonly string[];
  landsdel?: Landsdel | undefined;
  now: Date;
  limit?: number;
}): Promise<PublicSearchResult> {
  if (input.cpvInclude.length === 0) {
    return { regional: [], nationwide: [], totalConsidered: 0 };
  }

  /*
   * No database means a build-time prerender, and an empty page is the right
   * answer to give one.
   *
   * These pages are statically generated, so `generateStaticParams` renders
   * them during the build — on a machine that has no `DATABASE_URL`, which is
   * how CI builds. Throwing there fails the whole build for a page whose data
   * will be replaced within the hour anyway.
   *
   * A production build *does* have the variable, so the deployed pages
   * prerender with real notices; this branch is what stops a database-less
   * build from being an error. `revalidate = 3600` regenerates either way, so
   * even a page built empty fills in on its first revalidation rather than
   * staying blank.
   *
   * Deliberately a check on configuration and not a `catch`: a *configured*
   * database that fails is a real fault and must still surface, rather than
   * quietly serving every trade an empty page while looking healthy.
   */
  if (!process.env['DATABASE_URL']) {
    return { regional: [], nationwide: [], totalConsidered: 0 };
  }

  const db = getWebDb();
  const since = new Date(input.now.getTime() - PUBLIC_WINDOW_DAYS * 86_400_000);

  const rows: Row[] = await db
    .selectDistinct({
      id: schema.tenders.id,
      title: schema.tenders.title,
      buyerName: schema.tenders.buyerName,
      noticeCategory: schema.tenders.noticeCategory,
      deadlineAt: schema.tenders.deadlineAt,
      publishedAt: schema.tenders.publishedAt,
    })
    .from(schema.tenders)
    .innerJoin(schema.tenderCpvCodes, sql`${schema.tenderCpvCodes.tenderId} = ${schema.tenders.id}`)
    .where(
      and(
        // Enforced here, not inherited. See the module note.
        isNull(schema.tenders.suppressedAt),
        gte(schema.tenders.publishedAt, since),
        // Awards are ingested but are not opportunities until phase 8, so a
        // public page listing them would advertise competitions already lost.
        sql`${schema.tenders.noticeCategory} in ('planned', 'competition')`,
        inArray(schema.tenderCpvCodes.cpvCode, [...input.cpvInclude]),
      ),
    )
    .orderBy(desc(schema.tenders.publishedAt))
    .limit((input.limit ?? PUBLIC_RESULT_LIMIT) * 4);

  if (rows.length === 0) {
    return { regional: [], nationwide: [], totalConsidered: 0 };
  }

  const regionRows = await db
    .select({
      tenderId: schema.tenderRegions.tenderId,
      regionCode: schema.tenderRegions.regionCode,
    })
    .from(schema.tenderRegions)
    .where(
      inArray(
        schema.tenderRegions.tenderId,
        rows.map((row) => row.id),
      ),
    );

  const byTender = new Map<string, string[]>();
  for (const row of regionRows) {
    byTender.set(row.tenderId, [...(byTender.get(row.tenderId) ?? []), row.regionCode]);
  }

  const wanted = input.landsdel ? new Set(countyCodesIn(input.landsdel)) : null;
  const regional: PublicTenderSummary[] = [];
  const nationwide: PublicTenderSummary[] = [];

  for (const row of rows) {
    const codes = byTender.get(row.id) ?? [];
    const isNationwide = codes.includes(NATIONWIDE_LOCATION_ID);
    const summary: PublicTenderSummary = {
      ...row,
      regionCodes: codes.filter((code) => code !== NATIONWIDE_LOCATION_ID),
      nationwide: isNationwide,
    };

    if (isNationwide) {
      nationwide.push(summary);
      continue;
    }
    // On a national page every non-nationwide notice is "regional" — there is
    // no cut to apply. On a landsdel page, only its own counties qualify, and
    // an unrecognised code (`landsdelOf` returning null) falls out of the cut
    // rather than being filed somewhere plausible.
    if (!wanted || summary.regionCodes.some((code) => wanted.has(code))) {
      regional.push(summary);
    }
  }

  const limit = input.limit ?? PUBLIC_RESULT_LIMIT;
  return {
    regional: regional.slice(0, limit),
    nationwide: nationwide.slice(0, limit),
    totalConsidered: rows.length,
  };
}

/** The landsdeler a template actually has regional notices in, most first. */
export async function landsdelerWithHits(input: {
  cpvInclude: readonly string[];
  now: Date;
}): Promise<{ landsdel: Landsdel; hits: number }[]> {
  const result = await searchPublicTenders({ ...input, limit: 1000 });
  const counts = new Map<string, { landsdel: Landsdel; hits: number }>();

  for (const tender of result.regional) {
    for (const code of tender.regionCodes) {
      const landsdel = landsdelOf(code);
      if (!landsdel) continue;
      const entry = counts.get(landsdel.code) ?? { landsdel, hits: 0 };
      entry.hits += 1;
      counts.set(landsdel.code, entry);
    }
  }

  return [...counts.values()].sort((a, b) => b.hits - a.hits);
}
