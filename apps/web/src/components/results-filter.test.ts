import { describe, expect, it } from 'vitest';
import {
  applyFilters,
  compareByDeadline,
  countActiveFilters,
  defaultsFor,
  describeActiveFilters,
  describeCountLine,
  describeExpiredDeadline,
  describeExpiredGroup,
  describeFilterButton,
  describeResultCount,
  groupResults,
  isExpired,
  matchesCpv,
  matchesDeadlineBand,
  matchesKeywords,
  matchesQuery,
  matchesValueBand,
  RELEVANCE_LEVEL_LABEL_NB,
  type ExplorerTender,
  type FilterState,
  type RelevanceLevel,
} from './results-filter';
import type { RelevanceLevel as ServerRelevanceLevel } from '@/server/public-match-reasons';

const NOW = new Date('2026-08-10T09:00:00Z');

const TEMPLATE = { cpvInclude: ['90910000', '90911200'] } as const;

function tender(overrides: Partial<ExplorerTender> = {}): ExplorerTender {
  return {
    id: 't1',
    title: 'Renhold av kommunale bygg',
    buyerName: 'Bergen kommune',
    counties: ['Vestland'],
    planned: false,
    deadlineAt: '2026-08-20T10:00:00Z',
    estimatedValueMinNok: 1_000_000,
    cpvCodes: ['90910000'],
    matchedKeywords: ['renhold'],
    publishedAt: '2026-08-01T06:00:00Z',
    reasons: [],
    ...overrides,
  };
}

describe('defaultsFor', () => {
  it('carries the template CPV codes and leaves everything else unfiltered', () => {
    expect(defaultsFor(TEMPLATE)).toEqual({
      query: '',
      cpvCodes: ['90910000', '90911200'],
      keywords: [],
      valueBand: 'alle',
      deadlineBand: 'alle',
      includePlanned: true,
    });
  });

  it('starts with no keywords, so the default view matches the server-rendered list', () => {
    // The page's notices were selected on CPV alone. A keyword pre-filter would
    // hide notices that qualified without the word, and the filtered list would
    // then be shorter than the markup a reader without JavaScript is served.
    const all = [tender({ id: 'a', title: 'Vaktmestertjenester' }), tender({ id: 'b' })];
    expect(applyFilters(all, defaultsFor(TEMPLATE), NOW)).toHaveLength(2);
  });
});

describe('matchesQuery', () => {
  it('is empty-query permissive', () => {
    expect(matchesQuery(tender(), '   ')).toBe(true);
  });

  it('searches the title and the buyer, case-insensitively', () => {
    expect(matchesQuery(tender(), 'KOMMUNALE')).toBe(true);
    expect(matchesQuery(tender(), 'bergen')).toBe(true);
    expect(matchesQuery(tender(), 'vinduspuss')).toBe(false);
  });
});

describe('matchesCpv', () => {
  it('passes when one of the notice codes is still selected', () => {
    expect(matchesCpv(tender(), ['90910000', '90911200'])).toBe(true);
  });

  it('drops the notice once its only code is removed', () => {
    expect(matchesCpv(tender(), ['90911200'])).toBe(false);
  });

  it('imposes nothing when every chip has been removed', () => {
    expect(matchesCpv(tender(), [])).toBe(true);
  });
});

describe('matchesKeywords', () => {
  it('imposes nothing on an empty list', () => {
    expect(matchesKeywords(tender(), [])).toBe(true);
  });

  it('matches a word in the title or the buyer name', () => {
    expect(matchesKeywords(tender(), ['renhold'])).toBe(true);
    expect(matchesKeywords(tender(), ['bergen'])).toBe(true);
  });

  it('is an OR across the list', () => {
    expect(matchesKeywords(tender(), ['vinduspuss', 'renhold'])).toBe(true);
    expect(matchesKeywords(tender(), ['vinduspuss', 'kantine'])).toBe(false);
  });

  it('ignores a blank entry rather than matching everything on it', () => {
    expect(matchesKeywords(tender(), ['   '])).toBe(false);
  });
});

describe('matchesValueBand', () => {
  it('passes everything on «alle», including an unknown value', () => {
    expect(matchesValueBand(tender({ estimatedValueMinNok: null }), 'alle')).toBe(true);
  });

  it('excludes a notice whose value is unknown once a band is chosen', () => {
    // Never treated as zero: about half the corpus has no value at all, and a
    // silent zero would put every one of them below every threshold.
    expect(matchesValueBand(tender({ estimatedValueMinNok: null }), 'v500k')).toBe(false);
  });

  it('compares against the band minimum inclusively', () => {
    expect(matchesValueBand(tender({ estimatedValueMinNok: 500_000 }), 'v500k')).toBe(true);
    expect(matchesValueBand(tender({ estimatedValueMinNok: 499_999 }), 'v500k')).toBe(false);
    expect(matchesValueBand(tender({ estimatedValueMinNok: 6_000_000 }), 'v5m')).toBe(true);
    expect(matchesValueBand(tender({ estimatedValueMinNok: 6_000_000 }), 'v20m')).toBe(false);
  });
});

describe('matchesDeadlineBand', () => {
  it('passes everything on «alle»', () => {
    expect(matchesDeadlineBand(tender({ deadlineAt: null }), 'alle', NOW)).toBe(true);
  });

  it('keeps a planned procurement, which has no deadline to judge', () => {
    expect(matchesDeadlineBand(tender({ planned: true, deadlineAt: null }), 'd7', NOW)).toBe(true);
  });

  it('drops a competition with no stated deadline once a band is chosen', () => {
    expect(matchesDeadlineBand(tender({ deadlineAt: null }), 'd30', NOW)).toBe(false);
  });

  it('counts whole days forward and excludes deadlines already past', () => {
    expect(matchesDeadlineBand(tender({ deadlineAt: '2026-08-14T09:00:00Z' }), 'd7', NOW)).toBe(
      true,
    );
    expect(matchesDeadlineBand(tender({ deadlineAt: '2026-08-25T09:00:00Z' }), 'd7', NOW)).toBe(
      false,
    );
    expect(matchesDeadlineBand(tender({ deadlineAt: '2026-08-25T09:00:00Z' }), 'd30', NOW)).toBe(
      true,
    );
    expect(matchesDeadlineBand(tender({ deadlineAt: '2026-08-01T09:00:00Z' }), 'd30', NOW)).toBe(
      false,
    );
  });

  it('rejects an unparseable date rather than throwing inside render', () => {
    expect(matchesDeadlineBand(tender({ deadlineAt: 'i går' }), 'd7', NOW)).toBe(false);
  });
});

describe('applyFilters', () => {
  const pool: readonly ExplorerTender[] = [
    tender({ id: 'a', title: 'Renhold av skoler', estimatedValueMinNok: 300_000 }),
    tender({
      id: 'b',
      title: 'Vinduspuss i Bergen',
      buyerName: 'Vestland fylkeskommune',
      estimatedValueMinNok: 8_000_000,
      cpvCodes: ['90911200'],
    }),
    tender({
      id: 'c',
      title: 'Planlagt renholdsavtale',
      planned: true,
      deadlineAt: null,
      estimatedValueMinNok: null,
    }),
  ];

  it('returns everything on the defaults', () => {
    expect(applyFilters(pool, defaultsFor(TEMPLATE), NOW).map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('drops planned procurements when the switch is off', () => {
    const state: FilterState = { ...defaultsFor(TEMPLATE), includePlanned: false };
    expect(applyFilters(pool, state, NOW).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('combines predicates with AND', () => {
    const state: FilterState = {
      ...defaultsFor(TEMPLATE),
      query: 'bergen',
      valueBand: 'v5m',
    };
    expect(applyFilters(pool, state, NOW).map((t) => t.id)).toEqual(['b']);
  });

  it('narrows to nothing when the criteria cannot both hold', () => {
    const state: FilterState = { ...defaultsFor(TEMPLATE), query: 'vinduspuss', valueBand: 'v20m' };
    expect(applyFilters(pool, state, NOW)).toHaveLength(0);
  });
});

describe('describeActiveFilters', () => {
  const defaults = defaultsFor(TEMPLATE);

  it('names the template when nothing has been touched', () => {
    expect(describeActiveFilters(defaults, defaults)).toBe('Bransjemalen');
  });

  it('ignores CPV chip order, so a re-add reads as unchanged', () => {
    const reordered: FilterState = { ...defaults, cpvCodes: ['90911200', '90910000'] };
    expect(countActiveFilters(reordered, defaults)).toBe(0);
    expect(describeActiveFilters(reordered, defaults)).toBe('Bransjemalen');
  });

  it('ignores whitespace-only search input', () => {
    expect(describeActiveFilters({ ...defaults, query: '  ' }, defaults)).toBe('Bransjemalen');
  });

  it('counts one change in the singular', () => {
    expect(describeActiveFilters({ ...defaults, query: 'skole' }, defaults)).toBe(
      '1 endring fra malen',
    );
  });

  it('counts every axis independently', () => {
    const state: FilterState = {
      query: 'skole',
      cpvCodes: ['90910000'],
      keywords: ['renhold'],
      valueBand: 'v5m',
      deadlineBand: 'd7',
      includePlanned: false,
    };
    expect(countActiveFilters(state, defaults)).toBe(6);
    expect(describeActiveFilters(state, defaults)).toBe('6 endringer fra malen');
  });

  it('reads as reset once the defaults are restored', () => {
    const touched: FilterState = { ...defaults, valueBand: 'v20m', keywords: ['x'] };
    expect(countActiveFilters(touched, defaults)).toBe(2);
    expect(countActiveFilters({ ...touched, ...defaults }, defaults)).toBe(0);
  });
});

describe('describeResultCount', () => {
  it('is singular for one and plural otherwise', () => {
    expect(describeResultCount(0)).toBe('0 kunngjøringer');
    expect(describeResultCount(1)).toBe('1 kunngjøring');
    expect(describeResultCount(12)).toBe('12 kunngjøringer');
  });
});

describe('describeCountLine', () => {
  it('reads as the spec writes it', () => {
    expect(describeCountLine({ open: 26, planned: 5, summary: 'Bransjemalen' })).toBe(
      '26 åpne kunngjøringer · 5 planlagte · Bransjemalen',
    );
  });

  it('drops the planned segment rather than printing a zero', () => {
    expect(describeCountLine({ open: 3, planned: 0, summary: 'Bransjemalen' })).toBe(
      '3 åpne kunngjøringer · Bransjemalen',
    );
  });

  it('is singular on both counts', () => {
    expect(describeCountLine({ open: 1, planned: 1, summary: '1 endring fra malen' })).toBe(
      '1 åpen kunngjøring · 1 planlagt · 1 endring fra malen',
    );
  });

  it('carries no percentage, meter or score anywhere in it (V8)', () => {
    const line = describeCountLine({ open: 26, planned: 5, summary: '2 endringer fra malen' });
    expect(line).not.toMatch(/%/);
    expect(line).not.toMatch(/poeng|score|treffprosent/i);
  });
});

describe('describeFilterButton', () => {
  it('counts only what differs from the template', () => {
    expect(describeFilterButton(0)).toBe('Filtre');
    expect(describeFilterButton(2)).toBe('Filtre (2)');
  });
});

/* ── R4 and R5 ────────────────────────────────────────────────────────────── */

describe('isExpired', () => {
  it('is true only for a competition whose deadline is in the past', () => {
    expect(isExpired(tender({ deadlineAt: '2026-07-30T12:00:00Z' }), NOW)).toBe(true);
    expect(isExpired(tender({ deadlineAt: '2026-08-20T12:00:00Z' }), NOW)).toBe(false);
  });

  it('never expires a planned procurement, which has no deadline to miss', () => {
    expect(isExpired(tender({ planned: true, deadlineAt: null }), NOW)).toBe(false);
    // Even if one somehow carries a past date, «fristen gikk ut» is still a
    // claim about a field a planlagt anskaffelse does not have.
    expect(isExpired(tender({ planned: true, deadlineAt: '2026-01-01T12:00:00Z' }), NOW)).toBe(
      false,
    );
  });

  it('leaves a competition with no stated deadline in the main list', () => {
    // «Not stated» is not «past». Hiding a live competition in a collapsed
    // group on a missing field would be a guess with a consequence.
    expect(isExpired(tender({ deadlineAt: null }), NOW)).toBe(false);
    expect(isExpired(tender({ deadlineAt: 'i går' }), NOW)).toBe(false);
  });

  it('treats the deadline moment itself as still open', () => {
    expect(isExpired(tender({ deadlineAt: NOW.toISOString() }), NOW)).toBe(false);
  });
});

describe('compareByDeadline', () => {
  it('puts the nearest deadline first', () => {
    const soon = tender({ id: 'soon', deadlineAt: '2026-08-12T09:00:00Z' });
    const later = tender({ id: 'later', deadlineAt: '2026-09-12T09:00:00Z' });
    expect([later, soon].sort(compareByDeadline).map((t) => t.id)).toEqual(['soon', 'later']);
  });

  it('sorts an unstated deadline last rather than first', () => {
    const unknown = tender({ id: 'unknown', deadlineAt: null });
    const known = tender({ id: 'known', deadlineAt: '2026-09-12T09:00:00Z' });
    expect([unknown, known].sort(compareByDeadline).map((t) => t.id)).toEqual(['known', 'unknown']);
  });

  it('is a total order, so the list cannot shuffle between renders', () => {
    const a = tender({ id: 'a', deadlineAt: '2026-08-12T09:00:00Z' });
    const b = tender({ id: 'b', deadlineAt: '2026-08-12T09:00:00Z' });
    expect(compareByDeadline(a, b)).toBeLessThan(0);
    expect(compareByDeadline(b, a)).toBeGreaterThan(0);
  });
});

describe('groupResults', () => {
  const pool: readonly ExplorerTender[] = [
    tender({ id: 'expired-old', deadlineAt: '2026-06-01T12:00:00Z' }),
    tender({ id: 'open-later', deadlineAt: '2026-09-01T12:00:00Z' }),
    tender({ id: 'planned-new', planned: true, deadlineAt: null, publishedAt: '2026-08-05' }),
    tender({ id: 'open-soon', deadlineAt: '2026-08-11T12:00:00Z' }),
    tender({ id: 'expired-recent', deadlineAt: '2026-07-30T12:00:00Z' }),
    tender({ id: 'planned-old', planned: true, deadlineAt: null, publishedAt: '2026-07-01' }),
    tender({ id: 'open-undated', deadlineAt: null }),
  ];

  const groups = groupResults(pool, NOW);

  it('V3: no notice in the main list has a deadline before now', () => {
    for (const entry of groups.open) {
      expect(isExpired(entry, NOW)).toBe(false);
      if (entry.deadlineAt) {
        expect(new Date(entry.deadlineAt).getTime()).toBeGreaterThanOrEqual(NOW.getTime());
      }
    }
  });

  it('V4: deadlines in the main list are non-descending', () => {
    const stamps = groups.open
      .map((entry) => (entry.deadlineAt ? new Date(entry.deadlineAt).getTime() : Infinity))
      .filter((value) => Number.isFinite(value));
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
  });

  it('orders the main list nearest first, with the undated one last', () => {
    expect(groups.open.map((entry) => entry.id)).toEqual([
      'open-soon',
      'open-later',
      'open-undated',
    ]);
  });

  it('keeps planned procurements out of the main list entirely', () => {
    expect(groups.open.some((entry) => entry.planned)).toBe(false);
    expect(groups.planned.map((entry) => entry.id)).toEqual(['planned-new', 'planned-old']);
  });

  it('collects the expired ones, most recently closed first', () => {
    expect(groups.expired.map((entry) => entry.id)).toEqual(['expired-recent', 'expired-old']);
  });

  it('loses nothing: every notice lands in exactly one group', () => {
    const total = groups.open.length + groups.planned.length + groups.expired.length;
    expect(total).toBe(pool.length);
  });

  it('empties the planned group when the switch filtered them out first', () => {
    const state: FilterState = { ...defaultsFor(TEMPLATE), includePlanned: false };
    const after = groupResults(applyFilters(pool, state, NOW), NOW);
    expect(after.planned).toEqual([]);
    expect(after.open).toHaveLength(3);
  });

  it('merges nationwide notices into the main list rather than a section of their own', () => {
    // R5. A nationwide notice is ordered by its deadline like any other; the
    // card carries `NATIONWIDE_MARKER_NB` instead of a heading carrying it.
    const merged = groupResults(
      [
        tender({ id: 'regional', deadlineAt: '2026-08-25T12:00:00Z' }),
        tender({ id: 'landsdekkende', nationwide: true, deadlineAt: '2026-08-15T12:00:00Z' }),
      ],
      NOW,
    );
    expect(merged.open.map((entry) => entry.id)).toEqual(['landsdekkende', 'regional']);
  });
});

describe('the expired group labels', () => {
  it('carries the count in the heading', () => {
    expect(describeExpiredGroup(9)).toBe('Avsluttede konkurranser (9)');
    expect(describeExpiredGroup(0)).toBe('Avsluttede konkurranser (0)');
  });

  it('says the deadline passed in the past tense, with the date', () => {
    expect(describeExpiredDeadline('2026-07-30T12:00:00Z')).toBe('Frist gikk ut 30. juli 2026');
  });

  it('falls back to the bare fact when the date is missing or unparseable', () => {
    expect(describeExpiredDeadline(null)).toBe('Fristen har gått ut');
    expect(describeExpiredDeadline('i går')).toBe('Fristen har gått ut');
  });

  it('never counts down, since there is nothing left to count', () => {
    expect(describeExpiredDeadline('2026-07-30T12:00:00Z')).not.toMatch(/dager igjen|i dag/);
  });
});

describe('the relevance level wire format', () => {
  it('matches the server union it mirrors', () => {
    // Type-only, erased at runtime: the assertion is that this file compiles.
    // If `RelevanceLevel` in `@/server/public-match-reasons` gains, loses or
    // renames a member, `pnpm -w typecheck` fails here rather than the two
    // drifting silently until a card renders `undefined`.
    // Whole-union assignability in both directions, not one sample literal:
    // one-way would pass while the server quietly grew a fourth level.
    const asServer = (value: RelevanceLevel): ServerRelevanceLevel => value;
    const asClient = (value: ServerRelevanceLevel): RelevanceLevel => value;
    expect(asServer('hoy')).toBe('hoy');
    expect(asClient('middels')).toBe('middels');
  });

  it('carries the same two labels as the server', () => {
    // The union check above is erased at runtime, so it cannot see the label
    // maps drift — a member could exist in both unions and be missing from one
    // map, which renders an empty badge rather than failing anything.
    expect(Object.keys(RELEVANCE_LEVEL_LABEL_NB).sort()).toEqual(['hoy', 'middels']);
  });
});
