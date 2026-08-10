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
 * `search-surface-density.md` and update this list. `PAGES_MEASURED_OVER_DAYS`
 * records the window it was taken over, so staleness is visible here and not
 * only in prose.
 *
 * The 94-day window is the real one the spec asks for, reached by
 * `runBackfill` — the hourly sync cannot get there on its own, because Doffin
 * serves at most 1000 hits per query and that is roughly five weeks of
 * notices.
 */

/** The window the list below was measured over. The spec asks for 90. */
export const PAGES_MEASURED_OVER_DAYS = 94;
export const PAGES_MEASURED_ON = '2026-08-10';

/**
 * Notices a landsdel needs **of its own** before it gets a page.
 *
 * The "of its own" is the whole rule, and it was not always so. Nationwide
 * notices used to count towards this — a deliberate decision, on the good
 * grounds that a nationwide competition is a real opportunity for a supplier
 * in that landsdel and hiding it would optimise the page against its reader.
 *
 * That held while the corpus was 37 days and the nationwide pool ran from 1 to
 * 36 notices. Backfilled to 94 days it runs from 9 to **144**, and the rule
 * inverted: the shared pool alone cleared the threshold everywhere, so 48 of
 * the 56 possible pairs "qualified" — including `bemanning-og-rekruttering` in
 * six landsdeler on own-counts of 1, 2, 2, 3, 4 and 6. A page carrying one
 * regional notice above nine nationwide ones is not a regional page, and six
 * `it-tjenester` pages sharing 144 notices apiece are one page with six URLs.
 *
 * So the threshold now measures only what makes a page *distinct*. Nationwide
 * notices still render, in their own labelled section, and still matter to the
 * reader — they simply no longer justify a page's existence. The reader loses
 * nothing; the index gains 17 fewer near-duplicates.
 */
export const QUALIFYING_THRESHOLD = 8;

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
  // Own notices in the 94-day window, for the record:
  // 187 / 84 / 228 / 60 / 97 / 181 across NO08 NO09 NO0A NO02 NO06 NO07.
  'bygg-og-anlegg-utforende': ['NO08', 'NO09', 'NO0A', 'NO02', 'NO06', 'NO07'],
  // 128 / 22 / 55 / 29 / 20 / 37.
  'it-tjenester-og-konsulentbistand': ['NO08', 'NO09', 'NO0A', 'NO02', 'NO06', 'NO07'],
  // 120 / 43 / 95 / 30 / 30 / 73. NO0B has 1 and does not qualify.
  'drift-og-vedlikehold-av-eiendom': ['NO08', 'NO09', 'NO0A', 'NO02', 'NO06', 'NO07'],
  // 84 / 32 / 71 / 24 / 36 / 54.
  'radgivende-ingeniortjenester': ['NO08', 'NO09', 'NO0A', 'NO02', 'NO06', 'NO07'],
  // 15 / 6 / 31 / 5 / 11 / 17 — NO09 and NO02 fall short.
  'renhold-og-facility-management': ['NO08', 'NO0A', 'NO06', 'NO07'],
  // 15 / 5 / 9 / 2 / 1 / 6 — only Oslo og Viken and Vestlandet clear it.
  'vakthold-og-sikkerhet': ['NO08', 'NO0A'],
  // 18 / 1 / 6 / 0 / 6 / 2 — Oslo og Viken alone.
  'kantine-og-matservering': ['NO08'],
  // `bemanning-og-rekruttering` appears nowhere: its best landsdel has 6 own
  // notices in 94 days. It has a national page and nothing else, which is the
  // mechanism working rather than a gap.
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
