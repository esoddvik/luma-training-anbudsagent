import {
  findCpvOverlaps,
  isCpvDescendantOf,
  normalizeCpv,
  normalizeSearchText,
  type AlertProfile,
  type Tender,
} from '@luma/domain';
import { compareNormalized, digitsOnly, nameContains, placeMatches, sortedUnique } from './util.js';

/**
 * The shared predicates: "does this tender satisfy this criterion, and with
 * what evidence".
 *
 * They live apart from the scorers because both the hard exclusions
 * (`exclusions.ts`) and the point-scoring components (`components/*.ts`) ask
 * the same questions of the same data. Asking them in one place is what keeps
 * an inclusion and its mirror-image exclusion from drifting apart.
 *
 * Every function here returns results in a deterministic order that does not
 * depend on the order of the profile's arrays. That property is what the
 * shuffle test in `engine.test.ts` exercises.
 */

export interface CpvMatch {
  /** The tender's code, normalised to eight digits. */
  readonly tenderCode: string;
  /** The profile code that covers it, normalised to eight digits. */
  readonly profileCode: string;
  /** Significant digits of the profile code: higher means more specific. */
  readonly specificity: number;
  /** True when the profile named exactly this code rather than an ancestor. */
  readonly exact: boolean;
}

/** Distinct, normalised CPV codes of a tender, in a stable order. */
export function normalizedCpvCodes(codes: readonly string[]): string[] {
  const normalized = codes
    .map((code) => normalizeCpv(code))
    .filter((code): code is string => code !== null);
  return [...new Set(normalized)].sort();
}

/**
 * The best covering profile code for each of the tender's codes.
 *
 * `findCpvOverlaps` returns every pair; keeping only the most specific pair per
 * tender code means the evidence names the closest reason instead of repeating
 * the same tender code once per ancestor in the profile.
 */
export function findCpvMatches(
  tenderCodes: readonly string[],
  profileCodes: readonly string[],
): CpvMatch[] {
  const tender = normalizedCpvCodes(tenderCodes);
  const profile = normalizedCpvCodes(profileCodes);
  const overlaps = findCpvOverlaps(tender, profile);

  const best = new Map<string, CpvMatch>();
  for (const overlap of overlaps) {
    const current = best.get(overlap.tenderCode);
    const candidate: CpvMatch = {
      tenderCode: overlap.tenderCode,
      profileCode: overlap.profileCode,
      specificity: overlap.specificity,
      exact: overlap.tenderCode === overlap.profileCode,
    };
    if (
      current === undefined ||
      candidate.specificity > current.specificity ||
      (candidate.specificity === current.specificity && candidate.profileCode < current.profileCode)
    ) {
      best.set(overlap.tenderCode, candidate);
    }
  }

  return [...best.values()].sort(
    (a, b) =>
      b.specificity - a.specificity ||
      Number(b.exact) - Number(a.exact) ||
      (a.tenderCode < b.tenderCode ? -1 : a.tenderCode > b.tenderCode ? 1 : 0),
  );
}

/** True when any of the tender's codes sits at or below any listed code. */
export function anyCpvCovered(
  tenderCodes: readonly string[],
  profileCodes: readonly string[],
): string[] {
  const covered: string[] = [];
  for (const tenderCode of normalizedCpvCodes(tenderCodes)) {
    for (const profileCode of normalizedCpvCodes(profileCodes)) {
      if (isCpvDescendantOf(tenderCode, profileCode)) {
        covered.push(
          tenderCode === profileCode ? tenderCode : `${tenderCode} (under ${profileCode})`,
        );
        break;
      }
    }
  }
  return covered;
}

export interface KeywordMatch {
  /** The keyword as the user spelled it, so evidence reads back correctly. */
  readonly keyword: string;
  readonly inTitle: boolean;
  readonly inDescription: boolean;
}

/**
 * Whole-word and phrase matches of the profile's keywords against the tender.
 *
 * Occurrences are not counted. A keyword that appears fifteen times in a long
 * description is one matched keyword, exactly like a keyword that appears
 * once: the scorer must reward breadth of agreement, not verbosity of the
 * buyer's prose.
 */
export function findKeywordMatches(tender: Tender, keywords: readonly string[]): KeywordMatch[] {
  const title = tender.title;
  const description = tender.description ?? '';

  const matches: KeywordMatch[] = [];
  for (const keyword of sortedUnique(keywords)) {
    const inTitle = nameContains(title, keyword);
    const inDescription = description.length > 0 && nameContains(description, keyword);
    if (inTitle || inDescription) matches.push({ keyword, inTitle, inDescription });
  }
  return matches.sort((a, b) => compareNormalized(a.keyword, b.keyword));
}

/**
 * Values in `Tender.regions` that mean "the whole country" rather than a
 * place.
 *
 * `anyw` is Doffin's own `locationId` for a nationwide procurement and is the
 * single most common geography value in the source: 182 of 1000 sampled
 * notices carry it. It is not a NUTS code. Treating it as an unmatched region
 * would silently drop roughly a fifth of everything Doffin publishes for every
 * user with a regional profile — and silently is the operative word, because
 * the user would see a quiet inbox and conclude the market was slow.
 *
 * The Norwegian spellings are here so the constant still holds if the adapter
 * ever normalises `anyw` into a display value.
 */
export const NATIONWIDE_GEOGRAPHY_MARKERS: readonly string[] = ['anyw', 'hele landet', 'nasjonal'];

const NATIONWIDE_SIGNATURES = new Set(
  NATIONWIDE_GEOGRAPHY_MARKERS.map((marker) => normalizeSearchText(marker)),
);

/** True when the tender covers the whole country rather than a named place. */
export function isNationwide(tender: Tender): boolean {
  return [...tender.regions, ...tender.municipalities].some((place) =>
    NATIONWIDE_SIGNATURES.has(normalizeSearchText(place)),
  );
}

export interface GeographyMatch {
  /** True when the tender is nationwide, so every profile geography fits. */
  readonly nationwide: boolean;
  /** Matching places the tender filed at municipality level, stable order. */
  readonly municipalities: string[];
  /** Matching places the tender filed at region level, stable order. */
  readonly regions: string[];
  /** The profile entries that produced the matches, for evidence. */
  readonly profileEntries: string[];
}

/** True when the profile states any geographic preference at all. */
export function hasGeographyCriteria(profile: AlertProfile): boolean {
  return profile.regionsInclude.length > 0 || profile.municipalitiesInclude.length > 0;
}

/** True when the tender itself states where the work is. */
export function tenderStatesGeography(tender: Tender): boolean {
  return tender.regions.length > 0 || tender.municipalities.length > 0;
}

/**
 * Which of the tender's places the profile asked for.
 *
 * Profile municipalities and profile regions are both compared against both of
 * the tender's lists, and place matching is bidirectional. Two reasons:
 * sources disagree about which level a place name is filed under, and Doffin
 * has **no municipality field at all** — NUTS-3 (county) is the finest
 * geography it exposes, so `Tender.municipalities` is empty in practice. A
 * profile that names only municipalities has to be able to match a tender that
 * names only regions, or it matches nothing forever.
 *
 * Precision is judged by the level the *tender* used, not by which profile
 * list the entry came from: a profile municipality that matched a tender
 * region is a region-level match, and the score says so.
 */
export function findGeographyMatches(tender: Tender, profile: AlertProfile): GeographyMatch {
  if (isNationwide(tender)) {
    return { nationwide: true, municipalities: [], regions: [], profileEntries: [] };
  }

  const wanted = [...profile.municipalitiesInclude, ...profile.regionsInclude];
  const matched = (places: readonly string[]): string[] =>
    sortedUnique(places.filter((place) => wanted.some((entry) => placeMatches(place, entry))));

  const municipalities = matched(tender.municipalities);
  const municipalitySignatures = new Set(municipalities.map((place) => normalizeSearchText(place)));
  // A source that files "Oslo" as both a region and a municipality is naming
  // one place, not two. Counting it twice would inflate the match.
  const regions = matched(tender.regions).filter(
    (place) => !municipalitySignatures.has(normalizeSearchText(place)),
  );

  const tenderPlaces = [...tender.regions, ...tender.municipalities];
  const profileEntries = sortedUnique(
    wanted.filter((entry) => tenderPlaces.some((place) => placeMatches(place, entry))),
  );

  return { nationwide: false, municipalities, regions, profileEntries };
}

/**
 * The verdict the geography filter and the geography scorer both act on.
 *
 * `inconclusive` is the important one. It means the two sides cannot be
 * compared, so the tender is neither rewarded nor filtered out. Excluding on an
 * inconclusive comparison is how a data gap at the source turns into an empty
 * inbox.
 */
export type GeographyVerdict = 'no_criteria' | 'nationwide' | 'match' | 'outside' | 'inconclusive';

export function decideGeography(
  tender: Tender,
  profile: AlertProfile,
): { verdict: GeographyVerdict; match: GeographyMatch } {
  const match = findGeographyMatches(tender, profile);

  if (!hasGeographyCriteria(profile)) return { verdict: 'no_criteria', match };
  if (match.nationwide) return { verdict: 'nationwide', match };
  if (!tenderStatesGeography(tender)) return { verdict: 'inconclusive', match };
  if (match.municipalities.length > 0 || match.regions.length > 0) {
    return { verdict: 'match', match };
  }

  /**
   * A profile that names only municipalities, against a tender that names only
   * regions, is a comparison between two different levels of a hierarchy this
   * package has no map of. "Bærum is not Akershus" is not something the string
   * comparison can know, so the honest answer is that we do not know — and an
   * unknown must never exclude.
   */
  if (profile.regionsInclude.length === 0 && tender.municipalities.length === 0) {
    return { verdict: 'inconclusive', match };
  }

  return { verdict: 'outside', match };
}

/**
 * Buyer entries from the profile that name this tender's buyer.
 *
 * One-directional on purpose: the profile entry must appear as a whole word or
 * phrase inside the buyer's name (so "Bærum kommune" matches "Bærum kommune,
 * Eiendom"), but a longer profile entry does not match a shorter buyer name.
 * The loose direction would turn a `buyerExclude` entry such as "Oslo" into a
 * filter that removes every buyer whose name is a prefix of it.
 *
 * An entry that is all digits is compared against the organisation number
 * instead, which is the unambiguous way to name a Norwegian public body.
 */
export function findBuyerMatches(tender: Tender, entries: readonly string[]): string[] {
  const organizationNumber = digitsOnly(tender.buyerOrganizationNumber ?? '');

  return sortedUnique(
    entries.filter((entry) => {
      const asDigits = digitsOnly(entry);
      if (asDigits.length > 0 && asDigits === entry.replace(/\s/g, '')) {
        return organizationNumber.length > 0 && organizationNumber === asDigits;
      }
      return nameContains(tender.buyerName, entry);
    }),
  );
}

export interface NumericRange {
  readonly min: number;
  readonly max: number;
}

/** The only currency the profile's thresholds are expressed in. */
const PROFILE_CURRENCY = 'NOK';

/**
 * True when the tender's stated value can be compared against a NOK profile
 * window at all.
 *
 * Doffin returns a currency alongside the amount and it is not always NOK —
 * PLN occurs in real data — and the API supplies no exchange rate. Comparing
 * 400 000 PLN against a 400 000 NOK ceiling as if they were the same number
 * would be wrong in both directions: it would drop tenders the user wants and
 * admit ones they do not. With no rate available the only honest options are
 * to convert or to abstain, and this package does not do I/O, so it abstains:
 * no points, and no exclusion either.
 */
export function valueIsComparable(tender: Tender): boolean {
  return tender.currency === undefined || tender.currency.toUpperCase() === PROFILE_CURRENCY;
}

/**
 * The tender's stated value as a closed interval, or `null` when the notice
 * says nothing about value or states it in another currency.
 *
 * Doffin's `estimatedValue` is a single scalar and is null in 53% of notices,
 * so the common case by a wide margin is `null` here, and a single figure
 * arriving as an equal min and max is the normal shape of the other 47%.
 */
export function tenderValueRange(tender: Tender): NumericRange | null {
  if (!valueIsComparable(tender)) return null;

  const min = tender.estimatedValueMinNok;
  const max = tender.estimatedValueMaxNok;
  if (min === undefined && max === undefined) return null;
  const low = min ?? max ?? 0;
  const high = max ?? min ?? 0;
  return low <= high ? { min: low, max: high } : { min: high, max: low };
}

/**
 * The profile's value window, or `null` when the user set no bound. An open
 * end becomes 0 or `Infinity`, which keeps the overlap test uniform.
 */
export function profileValueRange(profile: AlertProfile): NumericRange | null {
  const min = profile.estimatedValueMinNok;
  const max = profile.estimatedValueMaxNok;
  if (min === undefined && max === undefined) return null;
  return { min: min ?? 0, max: max ?? Number.POSITIVE_INFINITY };
}

export function rangesOverlap(a: NumericRange, b: NumericRange): boolean {
  return a.min <= b.max && b.min <= a.max;
}

/** True when `inner` sits entirely inside `outer`. */
export function rangeContains(outer: NumericRange, inner: NumericRange): boolean {
  return inner.min >= outer.min && inner.max <= outer.max;
}

/** `1 000 000–2 000 000` style bounds for evidence, as raw numbers. */
export function describeRange(range: NumericRange): { low: number; high: number | null } {
  return { low: range.min, high: Number.isFinite(range.max) ? range.max : null };
}
