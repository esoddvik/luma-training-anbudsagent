import { and, desc, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import {
  countyCodesIn,
  findMatchingPhrases,
  isBroadCpv,
  landsdelOf,
  NATIONWIDE_LOCATION_ID,
  type Landsdel,
} from '@luma/domain';
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

/**
 * Open competitions per array. **Unchanged at 30**, on purpose.
 *
 * Raising it would be a page-weight decision, not a correctness one: bygg goes
 * from 37 notices to 196 inlined into statically prerendered HTML, each with
 * its reason rows, on a page whose whole job is to be fast and indexable. The
 * defect this module had was never that 30 was too few — it was that the *cut*
 * was taken on `publishedAt`, so the 30 kept were the 30 most recently
 * published rather than the 30 closing soonest. See `selectPopulations`.
 */
const PUBLIC_RESULT_LIMIT = 30;

/**
 * Planned procurements per array, selected and capped on their own.
 *
 * A planlagt anskaffelse has no bid deadline at all (ADR-13) and none is
 * fabricated here, so it cannot compete for a slot in a list ordered by
 * deadline — and it must not be crowded out of one either. It gets its own
 * budget for that reason, and a *small* one: a plan is the least actionable
 * thing on the page, since there is nothing yet to bid on.
 *
 * Eight is deliberately below the measured maximum rather than above it.
 * `it-tjenester-og-konsulentbistand` has 12 regional plans in the 90-day
 * window; uncapped they would put 17 plans on a page whose main list is 44
 * open competitions. Under the old shared cut plans were bounded by accident —
 * they competed for the same 30 slots — and dropping the cap entirely while
 * separating the budgets would have grown the page as a side effect of a fix
 * about ordering.
 */
const PUBLIC_PLANNED_LIMIT = 8;

/**
 * Closed competitions per array. Small by design.
 *
 * R4 keeps expired notices because they are useful when mapping a market, and
 * the group is collapsed for the same reason they are not the point of the
 * page. Five is chosen against both failure modes:
 *
 * - **Enough that the group is real.** «Avsluttede konkurranser (5)» with five
 *   cards behind it is a section a reader can use. The measured expired counts
 *   are 18 (bygg, unlimited), 2 (renhold) and 1 (IT), so five is above what
 *   three of the five templates have at all and cuts only the densest.
 * - **Few enough that they cannot displace an open one.** They no longer share
 *   a budget with open competitions — separate query, separate cap — so the
 *   number cannot cost the page a single live opportunity whatever it is set
 *   to. Five keeps the added page weight to at most ten cards (two arrays):
 *   bygg's national page goes from 37 notices to at most 47, not to 196.
 */
const PUBLIC_EXPIRED_LIMIT = 5;

/**
 * How many rows to read for every one the caller asked for.
 *
 * Was four, for the geography cut alone. It is six now because the broad-code
 * rule below throws rows away *after* the query — on `bygg-og-anlegg-utforende`
 * roughly a fifth of what the CPV join returns carries 45000000 and nothing
 * else — and a page that asked for 30 notices should not be handed 24 because
 * the filter ran out of material. Six is a measured number, not a round one:
 * the widest template drops 21% here, and 4 × 1.21 rounds up to 5, so 6 leaves
 * a margin for a corpus that shifts.
 */
const OVERFETCH = 6;

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
  /**
   * Doffin's estimated value, or `null`.
   *
   * Null about 47% of the time (see `tenders.estimatedValueMinNok`), so a
   * value filter built on this must treat null as *unknown* and never as zero.
   * The column is named `_nok` but `tenders.currency` is not always NOK.
   */
  readonly estimatedValueMinNok: number | null;
  /**
   * The notice's own CPV codes that are also in the caller's `cpvInclude`.
   *
   * Exactly the codes that caused the hit, so a card can say *which* code
   * matched rather than listing the whole template. Intersected on exact
   * equality, matching the `inArray` filter the query itself uses.
   */
  readonly cpvCodes: readonly string[];
  /**
   * The caller's `keywordsInclude` entries found in the notice **title**.
   *
   * A word the buyer put in the title is what they chose to call the contract,
   * which is why R2 weighs it as heavily as a precise CPV code. Kept separate
   * from `descriptionKeywords` rather than merged into one list, because the
   * two carry different weight and a single list would force the reader of
   * this type to guess which.
   */
  readonly matchedKeywords: readonly string[];
  /**
   * The caller's `keywordsInclude` entries found in the description but **not**
   * in the title.
   *
   * The description used to be left unread, on the argument that a large
   * free-text column was too expensive to pull into a `selectDistinct` over
   * four times the result limit. Measured on the real corpus that argument
   * does not hold: descriptions average 559 bytes and top out at 5 460, so the
   * widest page adds some 100 kB to a query that runs once an hour per page
   * and takes 3–5 ms either way — indistinguishable from the same query
   * without the column. The text never crosses the wire; only the matched
   * words below do.
   *
   * Reading it is what makes R2's weight-1 branch capable of firing at all,
   * and it is also the difference between «this notice mentions renhold
   * somewhere» being invisible and being a weak, honestly-labelled signal.
   */
  readonly descriptionKeywords: readonly string[];
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
  description: string | null;
  buyerName: string;
  noticeCategory: 'planned' | 'competition' | 'award' | 'other';
  deadlineAt: Date | null;
  publishedAt: Date;
  estimatedValueMinNok: number | null;
}

/**
 * R1: a notice whose *only* signal is a broad CPV code is not shown.
 *
 * ## Why the rule exists
 *
 * 98300000 «Diverse tjenester» is what a buyer tags a notice with when nothing
 * precise fits. On `renhold-og-facility-management` it was qualifying
 * advokattjenester, frisørmøbler, fire separate lås-og-beslag contracts, a
 * parkeringsløsning, two bassengroboter and the transport of dead animals —
 * every one a genuine CPV match, none of them work a cleaning company can bid
 * for. A code that means «none of the above» is not evidence, and the fix is to
 * stop treating it as any.
 *
 * ## Why it lives here and not in the SQL
 *
 * Three reasons, in order of weight:
 *
 * 1. **The rule is about a set, not a row.** The query joins one CPV code per
 *    row; the question is whether *all* of a notice's matching codes are broad.
 *    In SQL that is a `NOT EXISTS` over a second pass of `tender_cpv_codes`,
 *    and the breadth predicate inside it would have to be re-expressed as a
 *    `LIKE '%000000'` plus a hand-copied literal list — a second copy of
 *    `EXPLICIT_BROAD_CPV` that no test could keep in step with the first.
 * 2. **Keywords are the other half of the condition.** «Only signal» means no
 *    precise code *and* no keyword hit, and keyword matching is
 *    `findMatchingPhrases` — whole-word, diacritic-folding Norwegian phrase
 *    logic that a `WHERE title ILIKE` cannot reproduce without changing what
 *    counts as a match.
 * 3. **One rule, both callers.** `landsdelerWithHits` decides which landsdel
 *    pages exist by counting the results of this same function. Filtering in
 *    the page instead would let a page qualify on notices it then refuses to
 *    show, and R1 would have to be written twice.
 *
 * The cost is that rows are discarded after the fetch rather than before it,
 * which `OVERFETCH` pays for.
 *
 * Note what this does *not* do: a broad code still counts, at weight 1, for any
 * notice that also carries something precise. It is disqualified from being the
 * whole story, not from being part of it.
 */
function onlySignalIsABroadCode(
  cpvCodes: readonly string[],
  titleKeywords: readonly string[],
  descriptionKeywords: readonly string[],
): boolean {
  if (cpvCodes.length === 0) return false;
  if (titleKeywords.length > 0 || descriptionKeywords.length > 0) return false;
  return cpvCodes.every((code) => isBroadCpv(code));
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
  /**
   * The template's keywords, for `matchedKeywords`. Optional and never a
   * filter: a notice that matches on CPV but mentions none of the words is
   * still a hit, exactly as before this parameter existed.
   */
  keywordsInclude?: readonly string[];
  landsdel?: Landsdel | undefined;
  now: Date;
  /** Open competitions per array. Defaults to `PUBLIC_RESULT_LIMIT`. */
  limit?: number;
  /** Planned procurements per array. Defaults to `PUBLIC_PLANNED_LIMIT`. */
  plannedLimit?: number;
  /** Closed competitions per array. Defaults to `PUBLIC_EXPIRED_LIMIT`. */
  expiredLimit?: number;
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

  const openLimit = input.limit ?? PUBLIC_RESULT_LIMIT;
  const plannedLimit = input.plannedLimit ?? PUBLIC_PLANNED_LIMIT;
  const expiredLimit = input.expiredLimit ?? PUBLIC_EXPIRED_LIMIT;

  /**
   * One population's rows, selected and ordered on that population's terms.
   *
   * The `orderBy` is the whole point of the split. A single query cannot order
   * three populations correctly at once: open competitions want the nearest
   * deadline first, planned procurements have no deadline to want anything by,
   * and expired ones want the most recently closed. Ordering all three by
   * `publishedAt` — which is what this module did — silently answered every
   * one of those questions with the wrong field.
   */
  function fetchPopulation(where: SQL | undefined, order: SQL[], limit: number): Promise<Row[]> {
    return db
      .selectDistinct({
        id: schema.tenders.id,
        title: schema.tenders.title,
        description: schema.tenders.description,
        buyerName: schema.tenders.buyerName,
        noticeCategory: schema.tenders.noticeCategory,
        deadlineAt: schema.tenders.deadlineAt,
        publishedAt: schema.tenders.publishedAt,
        estimatedValueMinNok: schema.tenders.estimatedValueMinNok,
      })
      .from(schema.tenders)
      .innerJoin(
        schema.tenderCpvCodes,
        sql`${schema.tenderCpvCodes.tenderId} = ${schema.tenders.id}`,
      )
      .where(
        and(
          // Enforced here, not inherited. See the module note.
          isNull(schema.tenders.suppressedAt),
          gte(schema.tenders.publishedAt, since),
          inArray(schema.tenderCpvCodes.cpvCode, [...input.cpvInclude]),
          where,
        ),
      )
      .orderBy(...order)
      .limit(limit * OVERFETCH);
  }

  /*
   * Awards never appear in any of the three: they are ingested but are not
   * opportunities until phase 8, so a public page listing them would advertise
   * competitions already lost. The three predicates below are disjoint and
   * their union is exactly the set the single query used to return.
   */
  const isCompetition = sql`${schema.tenders.noticeCategory} = 'competition'`;

  const [openRows, plannedRows, expiredRows] = await Promise.all([
    // Open: the deadline has not passed, or the source never stated one. A
    // competition without a deadline is not urgent and not closed either, so
    // it sorts last within the population — matching `compareByDeadline` in
    // `results-filter.ts`, which the browser re-applies over the same set.
    fetchPopulation(
      and(
        isCompetition,
        or(isNull(schema.tenders.deadlineAt), gte(schema.tenders.deadlineAt, input.now)),
      ),
      [sql`${schema.tenders.deadlineAt} asc nulls last`, desc(schema.tenders.publishedAt)],
      openLimit,
    ),
    // Planned: no deadline exists to order by (ADR-13) and none is invented.
    // Newest first, which is the contract `landsdelerWithHits` and the density
    // measurement were taken under.
    fetchPopulation(
      sql`${schema.tenders.noticeCategory} = 'planned'`,
      [desc(schema.tenders.publishedAt)],
      plannedLimit,
    ),
    // Expired: most recently closed first — the freshest market signal, and
    // the same order `compareExpired` puts them in.
    fetchPopulation(
      and(isCompetition, lt(schema.tenders.deadlineAt, input.now)),
      [desc(schema.tenders.deadlineAt)],
      expiredLimit,
    ),
  ]);

  const populations: readonly { rows: Row[]; limit: number }[] = [
    { rows: openRows, limit: openLimit },
    { rows: plannedRows, limit: plannedLimit },
    { rows: expiredRows, limit: expiredLimit },
  ];
  const totalConsidered = openRows.length + plannedRows.length + expiredRows.length;

  if (totalConsidered === 0) {
    return { regional: [], nationwide: [], totalConsidered: 0 };
  }

  const ids = [...openRows, ...plannedRows, ...expiredRows].map((row) => row.id);

  const [regionRows, cpvRows] = await Promise.all([
    db
      .select({
        tenderId: schema.tenderRegions.tenderId,
        regionCode: schema.tenderRegions.regionCode,
      })
      .from(schema.tenderRegions)
      .where(inArray(schema.tenderRegions.tenderId, ids)),
    // Only the codes the caller asked about. The join above already proved
    // each row has at least one, so this re-reads the same rows to find out
    // *which* — narrowed in the query rather than filtered in memory, since a
    // notice can carry dozens of codes that are none of the caller's business.
    db
      .select({
        tenderId: schema.tenderCpvCodes.tenderId,
        cpvCode: schema.tenderCpvCodes.cpvCode,
      })
      .from(schema.tenderCpvCodes)
      .where(
        and(
          inArray(schema.tenderCpvCodes.tenderId, ids),
          inArray(schema.tenderCpvCodes.cpvCode, [...input.cpvInclude]),
        ),
      ),
  ]);

  const byTender = new Map<string, string[]>();
  for (const row of regionRows) {
    byTender.set(row.tenderId, [...(byTender.get(row.tenderId) ?? []), row.regionCode]);
  }

  const cpvByTender = new Map<string, string[]>();
  for (const row of cpvRows) {
    cpvByTender.set(row.tenderId, [...(cpvByTender.get(row.tenderId) ?? []), row.cpvCode]);
  }

  const keywords = input.keywordsInclude ?? [];
  const wanted = input.landsdel ? new Set(countyCodesIn(input.landsdel)) : null;
  const regional: PublicTenderSummary[] = [];
  const nationwide: PublicTenderSummary[] = [];

  /*
   * Each population fills its own budget, in each array, independently.
   *
   * The cap is applied here rather than with a `slice` at the end, and that is
   * the difference between the two behaviours. One shared cut over a merged
   * list is what let the earliest-published notices — which is to say the
   * expired ones — be removed before the page ever saw them, and equally what
   * let a dense trade's 30 slots fill with notices that merely happened to be
   * announced this week. Three budgets cannot starve each other.
   */
  for (const population of populations) {
    let keptRegional = 0;
    let keptNationwide = 0;

    for (const row of population.rows) {
      if (keptRegional >= population.limit && keptNationwide >= population.limit) break;

      const codes = byTender.get(row.id) ?? [];
      const isNationwide = codes.includes(NATIONWIDE_LOCATION_ID);
      const cpvCodes = cpvByTender.get(row.id) ?? [];
      // Whole-word / phrase containment, not substring: "bad" must not match
      // "badevakt". See `containsPhrase` in `@luma/domain`.
      const titleKeywords = keywords.length === 0 ? [] : findMatchingPhrases(row.title, keywords);
      const inTitle = new Set(titleKeywords);
      const descriptionKeywords =
        keywords.length === 0 || !row.description
          ? []
          : findMatchingPhrases(row.description, keywords).filter((word) => !inTitle.has(word));

      if (onlySignalIsABroadCode(cpvCodes, titleKeywords, descriptionKeywords)) continue;

      const { description: _description, ...rest } = row;
      const summary: PublicTenderSummary = {
        ...rest,
        regionCodes: codes.filter((code) => code !== NATIONWIDE_LOCATION_ID),
        nationwide: isNationwide,
        cpvCodes,
        matchedKeywords: titleKeywords,
        descriptionKeywords,
      };

      if (isNationwide) {
        if (keptNationwide < population.limit) {
          nationwide.push(summary);
          keptNationwide += 1;
        }
        continue;
      }
      // On a national page every non-nationwide notice is "regional" — there is
      // no cut to apply. On a landsdel page, only its own counties qualify, and
      // an unrecognised code (`landsdelOf` returning null) falls out of the cut
      // rather than being filed somewhere plausible.
      if (!wanted || summary.regionCodes.some((code) => wanted.has(code))) {
        if (keptRegional < population.limit) {
          regional.push(summary);
          keptRegional += 1;
        }
      }
    }
  }

  return { regional, nationwide, totalConsidered };
}

/**
 * The landsdeler a template actually has regional notices in, most first.
 *
 * **This function decides which landsdel pages exist**, so what it counts is
 * not free to drift. It asks for every population uncapped rather than
 * inheriting the page's budgets: the page shows five expired notices because
 * five is enough to be useful, while the density measurement in
 * `docs/search-surface-density.md` counted every active notice in the window
 * and the committed page set in `qualifying-pages.ts` was taken against that
 * number. Passing the display caps in here would have quietly re-measured the
 * site's page set against a smaller corpus.
 */
export async function landsdelerWithHits(input: {
  cpvInclude: readonly string[];
  now: Date;
}): Promise<{ landsdel: Landsdel; hits: number }[]> {
  const result = await searchPublicTenders({
    ...input,
    limit: 1000,
    plannedLimit: 1000,
    expiredLimit: 1000,
  });
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
