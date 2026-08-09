import { LANDSDELER, landsdelBySlug, type Landsdel } from '@luma/domain';
import { listServiceTemplateChoices } from './profiles';

/**
 * Which `/anbud-for/[bransje]/[landsdel]` pages exist
 * (IDE Agent Spec v3, section 3.2).
 *
 * The spec's rule is that a template × landsdel pair earns a page only when it
 * clears eight active notices in the window; below that it collapses into the
 * template's national page. The measurement that produced this list, the query
 * behind it and its known limits are in `docs/search-surface-density.md`.
 *
 * ## Why the list is committed rather than computed at build
 *
 * `generateStaticParams` runs during the build, on a machine with no
 * `DATABASE_URL` — the same fact that broke the landing page once already. A
 * page set that could only be computed from the database would either fail the
 * build or quietly fall back to generating nothing.
 *
 * Committing it has a second benefit worth naming: the set of pages this site
 * exposes to search engines becomes a reviewable diff rather than an emergent
 * property of last night's data. A trade appearing or disappearing from the
 * index is then a decision someone made, in a commit, with the density
 * document to argue with.
 *
 * **It is a measurement, not a constant.** Re-run the query in
 * `search-surface-density.md` against a full 90-day corpus and update this
 * list; the one below was measured over 37 days and therefore *undercounts*.
 * `PAGES_MEASURED_OVER_DAYS` records that so the staleness is visible here and
 * not only in prose.
 */

/** The window the list below was measured over. The spec asks for 90. */
export const PAGES_MEASURED_OVER_DAYS = 37;
export const PAGES_MEASURED_ON = '2026-08-10';
/** Notices needed in the window before a pair gets its own page. */
export const QUALIFYING_THRESHOLD = 8;

/**
 * A pair must also have at least this many notices *of its own*.
 *
 * Nationwide notices count towards `QUALIFYING_THRESHOLD` — that was a
 * deliberate product decision, because a nationwide competition is a real
 * opportunity for a supplier in that landsdel and hiding it to make the page
 * look more distinctive would optimise the page against its reader.
 *
 * Measured against production, that rule alone produces a degenerate result:
 * **Svalbard og Jan Mayen qualifies for four templates on zero regional
 * notices.** Every one of its counts is borrowed from the nationwide pool, so
 * the page would render an empty regional section above a "gjelder hele
 * landet" list identical to the other six landsdeler — the emptiest possible
 * page, and duplicate content pointed at a search engine.
 *
 * So the regional half has to justify the page's existence. One notice is a
 * deliberately low bar: the threshold is what decides whether a page is worth
 * having, and this only rules out the case where "regional page" is a lie.
 */
export const MINIMUM_OWN_NOTICES = 1;

/**
 * Template slug → landsdel codes that cleared the threshold.
 *
 * Two of the eight templates appear nowhere: `kantine-og-matservering` and
 * `bemanning-og-rekruttering` cleared it in no landsdel at all, so they have a
 * national page and nothing else. That is the mechanism working rather than a
 * gap — a regional page for canteen services in Innlandet would be empty most
 * weeks, and an empty page in an index is worse than no page.
 */
export const QUALIFYING_REGIONAL_PAGES: Readonly<Record<string, readonly string[]>> = {
  'bygg-og-anlegg-utforende': ['NO08', 'NO09', 'NO0A', 'NO02', 'NO06', 'NO07'],
  'it-tjenester-og-konsulentbistand': ['NO08', 'NO09', 'NO0A', 'NO02', 'NO06', 'NO07'],
  'drift-og-vedlikehold-av-eiendom': ['NO08', 'NO09', 'NO0A', 'NO02', 'NO06', 'NO07'],
  'radgivende-ingeniortjenester': ['NO08', 'NO09', 'NO0A', 'NO02', 'NO06', 'NO07'],
  'renhold-og-facility-management': ['NO08', 'NO07'],
  // Added on the 2026-08-10 re-measurement against production. Both clear the
  // threshold only once nationwide notices are counted — 3 of their own plus 5
  // shared — which is exactly the case the counting rule was chosen to admit.
  'kantine-og-matservering': ['NO08', 'NO0A'],
  'vakthold-og-sikkerhet': ['NO08'],
};

/** Does this pair have its own page, or does it collapse to the national one? */
export function qualifies(templateSlug: string, landsdel: Landsdel): boolean {
  return (QUALIFYING_REGIONAL_PAGES[templateSlug] ?? []).includes(landsdel.code);
}

export interface RegionalPageParams {
  readonly bransje: string;
  readonly landsdel: string;
}

/** Every qualifying pair, as route parameters. */
export function qualifyingRegionalParams(): RegionalPageParams[] {
  return Object.entries(QUALIFYING_REGIONAL_PAGES).flatMap(([bransje, codes]) =>
    codes
      .map((code) => LANDSDELER.find((entry) => entry.code === code))
      .filter((entry): entry is Landsdel => entry !== undefined)
      .map((entry) => ({ bransje, landsdel: entry.slug })),
  );
}

/** The landsdeler a template has its own pages for, in display order. */
export function landsdelerFor(templateSlug: string): Landsdel[] {
  return LANDSDELER.filter((entry) => qualifies(templateSlug, entry));
}

export function landsdelFromParam(slug: string): Landsdel | null {
  return landsdelBySlug(slug);
}

/**
 * Every template that has a national page, for `generateStaticParams`.
 *
 * Every template gets one, whether or not it earned any regional pages — the
 * national page is where a below-threshold trade lives, so it is precisely the
 * templates with no regional pages that need theirs most.
 */
export async function nationalPageParams(): Promise<{ bransje: string }[]> {
  const templates = await listServiceTemplateChoices();
  return templates.map((template) => ({ bransje: template.slug }));
}
