'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Badge,
  Button,
  Chip,
  chipClassName,
  Disclosure,
  RemovableChip,
  Stack,
  StrengthBar,
  Toggle,
  ToggleChip,
} from '@luma/ui';
import { cpvLabel, cpvSearchEmptyMessage, searchCpvEntries } from '@luma/domain';
import { describeDeadline } from '@/server/format';
import {
  applyFilters,
  countActiveFilters,
  DEADLINE_BAND_LABEL_NB,
  DEADLINE_BANDS,
  defaultsFor,
  describeActiveFilters,
  describeCountLine,
  describeExpiredDeadline,
  describeExpiredGroup,
  describeFilterButton,
  EXPIRED_GROUP_NOTE_NB,
  groupResults,
  NATIONWIDE_MARKER_NB,
  PLANNED_GROUP_HEADING_NB,
  PLANNED_GROUP_NOTE_NB,
  RELEVANCE_LEVEL_LABEL_NB,
  VALUE_BAND_LABEL_NB,
  VALUE_BANDS,
  type ExplorerTender,
  type FilterState,
} from './results-filter';

/**
 * The A3 results explorer.
 *
 * ## One list, with nationwide notices merged into it
 *
 * This component used to render two lists: the landsdel's own notices, then a
 * «Gjelder hele landet» section beneath them. That split was defended on SEO
 * grounds — `it-tjenester-og-konsulentbistand` shares 144 nationwide notices
 * across all six of its landsdel pages, against 20–128 regional ones, so a
 * merged list makes those six pages 53–88% identical.
 *
 * **The defence did not survive re-reading `docs/search-surface-density.md`.**
 * The overlap is a fact about which notices are on the page, and two headings
 * do not remove a notice from a page — they label it. Six pages sharing 144
 * notices are six pages sharing 144 notices whether or not a `<h2>` says so;
 * a crawler comparing them sees the same text either way.
 *
 * What actually fixed the duplication was the 2026-08-10 re-measurement, which
 * changed the *threshold*: nationwide notices stopped counting towards whether
 * a page exists, so a pair now needs eight notices of its own. That cut 17
 * near-duplicate pages, and it lives in `qualifying-pages.ts`. The document
 * says so itself — «they no longer justify a page existing». With the page
 * list carrying the argument, the section split was only costing the reader,
 * who had to look in two places to find the competition closing first.
 *
 * So: one list, ordered by deadline (R5), with each nationwide notice carrying
 * `NATIONWIDE_MARKER_NB` on its own card. The reader gets one ordering; the
 * index gets its distinctness from the page list, where it belongs.
 *
 * ## Three groups, and only one of them is the main list
 *
 * R4 and R5: open competitions first, nearest deadline first; then planned
 * procurements under their own heading; then expired competitions in a group
 * that is collapsed by default. `groupResults` in `results-filter.ts` does the
 * partitioning against the render clock — see the note there on why it is not
 * done in the query.
 *
 * ## Why the whole list is rendered before any filtering exists
 *
 * The page is statically prerendered, so the markup a browser receives already
 * contains every notice, every section heading, the region links and the signup
 * form. Filtering is an *enhancement* layered on top once React hydrates —
 * `hydrated` below stays false through the server render and the first client
 * render, so the search box, the filter panel and the per-card expanders are
 * absent from the prerendered HTML rather than present and inert. A reader
 * without JavaScript gets a complete, working page; they simply do not get
 * controls that could not have done anything for them.
 *
 * The same flag is why each card's reasons render *open* before hydration, and
 * why the expired group renders open too: the evidence is the point of the
 * card, and a collapsed panel with no working toggle would hide it for good.
 *
 * ## No score, ever
 *
 * Spec 4.3. `StrengthBar` renders three fixed widths keyed to a word and no
 * number passes through it. `RELEVANCE_LEVEL_LABEL_NB` is two words. Nothing
 * here computes a percentage to hand either of them, and `CpvSearchHit.score`
 * is deliberately not read by this file.
 */

const LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/deed.no';

/** Days left at which a deadline is drawn in the danger colour. */
const URGENT_DAYS = 7;

/**
 * Below this the filters move into a bottom sheet (design A3, mobile 390).
 *
 * One pixel under Tailwind's `sm`, so the CSS breakpoint and this one cannot
 * disagree about which layout is in force.
 */
const NARROW_QUERY = '(max-width: 639px)';

export const SCORE_DISCLAIMER_NB =
  'Treffnivå er relevans mot bransjemalen, aldri sannsynlighet for å vinne.';

export interface RegionLink {
  readonly name: string;
  readonly href: string;
  /** The landsdel currently being viewed, if this link is it. */
  readonly current: boolean;
}

export interface ResultsExplorerProps {
  readonly templateName: string;
  /** Set on a landsdel page; absent on the national one. */
  readonly landsdelName?: string;
  readonly regional: readonly ExplorerTender[];
  /**
   * Notices that apply to the whole country.
   *
   * Still a separate prop, because `searchPublicTenders` still returns two
   * lists and each is limited separately. They are merged into one ordered list
   * here — see the note above — and each carries a marker on its card.
   */
  readonly nationwide: readonly ExplorerTender[];
  /** The template's CPV codes — the filter's starting point. */
  readonly templateCpv: readonly string[];
  /** The template's keywords, offered as suggestions rather than applied. */
  readonly templateKeywords: readonly string[];
  readonly regions: readonly RegionLink[];
  /**
   * The template's `onboardingHint` — which filter to reach for first.
   *
   * Setup advice rather than a description of the trade («Sett geografi og
   * terskelverdier først – de avgjør mest for en entreprenør…»), so it belongs
   * above the filters and nowhere else. `null` when a template created in admin
   * has none, and then nothing renders: the seeds' advice is specific to the
   * trade, and a generic stand-in would be worse than silence.
   */
  readonly onboardingHint: string | null;
  /**
   * The render clock, as ISO-8601.
   *
   * Taken from the server render rather than `new Date()` so the client's first
   * paint is byte-identical to the prerendered markup. The page revalidates
   * hourly, so it is at most an hour old, which is well inside the resolution
   * of a filter that counts whole days.
   */
  readonly nowIso: string;
  /** The signup card, rendered on the server and slotted into the rail. */
  readonly rail: ReactNode;
}

/**
 * True on a narrow viewport, and false until the browser says otherwise.
 *
 * Starts false so the server render and the first client render agree; the
 * controls it governs are behind `hydrated` anyway, so there is no flash of the
 * wrong layout to avoid — only a hydration mismatch to prevent.
 */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return narrow;
}

function CountyLine({ tender }: { tender: ExplorerTender }) {
  // A nationwide notice has no counties, so the marker takes the place the
  // county names would have had rather than being added beside them.
  const suffix = tender.nationwide
    ? ` · ${NATIONWIDE_MARKER_NB}`
    : tender.counties.length > 0
      ? ` · ${tender.counties.join(', ')}`
      : '';

  return (
    <p className="m-0 text-sm font-medium text-text-muted">
      {tender.buyerName}
      {suffix}
    </p>
  );
}

function DeadlineLine({
  tender,
  now,
  expired,
}: {
  tender: ExplorerTender;
  now: Date;
  expired: boolean;
}) {
  // An expired competition is never counted down to. «Frist gikk ut 30. juli
  // 2026» is the whole story; «−11 dager igjen» would be arithmetic.
  if (expired) {
    return (
      <p className="m-0 text-sm font-semibold text-text-muted">
        {describeExpiredDeadline(tender.deadlineAt)}
      </p>
    );
  }

  const deadlineAt = tender.deadlineAt ? new Date(tender.deadlineAt) : null;
  const display = describeDeadline({
    deadlineAt: deadlineAt && !Number.isNaN(deadlineAt.getTime()) ? deadlineAt : null,
    isPlanned: tender.planned,
    now,
  });

  const urgent =
    display.kind === 'date' && display.daysLeft >= 0 && display.daysLeft <= URGENT_DAYS;

  return (
    <p className={`m-0 text-sm font-semibold ${urgent ? 'text-danger' : 'text-text-muted'}`}>
      {display.kind === 'date' ? `Frist ${display.text}` : display.text}
    </p>
  );
}

function ReasonRows({ tender }: { tender: ExplorerTender }) {
  return (
    <div className="flex flex-col gap-sm">
      {tender.reasons.map((reason) => (
        <StrengthBar
          key={`${tender.id}-${reason.label}`}
          label={reason.label}
          level={reason.strength}
          evidence={reason.evidence}
        />
      ))}
      <p className="m-0 text-sm text-text-muted">{SCORE_DISCLAIMER_NB}</p>
    </div>
  );
}

function TenderCard({
  tender,
  now,
  hydrated,
  open,
  onToggle,
  expired = false,
}: {
  tender: ExplorerTender;
  now: Date;
  hydrated: boolean;
  open: boolean;
  onToggle: (next: boolean) => void;
  /** Renders the card muted, in the collapsed «avsluttede» group (R4). */
  expired?: boolean;
}) {
  const chips = [
    ...tender.cpvCodes.map((code) => ({ key: `cpv-${code}`, text: cpvLabel(code) })),
    ...tender.matchedKeywords.map((word) => ({ key: `kw-${word}`, text: `«${word}»` })),
  ];

  return (
    <li className={`luma-card flex flex-col gap-sm${expired ? ' opacity-70' : ''}`}>
      {tender.planned || tender.level ? (
        <p className="m-0 flex flex-wrap items-center gap-xs">
          {tender.planned ? (
            // Never a fabricated deadline. A planned procurement has none, and
            // saying so is the point of the category (ADR-13).
            <Badge variant="planlagt">Planlagt anskaffelse</Badge>
          ) : null}
          {tender.level ? (
            // Three words, no number, no meter. Spec 4.3.
            <Badge variant="treff">{RELEVANCE_LEVEL_LABEL_NB[tender.level]}</Badge>
          ) : null}
        </p>
      ) : null}
      <h3 className="m-0 text-lg font-semibold">{tender.title}</h3>
      <CountyLine tender={tender} />
      <DeadlineLine tender={tender} now={now} expired={expired} />

      {chips.length > 0 ? (
        <p className="m-0 flex flex-wrap gap-xs">
          {chips.map((chip) => (
            <Chip key={chip.key} tone="soft">
              {chip.text}
            </Chip>
          ))}
        </p>
      ) : null}

      {tender.reasons.length === 0 ? null : hydrated ? (
        <Disclosure
          id={`hvorfor-${tender.id}`}
          summary="Hvorfor traff dette?"
          open={open}
          onToggle={onToggle}
          tone="card"
        >
          <ReasonRows tender={tender} />
        </Disclosure>
      ) : (
        <section aria-label="Hvorfor traff dette?" className="flex flex-col gap-xs">
          <h4 className="m-0 text-sm font-semibold">Hvorfor traff dette?</h4>
          <ReasonRows tender={tender} />
        </section>
      )}
    </li>
  );
}

/** One `<ul>` of cards. Extracted because three groups render the same list. */
function TenderList({
  tenders,
  now,
  hydrated,
  openIds,
  onToggle,
  expired = false,
}: {
  tenders: readonly ExplorerTender[];
  now: Date;
  hydrated: boolean;
  openIds: readonly string[];
  onToggle: (id: string, next: boolean) => void;
  expired?: boolean;
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-sm p-0">
      {tenders.map((tender) => (
        <TenderCard
          key={tender.id}
          tender={tender}
          now={now}
          hydrated={hydrated}
          expired={expired}
          open={openIds.includes(tender.id)}
          onToggle={(next) => onToggle(tender.id, next)}
        />
      ))}
    </ul>
  );
}

interface FilterFieldsProps {
  readonly state: FilterState;
  readonly setState: React.Dispatch<React.SetStateAction<FilterState>>;
  readonly templateKeywords: readonly string[];
  readonly onReset: () => void;
  /** Whether anything differs from the template; governs the reset button. */
  readonly changed: boolean;
}

/**
 * Every filter except the free-text box, which stays inline on both layouts.
 *
 * Rendered **once**: the desktop disclosure and the mobile sheet are two
 * mountings of the same element, chosen by `useNarrowViewport`, never both at
 * the same time. Rendering both and hiding one with CSS would put two elements
 * with the same `id` and the same accessible name in the document, which is a
 * bug for a screen reader and for every test that looks a control up by name.
 *
 * ## No buyer-type control, deliberately
 *
 * Design A3 draws an «Oppdragsgiver» multi-select — kommune, fylkeskommune, HF.
 * It is not built, and it is not an omission to fix later. `tenders` carries a
 * buyer *name* and an organisation number and nothing else, so the categories
 * could only be produced by pattern-matching the name — «…kommune» is a
 * kommune — which would silently mislabel every interkommunalt selskap,
 * kommunalt foretak and municipal AS in the corpus. `profiles.ts` states that a
 * buyer-side column must never exist, so there is no honest source to read.
 */
function FilterFields({ state, setState, templateKeywords, onReset, changed }: FilterFieldsProps) {
  const [cpvPickerOpen, setCpvPickerOpen] = useState(false);
  const [cpvQuery, setCpvQuery] = useState('');
  const [keywordDraft, setKeywordDraft] = useState('');

  const trimmedCpvQuery = cpvQuery.trim();
  const cpvHits = trimmedCpvQuery.length > 0 ? searchCpvEntries(trimmedCpvQuery) : [];
  const suggestions = templateKeywords.filter((word) => !state.keywords.includes(word));

  function addKeyword(raw: string) {
    const value = raw.trim().toLocaleLowerCase('nb-NO');
    setKeywordDraft('');
    if (value.length === 0 || state.keywords.includes(value)) return;
    setState((current) => ({ ...current, keywords: [...current.keywords, value] }));
  }

  return (
    <div className="flex flex-col gap-lg">
      <section aria-labelledby="filter-cpv" className="flex flex-col gap-xs">
        <h3 id="filter-cpv" className="m-0 text-sm font-semibold">
          CPV-koder
        </h3>
        <div className="flex flex-wrap items-center gap-xs">
          {state.cpvCodes.map((code) => (
            <RemovableChip
              key={code}
              label={cpvLabel(code)}
              onRemove={() =>
                setState((c) => ({
                  ...c,
                  cpvCodes: c.cpvCodes.filter((value) => value !== code),
                }))
              }
            />
          ))}
          <ToggleChip
            selected={cpvPickerOpen}
            onClick={() => {
              setCpvPickerOpen((open) => !open);
              setCpvQuery('');
            }}
          >
            {cpvPickerOpen ? 'Lukk søk' : '+ Finn CPV-kode'}
          </ToggleChip>
        </div>

        {cpvPickerOpen ? (
          <div className="flex max-w-[40rem] flex-col gap-sm rounded-lg border border-line p-md">
            <label htmlFor="cpv-sok" className="text-sm font-semibold">
              Søk etter kategori
            </label>
            <input
              id="cpv-sok"
              type="search"
              value={cpvQuery}
              onChange={(event) => setCpvQuery(event.target.value)}
              placeholder="Søk på det du leverer, for eksempel «vask av vinduer»"
              className="luma-input"
            />
            <p className="m-0 text-sm text-text-muted">
              Søk med egne ord. Kodene er Doffins inndeling, ikke noe du trenger å kunne.
            </p>
            {/* `searchCpvEntries` is the ranked search from R7. Its scores are
                never read here — a number beside a category would be a
                relevance score in all but name (spec 4.3). */}
            <ul className="m-0 flex list-none flex-col gap-xs p-0">
              {cpvHits.map((entry) => {
                const already = state.cpvCodes.includes(entry.code);
                return (
                  <li key={entry.code}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() =>
                        setState((c) => ({ ...c, cpvCodes: [...c.cpvCodes, entry.code] }))
                      }
                      className="flex w-full items-center justify-between gap-sm rounded-md border border-line bg-surface-raised p-sm text-left"
                    >
                      <span className="flex flex-col gap-2xs">
                        <span className="font-semibold">
                          {entry.name} <span className="text-text-muted">{entry.code}</span>
                        </span>
                        <span className="text-sm text-text-muted">{entry.about}</span>
                        <span className="text-sm text-text-muted">{entry.group}</span>
                      </span>
                      <span className="text-sm font-semibold text-primary">
                        {already ? 'Lagt til' : 'Legg til'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {trimmedCpvQuery.length > 0 && cpvHits.length === 0 ? (
              <p className="m-0 text-sm text-text-muted">
                {cpvSearchEmptyMessage(trimmedCpvQuery)}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="filter-sokeord" className="flex flex-col gap-xs">
        <h3 id="filter-sokeord" className="m-0 text-sm font-semibold">
          Søkeord
        </h3>
        <p className="m-0 text-sm text-text-muted">
          Bransjemalen leter på CPV-kodene over. Legg til ord for å lete i titlene i tillegg.
        </p>
        <div className="flex flex-wrap items-center gap-xs">
          {state.keywords.map((word) => (
            <RemovableChip
              key={word}
              label={word}
              onRemove={() =>
                setState((c) => ({
                  ...c,
                  keywords: c.keywords.filter((value) => value !== word),
                }))
              }
            />
          ))}
          <input
            aria-label="Legg til søkeord"
            value={keywordDraft}
            onChange={(event) => setKeywordDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              addKeyword(keywordDraft);
            }}
            placeholder="Legg til søkeord, trykk enter"
            className="luma-input max-w-[16rem]"
          />
        </div>
        {suggestions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-xs">
            <span className="text-sm text-text-muted">Fra bransjemalen:</span>
            {suggestions.map((word) => (
              <ToggleChip key={word} selected={false} onClick={() => addKeyword(word)}>
                {word}
              </ToggleChip>
            ))}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="filter-verdi" className="flex flex-col gap-xs">
        <h3 id="filter-verdi" className="m-0 text-sm font-semibold">
          Minste verdi
        </h3>
        <div className="flex flex-wrap gap-xs">
          {VALUE_BANDS.map((band) => (
            <ToggleChip
              key={band}
              selected={state.valueBand === band}
              onClick={() => setState((c) => ({ ...c, valueBand: band }))}
            >
              {VALUE_BAND_LABEL_NB[band]}
            </ToggleChip>
          ))}
        </div>
        <p className="m-0 text-sm text-text-muted">
          Omtrent halvparten av kunngjøringene oppgir ingen verdi. De faller ut når du velger en
          grense, framfor å bli talt som null.
        </p>
      </section>

      <section aria-labelledby="filter-frist" className="flex flex-col gap-xs">
        <h3 id="filter-frist" className="m-0 text-sm font-semibold">
          Frist
        </h3>
        <div className="flex flex-wrap gap-xs">
          {DEADLINE_BANDS.map((band) => (
            <ToggleChip
              key={band}
              selected={state.deadlineBand === band}
              onClick={() => setState((c) => ({ ...c, deadlineBand: band }))}
            >
              {DEADLINE_BAND_LABEL_NB[band]}
            </ToggleChip>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-sm">
        <Toggle
          id="ta-med-planlagte"
          checked={state.includePlanned}
          onChange={(next) => setState((c) => ({ ...c, includePlanned: next }))}
          label="Ta med planlagte anskaffelser"
        />
        {/* Visible only once something differs from the template: a reset
            button on an untouched page offers to undo nothing. */}
        {changed ? (
          <Button type="button" variant="ghost" onClick={onReset}>
            Tilbakestill til bransjemalen
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ResultsExplorer({
  templateName,
  landsdelName,
  regional,
  nationwide,
  templateCpv,
  templateKeywords,
  regions,
  onboardingHint,
  nowIso,
  rail,
}: ResultsExplorerProps) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const defaults = useMemo(() => defaultsFor({ cpvInclude: templateCpv }), [templateCpv]);

  const [state, setState] = useState<FilterState>(defaults);
  const [hydrated, setHydrated] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expiredOpen, setExpiredOpen] = useState(false);
  const [openTenderIds, setOpenTenderIds] = useState<readonly string[]>([]);

  const narrow = useNarrowViewport();

  // Runs only in the browser, so the server render and the first client render
  // agree. See the module note on progressive enhancement.
  useEffect(() => setHydrated(true), []);

  // A sheet that cannot be dismissed from the keyboard is a trap. It is also
  // the only fixed element the page ever has, so nothing else needs closing.
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheetOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  // The layout changed out from under an open sheet. Close it rather than
  // leaving a fixed panel pinned over a desktop page.
  useEffect(() => {
    if (!narrow) setSheetOpen(false);
  }, [narrow]);

  /**
   * The one list (R5).
   *
   * `nationwide: true` is stamped on here rather than sent from the server:
   * the pages already tell us which array a notice came from, and repeating it
   * as a field on every row would be two sources for one fact.
   *
   * Under 200 notices, so this filters in the browser on every keystroke and no
   * request is made. `PUBLIC_RESULT_LIMIT` is 30 per array in
   * `public-search.ts`, giving at most 60 rows on any page today.
   */
  const all = useMemo(
    () => [...regional, ...nationwide.map((tender) => ({ ...tender, nationwide: true }))],
    [regional, nationwide],
  );

  const groups = useMemo(() => groupResults(applyFilters(all, state, now), now), [all, state, now]);

  const changes = countActiveFilters(state, defaults);
  const summary = describeActiveFilters(state, defaults);
  const countLine = describeCountLine({
    open: groups.open.length,
    planned: groups.planned.length,
    summary,
  });
  const nothingShown = groups.open.length + groups.planned.length + groups.expired.length === 0;

  function reset() {
    setState(defaults);
  }

  function toggleTender(id: string, next: boolean) {
    setOpenTenderIds((ids) => (next ? [...ids, id] : ids.filter((value) => value !== id)));
  }

  const fields = (
    <FilterFields
      state={state}
      setState={setState}
      templateKeywords={templateKeywords}
      onReset={reset}
      changed={changes > 0}
    />
  );

  return (
    <div className="flex flex-col gap-lg">
      {regions.length > 0 ? (
        <nav aria-label="Velg landsdel">
          {/* Real links, not filter buttons. `/anbud-for/{slug}/{landsdel}`
              routes exist for every entry here (`landsdelerFor`), they are
              statically generated, and they are what a search engine follows —
              a client-side region filter would make six indexable pages
              unreachable to anything that does not run JavaScript. */}
          <ul className="m-0 flex list-none flex-wrap gap-xs p-0">
            {regions.map((region) => (
              <li key={region.href}>
                <Link
                  href={region.href}
                  aria-current={region.current ? 'page' : undefined}
                  className={chipClassName({ selected: region.current })}
                >
                  {region.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {/* Outside the hydration gate on purpose: the advice leads with geography,
          and the landsdel links above are geography — they work with no script
          at all. Nothing renders when the template has no hint. */}
      {onboardingHint ? <p className="m-0 prose-measure">{onboardingHint}</p> : null}

      {hydrated ? (
        <div className="luma-card">
          <Stack gap="md">
            <div className="flex flex-wrap items-end gap-sm">
              <div className="flex min-w-[16rem] flex-1 flex-col gap-2xs">
                <label htmlFor="resultat-sok" className="text-sm font-semibold">
                  Søk i tittel eller oppdragsgiver
                </label>
                <input
                  id="resultat-sok"
                  type="search"
                  value={state.query}
                  onChange={(event) => setState((c) => ({ ...c, query: event.target.value }))}
                  placeholder="For eksempel «skole» eller «Bergen kommune»"
                  className="luma-input"
                />
              </div>
              {/* No «Bruk filtre» button anywhere: every control writes state
                  directly and the list re-renders on the keystroke. */}
              {narrow ? (
                <Button type="button" variant="secondary" onClick={() => setSheetOpen(true)}>
                  {describeFilterButton(changes)}
                </Button>
              ) : null}
            </div>

            <p className="m-0 text-sm text-text-muted">
              Kriteriene er fylt ut fra bransjemalen for {templateName.toLowerCase()}. Du kan endre
              alt, og listen oppdateres mens du skriver.
            </p>

            {narrow ? null : (
              <Disclosure
                id="avanserte-filtre"
                summary="Avanserte filtre"
                open={advancedOpen}
                onToggle={setAdvancedOpen}
              >
                {fields}
              </Disclosure>
            )}
          </Stack>
        </div>
      ) : null}

      {/* The bottom sheet. The signup rail is `position: static` below 900px
          (`globals.css`), so this is the only fixed element the page has — the
          «one fixed element at a time» rule holds by construction rather than
          by coordination. */}
      {hydrated && narrow && sheetOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="filtersheet-tittel"
          className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-md shadow-lg"
        >
          <div className="mb-md flex items-center justify-between gap-sm">
            <h2 id="filtersheet-tittel" className="m-0 text-lg font-semibold">
              {describeFilterButton(changes)}
            </h2>
            <Button type="button" variant="ghost" onClick={() => setSheetOpen(false)}>
              Lukk
            </Button>
          </div>
          {fields}
          <p className="mt-md mb-0">
            <Button type="button" onClick={() => setSheetOpen(false)}>
              Vis {countLine}
            </Button>
          </p>
        </div>
      ) : null}

      <div className="funnel-grid">
        <div className="flex flex-col gap-lg">
          <p className="m-0 text-sm font-semibold text-text-muted" aria-live="polite">
            {countLine}
          </p>

          {nothingShown ? (
            <div className="luma-card">
              <Stack gap="sm">
                <p className="m-0">
                  Ingen åpne kunngjøringer{landsdelName ? ` i ${landsdelName}` : ''} akkurat nå
                  innen {templateName.toLowerCase()}.
                </p>
                <p className="m-0 text-sm text-text-muted">
                  Det kan være filtrene, eller at det er stille — konkurranser kunngjøres i rykk og
                  napp. Meld deg på, så sier vi ifra samme dag noe dukker opp.
                </p>
                {hydrated && changes > 0 ? (
                  <p className="m-0">
                    <Button type="button" variant="ghost" onClick={reset}>
                      Tilbakestill til bransjemalen
                    </Button>
                  </p>
                ) : null}
              </Stack>
            </div>
          ) : null}

          {groups.open.length > 0 ? (
            <section aria-labelledby="apne-treff" className="flex flex-col gap-sm">
              <h2 id="apne-treff" className="section-heading">
                {landsdelName ? `Kunngjøringer i ${landsdelName}` : 'Kunngjøringer'}
              </h2>
              <TenderList
                tenders={groups.open}
                now={now}
                hydrated={hydrated}
                openIds={openTenderIds}
                onToggle={toggleTender}
              />
            </section>
          ) : null}

          {groups.planned.length > 0 ? (
            <section aria-labelledby="planlagte-treff" className="flex flex-col gap-sm">
              <h2 id="planlagte-treff" className="section-heading">
                {PLANNED_GROUP_HEADING_NB}
              </h2>
              <p className="m-0 text-sm text-text-muted">{PLANNED_GROUP_NOTE_NB}</p>
              <TenderList
                tenders={groups.planned}
                now={now}
                hydrated={hydrated}
                openIds={openTenderIds}
                onToggle={toggleTender}
              />
            </section>
          ) : null}

          {groups.expired.length > 0 ? (
            <section aria-labelledby="avsluttede-treff" className="flex flex-col gap-sm">
              {hydrated ? (
                <Disclosure
                  id="avsluttede-treff"
                  summary={describeExpiredGroup(groups.expired.length)}
                  open={expiredOpen}
                  onToggle={setExpiredOpen}
                >
                  <div className="flex flex-col gap-sm">
                    <p className="m-0 text-sm text-text-muted">{EXPIRED_GROUP_NOTE_NB}</p>
                    <TenderList
                      tenders={groups.expired}
                      now={now}
                      hydrated={hydrated}
                      openIds={openTenderIds}
                      onToggle={toggleTender}
                      expired
                    />
                  </div>
                </Disclosure>
              ) : (
                <>
                  <h2 id="avsluttede-treff" className="section-heading">
                    {describeExpiredGroup(groups.expired.length)}
                  </h2>
                  <p className="m-0 text-sm text-text-muted">{EXPIRED_GROUP_NOTE_NB}</p>
                  <TenderList
                    tenders={groups.expired}
                    now={now}
                    hydrated={hydrated}
                    openIds={openTenderIds}
                    onToggle={toggleTender}
                    expired
                  />
                </>
              )}
            </section>
          ) : null}

          {/* Required by CC BY 4.0 on every surface that redistributes
              announcement data to someone who did not ask for it themselves
              (ADR-0018). Reads exactly `Data: Doffin/DFØ (CC BY 4.0)` as text,
              with the licence name carrying the link — the wording is fixed, so
              a test asserts the rendered text rather than this markup. */}
          <p className="m-0 text-sm text-text-muted">
            Data: Doffin/DFØ (<Link href={LICENCE_URL}>CC BY 4.0</Link>)
          </p>
        </div>

        <div className="sticky-rail">{rail}</div>
      </div>
    </div>
  );
}
