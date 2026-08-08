import { describe, expect, it } from 'vitest';
import {
  COUNTY_NAMES,
  countyCodesIn,
  LANDSDELER,
  landsdelBySlug,
  landsdelOf,
  NATIONWIDE_LOCATION_ID,
} from './regions.js';

/**
 * The landsdel dimension behind `/anbud-for/[bransje]/[landsdel]`.
 *
 * The failure this suite is built around is not a crash. A wrong entry in a
 * region table files a tender under the wrong part of the country, renders a
 * page that looks entirely normal, and is discovered by a supplier in Tromsø
 * wondering why they were shown a job in Kristiansand.
 */

/**
 * Every NUTS-3 code observed in the live corpus, 1015 notices pulled from the
 * Doffin API on 2026-08-09.
 *
 * Pinned as data rather than described in prose, because "we handle the codes
 * Doffin sends" is a claim that decays the moment Norway reorganises its
 * counties — which it did in 2020 and again in 2024. If Doffin starts sending
 * a code that is not here, `landsdelOf` returns null for it and it silently
 * drops out of every regional page. This list is what makes that a test
 * failure instead.
 */
const OBSERVED_IN_CORPUS = [
  'NO020',
  'NO060',
  'NO071',
  'NO072',
  'NO073',
  'NO081',
  'NO083',
  'NO084',
  'NO085',
  'NO092',
  'NO093',
  'NO094',
  'NO0A1',
  'NO0A2',
  'NO0A3',
  'NO0B2',
] as const;

describe('the landsdel dimension', () => {
  it('places every county code observed in the live corpus', () => {
    const unplaced = OBSERVED_IN_CORPUS.filter((code) => landsdelOf(code) === null);
    expect(unplaced).toEqual([]);
  });

  it('names every county code it places', () => {
    for (const code of OBSERVED_IN_CORPUS) {
      expect(COUNTY_NAMES[code]).toBeTruthy();
    }
  });

  it('derives the grouping from the code rather than from a lookup table', () => {
    // NUTS level 2 is the landsdel, and a NUTS-3 code is its level-2 parent
    // plus one character. This is the property that keeps the mapping from
    // rotting: there is no county-to-landsdel table to get out of date.
    for (const code of Object.keys(COUNTY_NAMES)) {
      expect(landsdelOf(code)?.code).toBe(code.slice(0, 4));
    }
  });

  it('puts the counties where a Norwegian would expect them', () => {
    // Spot checks against the 2024 codes, which are not the ones most
    // published material still shows — Østfold was NO031 before 2020 and is
    // NO083 now, Akershus was NO012 and is NO084.
    expect(landsdelOf('NO081')?.name).toBe('Oslo og Viken');
    expect(landsdelOf('NO084')?.name).toBe('Oslo og Viken');
    expect(landsdelOf('NO0A2')?.name).toBe('Vestlandet');
    expect(landsdelOf('NO071')?.name).toBe('Nord-Norge');
    expect(landsdelOf('NO060')?.name).toBe('Trøndelag');
    expect(landsdelOf('NO020')?.name).toBe('Innlandet');
    expect(landsdelOf('NO092')?.name).toBe('Agder og Sør-Østlandet');
  });

  it('gives a nationwide notice no landsdel of its own', () => {
    // `anyw` belongs to every landsdel, never to one. A page that treated it
    // as a region would show a "nationwide" area alongside real ones; a page
    // that dropped it would understate every regional result by about a fifth,
    // since it is the single most common location value in the data.
    expect(landsdelOf(NATIONWIDE_LOCATION_ID)).toBeNull();
  });

  it('refuses to guess at a code it does not recognise', () => {
    // A foreign buyer's code, or one Norway introduces after this ships. It
    // must fall out of the regional cut and still reach the national page —
    // never be filed somewhere plausible.
    expect(landsdelOf('SE110')).toBeNull();
    expect(landsdelOf('NO099')).toBeNull();
    expect(landsdelOf('')).toBeNull();
  });

  it('round-trips every landsdel through its URL slug', () => {
    for (const landsdel of LANDSDELER) {
      expect(landsdelBySlug(landsdel.slug)).toEqual(landsdel);
    }
    expect(landsdelBySlug('ikke-en-landsdel')).toBeNull();
  });

  it('uses slugs that survive a URL without escaping', () => {
    // æ, ø and å in a path segment become percent-encoding in every link,
    // every sitemap entry and every analytics row.
    for (const landsdel of LANDSDELER) {
      expect(landsdel.slug).toMatch(/^[a-z0-9-]+$/);
      expect(encodeURIComponent(landsdel.slug)).toBe(landsdel.slug);
    }
  });

  it('partitions the counties: every one belongs to exactly one landsdel', () => {
    const assigned = LANDSDELER.flatMap((landsdel) => countyCodesIn(landsdel));
    expect(assigned.slice().sort()).toEqual(Object.keys(COUNTY_NAMES).sort());
    expect(new Set(assigned).size).toBe(assigned.length);
  });
});
