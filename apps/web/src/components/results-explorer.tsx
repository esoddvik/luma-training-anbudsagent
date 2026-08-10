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
import { cpvLabel, searchCpv } from '@luma/domain';
import { describeDeadline } from '@/server/format';
import {
  applyFilters,
  DEADLINE_BAND_LABEL_NB,
  DEADLINE_BANDS,
  defaultsFor,
  describeActiveFilters,
  describeResultCount,
  VALUE_BAND_LABEL_NB,
  VALUE_BANDS,
  type ExplorerTender,
  type FilterState,
} from './results-filter';

/**
 * The A3 results explorer.
 *
 * ## Two sections, never one merged list
 *
 * Carried across from `public-results.tsx`, which this component replaces, and
 * it is a measured decision rather than an aesthetic one: for
 * `it-tjenester-og-konsulentbistand`, 144 of its qualifying hits over 94 days
 * are nationwide notices that appear on *every* landsdel page, against 20–128
 * regional ones — so a merged list would make its six regional pages between
 * 53% and 88% identical. Six URLs differing mostly in their heading is
 * near-duplicate content aimed at a search engine. Splitting them keeps each
 * page's regional half genuinely its own while still showing the reader every
 * competition they can bid on. See `docs/search-surface-density.md`.
 *
 * ## Why the whole list is rendered before any filtering exists
 *
 * The page is statically prerendered, so the markup a browser receives already
 * contains every notice, both section headings, the region links and the signup
 * form. Filtering is an *enhancement* layered on top once React hydrates —
 * `hydrated` below stays false through the server render and the first client
 * render, so the search box, the advanced panel and the per-card expanders are
 * absent from the prerendered HTML rather than present and inert. A reader
 * without JavaScript gets a complete, working page; they simply do not get
 * controls that could not have done anything for them.
 *
 * The same flag is why each card's reasons render *open* before hydration: the
 * evidence is the point of the card, and a collapsed panel with no working
 * toggle would hide it for good.
 *
 * ## No score, ever
 *
 * Spec 4.3. `StrengthBar` renders three fixed widths keyed to a word and no
 * number passes through it. Nothing here computes a percentage to hand it.
 */

const LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/deed.no';

/** Days left at which a deadline is drawn in the danger colour. */
const URGENT_DAYS = 7;

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
  readonly nationwide: readonly ExplorerTender[];
  /** The template's CPV codes — the filter's starting point. */
  readonly templateCpv: readonly string[];
  /** The template's keywords, offered as suggestions rather than applied. */
  readonly templateKeywords: readonly string[];
  readonly regions: readonly RegionLink[];
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

function CountyLine({ tender }: { tender: ExplorerTender }) {
  const suffix = tender.counties.length > 0 ? ` · ${tender.counties.join(', ')}` : '';
  return (
    <p className="m-0 text-sm font-medium text-text-muted">
      {tender.buyerName}
      {suffix}
    </p>
  );
}

function DeadlineLine({ tender, now }: { tender: ExplorerTender; now: Date }) {
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
}: {
  tender: ExplorerTender;
  now: Date;
  hydrated: boolean;
  open: boolean;
  onToggle: (next: boolean) => void;
}) {
  const chips = [
    ...tender.cpvCodes.map((code) => ({ key: `cpv-${code}`, text: cpvLabel(code) })),
    ...tender.matchedKeywords.map((word) => ({ key: `kw-${word}`, text: `«${word}»` })),
  ];

  return (
    // `Stack` rather than `flex flex-col` on the card itself: `.luma-card` is an
    // unlayered rule from `@luma/ui`, and an unlayered `display: block` beats a
    // Tailwind utility in `@layer utilities` no matter what order they load in.
    <li className="luma-card">
      <Stack gap="sm">
        {tender.planned ? (
          // Never a fabricated deadline. A planned procurement has none, and
          // saying so is the point of the category (ADR-13).
          <p className="m-0">
            <Badge variant="planlagt">Planlagt anskaffelse</Badge>
          </p>
        ) : null}
        <h3 className="m-0 text-lg font-semibold">{tender.title}</h3>
        <CountyLine tender={tender} />
        <DeadlineLine tender={tender} now={now} />

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
      </Stack>
    </li>
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
  nowIso,
  rail,
}: ResultsExplorerProps) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const defaults = useMemo(() => defaultsFor({ cpvInclude: templateCpv }), [templateCpv]);

  const [state, setState] = useState<FilterState>(defaults);
  const [hydrated, setHydrated] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [cpvPickerOpen, setCpvPickerOpen] = useState(false);
  const [cpvQuery, setCpvQuery] = useState('');
  const [keywordDraft, setKeywordDraft] = useState('');
  const [openTenderIds, setOpenTenderIds] = useState<readonly string[]>([]);

  // Runs only in the browser, so the server render and the first client render
  // agree. See the module note on progressive enhancement.
  useEffect(() => setHydrated(true), []);

  const shownRegional = useMemo(() => applyFilters(regional, state, now), [regional, state, now]);
  const shownNationwide = useMemo(
    () => applyFilters(nationwide, state, now),
    [nationwide, state, now],
  );

  const total = shownRegional.length + shownNationwide.length;
  const summary = describeActiveFilters(state, defaults);
  const cpvHits = cpvQuery.trim().length > 0 ? searchCpv(cpvQuery, 6) : [];
  const suggestions = templateKeywords.filter((word) => !state.keywords.includes(word));

  function reset() {
    setState(defaults);
    setKeywordDraft('');
    setCpvQuery('');
  }

  function toggleTender(id: string, next: boolean) {
    setOpenTenderIds((ids) => (next ? [...ids, id] : ids.filter((value) => value !== id)));
  }

  function addKeyword(raw: string) {
    const value = raw.trim().toLocaleLowerCase('nb-NO');
    setKeywordDraft('');
    if (value.length === 0 || state.keywords.includes(value)) return;
    setState((current) => ({ ...current, keywords: [...current.keywords, value] }));
  }

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
            </div>

            <p className="m-0 text-sm text-text-muted">
              Kriteriene er fylt ut fra bransjemalen for {templateName.toLowerCase()}. Du kan endre
              alt, og listen oppdateres mens du skriver.
            </p>

            <Disclosure
              id="avanserte-filtre"
              summary="Avanserte filtre"
              open={advancedOpen}
              onToggle={setAdvancedOpen}
            >
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
                                    {entry.name}{' '}
                                    <span className="text-text-muted">{entry.code}</span>
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
                      {cpvQuery.trim().length > 0 && cpvHits.length === 0 ? (
                        <p className="m-0 text-sm text-text-muted">
                          Ingen kategori matcher «{cpvQuery.trim()}». Prøv et bredere ord —
                          «renhold» framfor «gulvbelegg». Du kan også bruke søkeord i stedet, de
                          leter i selve teksten.
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
                    Bransjemalen leter på CPV-kodene over. Legg til ord for å lete i titlene i
                    tillegg.
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
                    Omtrent halvparten av kunngjøringene oppgir ingen verdi. De faller ut når du
                    velger en grense, framfor å bli talt som null.
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
                  <Button type="button" variant="ghost" onClick={reset}>
                    Tilbakestill til bransjemalen
                  </Button>
                </div>
              </div>
            </Disclosure>
          </Stack>
        </div>
      ) : null}

      <div className="funnel-grid">
        <div className="flex flex-col gap-lg">
          <p className="m-0 text-sm font-semibold text-text-muted" aria-live="polite">
            {describeResultCount(total)} · {summary}
          </p>

          {total === 0 ? (
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
                {hydrated ? (
                  <p className="m-0">
                    <Button type="button" variant="ghost" onClick={reset}>
                      Tilbakestill til bransjemalen
                    </Button>
                  </p>
                ) : null}
              </Stack>
            </div>
          ) : null}

          {shownRegional.length > 0 ? (
            <section aria-labelledby="regionale-treff" className="flex flex-col gap-sm">
              <h2 id="regionale-treff" className="section-heading">
                {landsdelName ? `Kunngjøringer i ${landsdelName}` : 'Kunngjøringer'}
              </h2>
              <ul className="m-0 flex list-none flex-col gap-sm p-0">
                {shownRegional.map((tender) => (
                  <TenderCard
                    key={tender.id}
                    tender={tender}
                    now={now}
                    hydrated={hydrated}
                    open={openTenderIds.includes(tender.id)}
                    onToggle={(next) => toggleTender(tender.id, next)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {shownNationwide.length > 0 ? (
            <section aria-labelledby="nasjonale-treff" className="flex flex-col gap-sm">
              <h2 id="nasjonale-treff" className="section-heading">
                Gjelder hele landet
              </h2>
              <p className="m-0 text-sm text-text-muted">
                Disse konkurransene er ikke knyttet til én landsdel, så de er like aktuelle her som
                andre steder.
              </p>
              <ul className="m-0 flex list-none flex-col gap-sm p-0">
                {shownNationwide.map((tender) => (
                  <TenderCard
                    key={tender.id}
                    tender={tender}
                    now={now}
                    hydrated={hydrated}
                    open={openTenderIds.includes(tender.id)}
                    onToggle={(next) => toggleTender(tender.id, next)}
                  />
                ))}
              </ul>
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
