/**
 * The filtering rules behind the A3 results explorer.
 *
 * Pure on purpose. Every predicate below is a decision about what a reader is
 * shown, and a decision of that kind should be testable without a browser, a
 * database or a React tree — `results-filter.test.ts` exercises each one
 * directly. The component next door owns state and markup and nothing else.
 *
 * ## The shapes here are the wire format
 *
 * The pages are server components that prerender once an hour; the explorer is
 * a client component. Everything crossing that boundary has to be serialisable,
 * so dates travel as ISO strings and county codes are resolved to names on the
 * server. `ExplorerTender` is therefore a projection of `PublicTenderSummary`
 * rather than the thing itself.
 */

export type ReasonStrength = 'sterk' | 'middels' | 'svak';

export interface ExplorerReason {
  readonly label: string;
  readonly strength: ReasonStrength;
  readonly evidence: string;
}

export interface ExplorerTender {
  readonly id: string;
  readonly title: string;
  readonly buyerName: string;
  /** County names, already resolved. Empty for a nationwide notice. */
  readonly counties: readonly string[];
  readonly planned: boolean;
  /** ISO-8601, or `null` when the notice carries no deadline. */
  readonly deadlineAt: string | null;
  /**
   * Doffin's estimated value, or `null`.
   *
   * Absent about half the time, so the value band treats `null` as *unknown*
   * and never as zero — see `matchesValueBand`.
   */
  readonly estimatedValueMinNok: number | null;
  /** The notice's own CPV codes that the template asked for. Never empty. */
  readonly cpvCodes: readonly string[];
  readonly matchedKeywords: readonly string[];
  readonly reasons: readonly ExplorerReason[];
}

export type ValueBand = 'alle' | 'v500k' | 'v5m' | 'v20m';
export type DeadlineBand = 'alle' | 'd7' | 'd30';

export interface FilterState {
  readonly query: string;
  readonly cpvCodes: readonly string[];
  readonly keywords: readonly string[];
  readonly valueBand: ValueBand;
  readonly deadlineBand: DeadlineBand;
  readonly includePlanned: boolean;
}

/** Lower bound in kroner for each band. `alle` imposes none. */
const VALUE_BAND_MIN: Readonly<Record<ValueBand, number | null>> = {
  alle: null,
  v500k: 500_000,
  v5m: 5_000_000,
  v20m: 20_000_000,
};

export const VALUE_BAND_LABEL_NB: Readonly<Record<ValueBand, string>> = {
  alle: 'Alle',
  v500k: '500 000+',
  v5m: '5 mill+',
  v20m: '20 mill+',
};

const DEADLINE_BAND_DAYS: Readonly<Record<DeadlineBand, number | null>> = {
  alle: null,
  d7: 7,
  d30: 30,
};

export const DEADLINE_BAND_LABEL_NB: Readonly<Record<DeadlineBand, string>> = {
  alle: 'Alle',
  d7: 'Neste 7 dager',
  d30: 'Neste 30 dager',
};

export const VALUE_BANDS: readonly ValueBand[] = ['alle', 'v500k', 'v5m', 'v20m'];
export const DEADLINE_BANDS: readonly DeadlineBand[] = ['alle', 'd7', 'd30'];

/**
 * The state a page opens in: the trade template, unchanged.
 *
 * **`keywords` starts empty, and that is deliberate rather than an oversight.**
 * `searchPublicTenders` selects on CPV codes alone, so a notice on this page
 * has already qualified without any word being present in its title. Seeding
 * the filter with the template's keywords would therefore hide notices that
 * legitimately belong here — and, worse, the list a reader with JavaScript sees
 * would be shorter than the one the server rendered for a reader without it.
 * The template's words are still offered, as suggestions the reader can switch
 * on; they narrow only once asked to.
 */
export function defaultsFor(template: { readonly cpvInclude: readonly string[] }): FilterState {
  return {
    query: '',
    cpvCodes: [...template.cpvInclude],
    keywords: [],
    valueBand: 'alle',
    deadlineBand: 'alle',
    includePlanned: true,
  };
}

/** Case- and whitespace-insensitive. Norwegian locale so `Å` folds correctly. */
function fold(value: string): string {
  return value.trim().toLocaleLowerCase('nb-NO');
}

export function matchesQuery(tender: ExplorerTender, query: string): boolean {
  const needle = fold(query);
  if (needle.length === 0) return true;
  return fold(`${tender.title} ${tender.buyerName}`).includes(needle);
}

/**
 * At least one of the notice's codes is still selected.
 *
 * An empty selection imposes nothing rather than excluding everything: a reader
 * who removed every chip has asked to stop filtering on CPV, not to be shown a
 * blank page.
 */
export function matchesCpv(tender: ExplorerTender, codes: readonly string[]): boolean {
  if (codes.length === 0) return true;
  const wanted = new Set(codes);
  return tender.cpvCodes.some((code) => wanted.has(code));
}

/** A keyword is a word in the title or the buyer's name. Empty list = no filter. */
export function matchesKeywords(tender: ExplorerTender, keywords: readonly string[]): boolean {
  if (keywords.length === 0) return true;
  const haystack = fold(`${tender.title} ${tender.buyerName}`);
  return keywords.some((keyword) => {
    const needle = fold(keyword);
    return needle.length > 0 && haystack.includes(needle);
  });
}

/**
 * A value band excludes notices whose value is *unknown*.
 *
 * `estimatedValueMinNok` is null in roughly half the corpus. Treating null as
 * zero would silently drop those notices from every band, and treating it as
 * "passes anything" would put a notice of unknown size in a list the reader
 * asked to be «20 mill+». Neither is honest, so the rule is the explicit one:
 * choosing a band is choosing to see only notices that stated a value, and the
 * interface says so where the bands are drawn.
 */
export function matchesValueBand(tender: ExplorerTender, band: ValueBand): boolean {
  const min = VALUE_BAND_MIN[band];
  if (min === null) return true;
  if (tender.estimatedValueMinNok === null) return false;
  return tender.estimatedValueMinNok >= min;
}

/**
 * A deadline band never touches a planned procurement.
 *
 * A planlagt anskaffelse has no bid deadline at all (ADR-13) — that absence is
 * a fact about the notice, not a missing field — so filtering it on days-left
 * would answer a question it cannot be asked. `includePlanned` is the control
 * that governs those, and it is a separate one for exactly this reason.
 */
export function matchesDeadlineBand(
  tender: ExplorerTender,
  band: DeadlineBand,
  now: Date,
): boolean {
  const days = DEADLINE_BAND_DAYS[band];
  if (days === null) return true;
  if (tender.planned) return true;
  if (tender.deadlineAt === null) return false;

  const deadline = new Date(tender.deadlineAt);
  if (Number.isNaN(deadline.getTime())) return false;

  const left = Math.trunc((deadline.getTime() - now.getTime()) / 86_400_000);
  return left >= 0 && left <= days;
}

export function applyFilters(
  tenders: readonly ExplorerTender[],
  state: FilterState,
  now: Date,
): readonly ExplorerTender[] {
  return tenders.filter((tender) => {
    if (tender.planned && !state.includePlanned) return false;
    if (!matchesQuery(tender, state.query)) return false;
    if (!matchesCpv(tender, state.cpvCodes)) return false;
    if (!matchesKeywords(tender, state.keywords)) return false;
    if (!matchesValueBand(tender, state.valueBand)) return false;
    if (!matchesDeadlineBand(tender, state.deadlineBand, now)) return false;
    return true;
  });
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const other = new Set(b);
  return a.every((value) => other.has(value));
}

/** How far the reader has moved from the trade template. Order-insensitive. */
export function countActiveFilters(state: FilterState, defaults: FilterState): number {
  return (
    (state.query.trim().length > 0 ? 1 : 0) +
    (sameSet(state.cpvCodes, defaults.cpvCodes) ? 0 : 1) +
    (sameSet(state.keywords, defaults.keywords) ? 0 : 1) +
    (state.valueBand === defaults.valueBand ? 0 : 1) +
    (state.deadlineBand === defaults.deadlineBand ? 0 : 1) +
    (state.includePlanned === defaults.includePlanned ? 0 : 1)
  );
}

/**
 * The line beside the result count.
 *
 * Names the template rather than saying «ingen filtre» when nothing has been
 * touched: the reader did not arrive at an unfiltered list, they arrived at the
 * trade's list, and the words should not pretend otherwise.
 */
export function describeActiveFilters(state: FilterState, defaults: FilterState): string {
  const count = countActiveFilters(state, defaults);
  if (count === 0) return 'Bransjemalen';
  if (count === 1) return '1 filter aktivt';
  return `${count} filtre aktive`;
}

/** «12 kunngjøringer», in the singular when there is one. */
export function describeResultCount(count: number): string {
  return count === 1 ? '1 kunngjøring' : `${count} kunngjøringer`;
}
