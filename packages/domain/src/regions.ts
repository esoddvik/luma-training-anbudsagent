/**
 * Norwegian regions, and the landsdel dimension the public search pages use
 * (IDE Agent Spec v3, section 3.2).
 *
 * ## Why the grouping is derived rather than listed
 *
 * A landsdel is not a concept this codebase invents. NUTS levels already carry
 * it: every NUTS-3 code Doffin publishes is the level-2 code plus one
 * character, and level 2 *is* the landsdel — `NO071` (Nordland) sits under
 * `NO07` (Nord-Norge), `NO0A2` (Vestland) under `NO0A` (Vestlandet).
 *
 * So `landsdelOf` slices the code rather than reading a table. That matters
 * more than it looks: a hand-written county-to-landsdel map is exactly the kind
 * of table that rots silently when Norway reorganises its counties — which it
 * did in 2020 and again in 2024, and which is why the NUTS codes in the live
 * data (`NO083` Østfold, `NO084` Akershus) are not the ones most published
 * material still shows (`NO031`, `NO012`). A wrong entry in such a table does
 * not crash; it files a tender under the wrong part of the country and looks
 * completely normal doing it.
 *
 * The names below are the only hand-maintained part, and they are checked
 * against the codes actually present in the corpus by
 * `regions.test.ts`.
 *
 * Source: the eForms NUTS code list published by TED
 * (https://docs.ted.europa.eu/eforms/latest/reference/code-lists/nuts.html),
 * which is the vocabulary Doffin itself publishes against — not a general
 * reference, which is how the 2016-era codes end up being quoted for 2026 data.
 */

/** A landsdel: NUTS level 2 within Norway. */
export interface Landsdel {
  /** NUTS-2 code, e.g. `NO0A`. */
  readonly code: string;
  /** Norwegian bokmål display name. */
  readonly name: string;
  /** URL segment for `/anbud-for/[bransje]/[landsdel]`. */
  readonly slug: string;
}

/**
 * `locationId: "anyw"` means the notice applies nationwide.
 *
 * It is not a NUTS code, it is the single most common value in the data, and
 * treating it as an unmatched region would silently drop about a fifth of all
 * notices (docs/spec-deviations.md). It belongs to every landsdel, never to
 * one, so it has no landsdel of its own.
 */
export const NATIONWIDE_LOCATION_ID = 'anyw';

export const LANDSDELER: readonly Landsdel[] = [
  { code: 'NO08', name: 'Oslo og Viken', slug: 'oslo-og-viken' },
  { code: 'NO09', name: 'Agder og Sør-Østlandet', slug: 'agder-og-sor-ostlandet' },
  { code: 'NO0A', name: 'Vestlandet', slug: 'vestlandet' },
  { code: 'NO02', name: 'Innlandet', slug: 'innlandet' },
  { code: 'NO06', name: 'Trøndelag', slug: 'trondelag' },
  { code: 'NO07', name: 'Nord-Norge', slug: 'nord-norge' },
  { code: 'NO0B', name: 'Svalbard og Jan Mayen', slug: 'svalbard-og-jan-mayen' },
];

/**
 * The counties, for labelling a result rather than for routing.
 *
 * Pages are cut by landsdel, not by county: at the volumes Doffin actually
 * carries, a per-county page would be empty most weeks for most trades, and an
 * empty page indexed by Google is worse than no page.
 */
export const COUNTY_NAMES: Readonly<Record<string, string>> = {
  NO020: 'Innlandet',
  NO060: 'Trøndelag',
  NO071: 'Nordland',
  NO072: 'Troms',
  NO073: 'Finnmark',
  NO081: 'Oslo',
  NO083: 'Østfold',
  NO084: 'Akershus',
  NO085: 'Buskerud',
  NO092: 'Agder',
  NO093: 'Vestfold',
  NO094: 'Telemark',
  NO0A1: 'Rogaland',
  NO0A2: 'Vestland',
  NO0A3: 'Møre og Romsdal',
  NO0B1: 'Jan Mayen',
  NO0B2: 'Svalbard',
};

const BY_SLUG = new Map(LANDSDELER.map((entry) => [entry.slug, entry]));
const BY_CODE = new Map(LANDSDELER.map((entry) => [entry.code, entry]));

/**
 * The landsdel a NUTS-3 code belongs to, or `null`.
 *
 * `null` for `anyw` (nationwide, belongs to all of them) and for anything that
 * is not a recognised Norwegian NUTS-3 code — a foreign buyer's code, or a new
 * one Norway introduces after this ships. Returning `null` rather than guessing
 * is deliberate: an unrecognised code must drop out of the regional cut and
 * still appear on the national page, never be filed somewhere plausible.
 */
export function landsdelOf(regionCode: string): Landsdel | null {
  if (regionCode === NATIONWIDE_LOCATION_ID) return null;
  if (!(regionCode in COUNTY_NAMES)) return null;
  return BY_CODE.get(regionCode.slice(0, 4)) ?? null;
}

export function landsdelBySlug(slug: string): Landsdel | null {
  return BY_SLUG.get(slug) ?? null;
}

/** Every NUTS-3 code that belongs to a landsdel. */
export function countyCodesIn(landsdel: Landsdel): string[] {
  return Object.keys(COUNTY_NAMES).filter((code) => code.startsWith(landsdel.code));
}
