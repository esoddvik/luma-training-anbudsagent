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
 *
 * ## Grouping is here too, and not in the query
 *
 * R4 and R5 move expired competitions out of the main list and order what is
 * left. Both are done over the array the server already sent
 * (`groupResults` below) rather than by asking the database for three lists.
 * Two reasons, and only one of them is about ownership of `public-search.ts`:
 *
 * 1. The page is prerendered hourly. A notice whose deadline passes at 14:05
 *    would sit in the main list until the next revalidation if the split were
 *    baked into the query, because the split would have been decided at build
 *    time. Deciding it in the browser, against the render clock, means a
 *    deadline that has just passed is in the right place immediately.
 * 2. Every notice is in the markup either way. The reader without JavaScript
 *    still gets the whole set; grouping is presentation, and presentation is
 *    what a client component is for.
 */

import { formatDate } from '@/server/format';

export type ReasonStrength = 'sterk' | 'middels' | 'svak';

/**
 * How strongly a notice matches the trade template, as two words.
 *
 * **This is a mirror of `RelevanceLevel` in `@/server/public-match-reasons`,
 * declared here on purpose.** That module is a server module; importing a value
 * from it into this one would drag the server graph into the client bundle, and
 * importing only the type would leave the label map behind on the server where
 * the card cannot reach it. So the wire format is restated at the boundary it
 * crosses, and `results-filter.test.ts` asserts the two unions are assignable
 * to each other — a type-only check that costs nothing at runtime and goes red
 * the moment they drift.
 *
 * Slugs rather than display strings: a copy edit to the Norwegian must not
 * change what crosses the wire.
 *
 * **There used to be a third band, `lav`, and it was dropped after measuring.**
 * Over the prerendered HTML of three of the eight templates on 2026-08-10 —
 * renhold 4 høy / 9 middels, bygg 9 / 41, it-tjenester 19 / 45 — it rendered on
 * none of them. Reaching it needed a notice matching a broad CPV code alone
 * that also hit a description keyword, and R1's broad-code filter removes
 * almost every candidate first. The reasoning behind the removal, and what to
 * do instead if the bottom of `middels` ever fills up with weak matches, is on
 * `RelevanceLevel` in `@/server/public-match-reasons`.
 *
 * The five templates never measured — `radgivende-ingeniortjenester`,
 * `drift-og-vedlikehold-av-eiendom`, `vakthold-og-sikkerhet`,
 * `kantine-og-matservering`, `bemanning-og-rekruttering` — are why the removal
 * widens `middels` downwards rather than dropping the notices: two of them are
 * thin enough that their whole 90-day window escapes every limit, so their mix
 * could differ from the three that were counted.
 */
export type RelevanceLevel = 'hoy' | 'middels';

export const RELEVANCE_LEVEL_LABEL_NB: Readonly<Record<RelevanceLevel, string>> = {
  hoy: 'Høy relevans',
  middels: 'Middels relevans',
};

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
  /**
   * True when the notice applies to the whole country rather than a landsdel.
   *
   * Nationwide notices are in the *same* list as regional ones (R5) and carry
   * `NATIONWIDE_MARKER_NB` on the card instead of sitting in a section of their
   * own. See the note on `ResultsExplorer` for why the split was dropped.
   */
  readonly nationwide?: boolean;
  /** ISO-8601, or `null` when the notice carries no deadline. */
  readonly deadlineAt: string | null;
  /**
   * ISO-8601. When the notice was published.
   *
   * Used for one thing only: ordering planned procurements, which have no
   * deadline to order by. See `comparePlanned`.
   */
  readonly publishedAt?: string;
  /**
   * How strongly this notice matches the template, if the server computed it.
   *
   * Optional because the two sides landed in separate changes, not because it
   * is optional information — `buildPublicReasons` supplies it today and the
   * card renders `RELEVANCE_LEVEL_LABEL_NB[level]` when it is there. A notice
   * that arrives without one renders no level rather than a guessed one.
   */
  readonly level?: RelevanceLevel;
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

/* ── R4 and R5: which list a notice belongs in, and in what order ─────────── */

/** Parsed deadline, or `null` for absent *and* for unparseable. */
function deadlineOf(tender: ExplorerTender): Date | null {
  if (tender.deadlineAt === null || tender.deadlineAt === undefined) return null;
  const value = new Date(tender.deadlineAt);
  return Number.isNaN(value.getTime()) ? null : value;
}

/**
 * The competition is over: the deadline is in the past.
 *
 * A planned procurement is never expired, whatever its dates say. It has no bid
 * deadline at all (ADR-13), so «fristen har gått ut» would be a claim about a
 * field the notice does not have.
 *
 * A competition with no deadline at all is *not* expired either. The source
 * simply did not state one, and moving a live competition into a collapsed
 * «avsluttet» group on the strength of a missing field would hide it on a
 * guess. It stays in the main list, at the end.
 */
export function isExpired(tender: ExplorerTender, now: Date): boolean {
  if (tender.planned) return false;
  const deadline = deadlineOf(tender);
  return deadline !== null && deadline.getTime() < now.getTime();
}

/**
 * Open competitions, nearest deadline first (R5).
 *
 * A missing deadline sorts last rather than first: `null` is «not stated», and
 * an unstated deadline is not urgent. Ties break on the id so the order is
 * total — two notices closing the same minute must not swap places between
 * renders, or the list would shuffle under the reader's cursor as they type.
 */
export function compareByDeadline(a: ExplorerTender, b: ExplorerTender): number {
  const left = deadlineOf(a);
  const right = deadlineOf(b);
  if (left === null && right === null) return a.id.localeCompare(b.id);
  if (left === null) return 1;
  if (right === null) return -1;
  return left.getTime() - right.getTime() || a.id.localeCompare(b.id);
}

/**
 * Planned procurements, «by expected announcement where known» (R5).
 *
 * **It is never known.** `tenders` has no expected-announcement column —
 * `deadlineAt` is documented as null for planned procurements and Doffin's
 * planned notices carry no estimated announcement date through the ingest — so
 * the clause describes data this system does not have. Rather than leave the
 * group in whatever order the query returned, the fallback is the most recently
 * published plan first, which is the closest available proxy for «announcement
 * soonest» and is at least a fact about the notice.
 *
 * The `deadlineAt` branch stays because a planned notice occasionally does
 * carry one, and when it does it is better information than the publication
 * date. Those sort first, ascending.
 */
export function comparePlanned(a: ExplorerTender, b: ExplorerTender): number {
  const left = deadlineOf(a);
  const right = deadlineOf(b);
  if (left !== null && right !== null) return left.getTime() - right.getTime();
  if (left !== null) return -1;
  if (right !== null) return 1;

  const published = (tender: ExplorerTender) => {
    const value = tender.publishedAt ? new Date(tender.publishedAt) : null;
    return value && !Number.isNaN(value.getTime()) ? value.getTime() : Number.NEGATIVE_INFINITY;
  };
  return published(b) - published(a) || a.id.localeCompare(b.id);
}

/** Expired competitions, most recently closed first: the freshest market signal. */
export function compareExpired(a: ExplorerTender, b: ExplorerTender): number {
  const left = deadlineOf(a)?.getTime() ?? 0;
  const right = deadlineOf(b)?.getTime() ?? 0;
  return right - left || a.id.localeCompare(b.id);
}

export interface ResultGroups {
  /** The main list: open competitions, nearest deadline first. */
  readonly open: readonly ExplorerTender[];
  /** Planned procurements, under their own heading. */
  readonly planned: readonly ExplorerTender[];
  /** Deadline already past. Collapsed at the bottom (R4). */
  readonly expired: readonly ExplorerTender[];
}

/**
 * Split a filtered result set into the three lists the page renders, each
 * already in its own order (R4, R5).
 *
 * Takes the notices *after* filtering, so a reader who switches planned
 * procurements off empties that group rather than hiding a heading with a
 * populated list behind it.
 */
export function groupResults(tenders: readonly ExplorerTender[], now: Date): ResultGroups {
  const open: ExplorerTender[] = [];
  const planned: ExplorerTender[] = [];
  const expired: ExplorerTender[] = [];

  for (const tender of tenders) {
    if (tender.planned) planned.push(tender);
    else if (isExpired(tender, now)) expired.push(tender);
    else open.push(tender);
  }

  return {
    open: open.sort(compareByDeadline),
    planned: planned.sort(comparePlanned),
    expired: expired.sort(compareExpired),
  };
}

/** «Gjelder hele landet» — the marker that replaced the nationwide section. */
export const NATIONWIDE_MARKER_NB = 'Gjelder hele landet';

export const PLANNED_GROUP_HEADING_NB = 'Planlagte anskaffelser';

export const PLANNED_GROUP_NOTE_NB =
  'Disse er varslet, men ikke kunngjort ennå. De har ingen tilbudsfrist å forholde seg til.';

export const EXPIRED_GROUP_NOTE_NB =
  'Fristen har gått ut. De ligger her fordi de er nyttige når du kartlegger markedet.';

/** «Avsluttede konkurranser (9)». The count is part of the heading (R4). */
export function describeExpiredGroup(count: number): string {
  return `Avsluttede konkurranser (${count})`;
}

/** «Frist gikk ut 30. juli 2026». Past tense, and never a countdown. */
export function describeExpiredDeadline(deadlineAt: string | null): string {
  if (!deadlineAt) return 'Fristen har gått ut';
  const value = new Date(deadlineAt);
  if (Number.isNaN(value.getTime())) return 'Fristen har gått ut';
  return `Frist gikk ut ${formatDate(value)}`;
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
 *
 * Once something *has* been touched it counts **changes from the template**
 * rather than «filtre aktive» (R6). Every filter is active on arrival — the CPV
 * chips are doing the selecting — so «6 filtre aktive» on an untouched page
 * would have been true and useless. What the reader needs to know is how far
 * they have moved from the starting point, and that is the number the reset
 * button undoes.
 */
export function describeActiveFilters(state: FilterState, defaults: FilterState): string {
  const count = countActiveFilters(state, defaults);
  if (count === 0) return 'Bransjemalen';
  if (count === 1) return '1 endring fra malen';
  return `${count} endringer fra malen`;
}

/** «12 kunngjøringer», in the singular when there is one. */
export function describeResultCount(count: number): string {
  return count === 1 ? '1 kunngjøring' : `${count} kunngjøringer`;
}

/** «26 åpne kunngjøringer». Only the open ones — expired are not «åpne». */
export function describeOpenCount(count: number): string {
  return count === 1 ? '1 åpen kunngjøring' : `${count} åpne kunngjøringer`;
}

/**
 * The whole line above the list: «26 åpne kunngjøringer · 5 planlagte ·
 * Bransjemalen» (R4, R6).
 *
 * The planned segment disappears at zero rather than reading «0 planlagte»: a
 * segment that is always present teaches the reader to stop reading it, and the
 * absence of planned procurements is not news.
 *
 * Expired competitions are deliberately **not** counted here. Their own heading
 * carries the number (`describeExpiredGroup`), and adding them to a line that
 * begins «åpne» would contradict the word.
 */
export function describeCountLine(input: {
  readonly open: number;
  readonly planned: number;
  readonly summary: string;
}): string {
  const parts = [describeOpenCount(input.open)];
  if (input.planned > 0) {
    parts.push(input.planned === 1 ? '1 planlagt' : `${input.planned} planlagte`);
  }
  parts.push(input.summary);
  return parts.join(' · ');
}

/** The mobile trigger: «Filtre» until something differs, then «Filtre (2)». */
export function describeFilterButton(changes: number): string {
  return changes === 0 ? 'Filtre' : `Filtre (${changes})`;
}
