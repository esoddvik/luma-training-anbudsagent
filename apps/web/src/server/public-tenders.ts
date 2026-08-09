import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { COUNTY_NAMES, NATIONWIDE_LOCATION_ID } from '@luma/domain';
import { getWebDb } from './db';

/**
 * The public tender page's reads (IDE Agent Spec v3, section 3.3).
 *
 * ## The rule this module exists to hold
 *
 * **`suppressedAt` is enforced here, explicitly, in the query.** Every
 * signed-in read of a tender goes through `assertTenderAccess`; nothing on
 * this path does, and that is deliberate rather than an omission — there is no
 * actor to check on an unauthenticated page. So the suppression filter is
 * written into each query below rather than inherited from a helper.
 *
 * The consequence of getting it wrong is worse here than anywhere else in the
 * app. An admin suppresses a notice because it is invalid or because an
 * oppdragsgiver asked; if the public page kept serving it, the notice would
 * stay live on a URL a search engine has already crawled and cached, reachable
 * by anyone with the link, with no session to revoke. The integration test
 * asserts it, and it must never be relaxed into "the caller filters".
 *
 * ## What may be published here
 *
 * Announcement data only. ADR-0018 draws the line: the structured notice is
 * open data under CC BY 4.0 and may appear on an indexable page, carrying the
 * attribution; the competition documents are authored by the oppdragsgiver,
 * carry no such licence, and are always user-scoped.
 */

export type { PublicNoticeStatus } from './notice-indexing';
import type { PublicNoticeStatus } from './notice-indexing';

export interface PublicTenderDetail {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly buyerName: string;
  readonly buyerOrganizationNumber: string | null;
  readonly noticeCategory: 'planned' | 'competition' | 'award' | 'other';
  readonly status: PublicNoticeStatus;
  readonly publishedAt: Date;
  readonly deadlineAt: Date | null;
  readonly estimatedValueMinNok: number | null;
  readonly currency: string | null;
  readonly sourceUrl: string;
  readonly cpvCodes: readonly string[];
  readonly countyNames: readonly string[];
  readonly nationwide: boolean;
}

/**
 * One notice for the public page, or `null`.
 *
 * `null` covers three cases the caller must treat identically: no such notice,
 * a suppressed notice, and an award notice. Awards are ingested but are not
 * opportunities until phase 8 (ADR-13), and giving one a public page would
 * publish a competition already lost as though it were open.
 */
export async function loadPublicTender(id: string): Promise<PublicTenderDetail | null> {
  // No database means a build-time prerender. Nothing to serve, and throwing
  // would fail a build whose pages regenerate within the hour anyway. Same
  // reasoning as `public-search.ts`; a *configured* database that fails still
  // surfaces rather than being swallowed.
  if (!process.env['DATABASE_URL']) return null;

  const db = getWebDb();
  const [row] = await db
    .select({
      id: schema.tenders.id,
      title: schema.tenders.title,
      description: schema.tenders.description,
      buyerName: schema.tenders.buyerName,
      buyerOrganizationNumber: schema.tenders.buyerOrganizationNumber,
      noticeCategory: schema.tenders.noticeCategory,
      status: schema.tenders.status,
      publishedAt: schema.tenders.publishedAt,
      deadlineAt: schema.tenders.deadlineAt,
      estimatedValueMinNok: schema.tenders.estimatedValueMinNok,
      currency: schema.tenders.currency,
      sourceUrl: schema.tenders.sourceUrl,
    })
    .from(schema.tenders)
    .where(
      and(
        eq(schema.tenders.id, id),
        // Enforced here, not inherited. See the module note.
        isNull(schema.tenders.suppressedAt),
        sql`${schema.tenders.noticeCategory} in ('planned', 'competition')`,
      ),
    )
    .limit(1);

  if (!row) return null;

  const [cpv, regions] = await Promise.all([
    db
      .select({ code: schema.tenderCpvCodes.cpvCode })
      .from(schema.tenderCpvCodes)
      .where(eq(schema.tenderCpvCodes.tenderId, row.id)),
    db
      .select({ code: schema.tenderRegions.regionCode })
      .from(schema.tenderRegions)
      .where(eq(schema.tenderRegions.tenderId, row.id)),
  ]);

  const regionCodes = regions.map((region) => region.code);

  return {
    ...row,
    cpvCodes: cpv.map((entry) => entry.code),
    countyNames: regionCodes
      .map((code) => COUNTY_NAMES[code])
      .filter((name): name is string => Boolean(name)),
    nationwide: regionCodes.includes(NATIONWIDE_LOCATION_ID),
  };
}

/**
 * The notices the sitemap lists: open and planned only.
 *
 * Bounded, and that bound is load-bearing rather than a performance choice. A
 * sitemap is capped at 50 000 URLs by the protocol, and pointing a crawler at
 * every notice ever ingested would spend the site's crawl budget re-checking
 * competitions that closed months ago instead of finding the ones published
 * this morning.
 */
export async function listIndexableNotices(
  limit = 5000,
): Promise<{ id: string; publishedAt: Date }[]> {
  if (!process.env['DATABASE_URL']) return [];

  return getWebDb()
    .select({ id: schema.tenders.id, publishedAt: schema.tenders.publishedAt })
    .from(schema.tenders)
    .where(
      and(
        isNull(schema.tenders.suppressedAt),
        sql`${schema.tenders.noticeCategory} in ('planned', 'competition')`,
        sql`${schema.tenders.status} in ('open', 'unknown')`,
      ),
    )
    .orderBy(desc(schema.tenders.publishedAt))
    .limit(limit);
}
