import { describe, expect, it } from 'vitest';
import {
  applyFilters,
  countActiveFilters,
  defaultsFor,
  describeActiveFilters,
  describeResultCount,
  matchesCpv,
  matchesDeadlineBand,
  matchesKeywords,
  matchesQuery,
  matchesValueBand,
  type ExplorerTender,
  type FilterState,
} from './results-filter';

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
      '1 filter aktivt',
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
    expect(describeActiveFilters(state, defaults)).toBe('6 filtre aktive');
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
