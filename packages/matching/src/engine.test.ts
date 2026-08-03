import { matchResultSchema, type AlertProfile, type Tender } from '@luma/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLANNED_NOTICE_TEXT_NB } from './components/index.js';
import { confidenceFor, matchTender, matchTenders } from './engine.js';
import { FIXED_NOW, makeProfile, makeTender } from './testing/fixtures.js';
import { DEFAULT_MATCH_WEIGHTS, MATCHING_VERSION, MAX_SCORE, totalWeight } from './weights.js';

const now = FIXED_NOW;

function inDays(days: number): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

/** A tender and profile that agree on every component the engine scores. */
const STRONG_TENDER: Tender = makeTender({
  title: 'Rammeavtale for renhold og vaktmestertjenester',
  description: 'Bærum kommune skal inngå rammeavtale for renhold, vaktmester og vinterdrift.',
  buyerName: 'Bærum kommune',
  cpvCodes: ['90910000'],
  regions: ['Akershus'],
  municipalities: ['Bærum'],
  noticeType: 'Kunngjøring av konkurranse',
  noticeCategory: 'competition',
  procedureType: 'Åpen anbudskonkurranse',
  estimatedValueMinNok: 8_000_000,
  estimatedValueMaxNok: 10_000_000,
  deadlineAt: inDays(30),
});

/**
 * Several entries per list deliberately do not match, so that rotating the
 * arrays actually moves non-matching entries past matching ones.
 */
const STRONG_PROFILE: AlertProfile = makeProfile({
  cpvInclude: ['90910000', '45000000', '72000000'],
  keywordsInclude: ['renhold', 'vaktmester', 'vinterdrift', 'rammeavtale'],
  regionsInclude: ['Akershus', 'Oslo'],
  municipalitiesInclude: ['Bærum', 'Asker'],
  buyerInclude: ['Bærum kommune', 'Trondheim kommune'],
  procedureTypes: ['Åpen anbudskonkurranse'],
  estimatedValueMinNok: 1_000_000,
  estimatedValueMaxNok: 20_000_000,
  minimumMatchScore: 40,
});

/** Deterministic shuffle, so a failure is reproducible. */
function rotate<T>(values: readonly T[], by: number): T[] {
  const offset = ((by % values.length) + values.length) % values.length;
  return [...values.slice(offset), ...values.slice(0, offset)];
}

afterEach(() => {
  vi.useRealTimers();
});

describe('matchTender', () => {
  it('produces a result that satisfies the domain schema', () => {
    const result = matchTender(STRONG_TENDER, STRONG_PROFILE, { now });
    expect(() => matchResultSchema.parse(result)).not.toThrow();
  });

  it('carries the ids and the matching version', () => {
    const result = matchTender(STRONG_TENDER, STRONG_PROFILE, { now });
    expect(result.tenderId).toBe(STRONG_TENDER.id);
    expect(result.alertProfileId).toBe(STRONG_PROFILE.id);
    expect(result.matchingVersion).toBe(MATCHING_VERSION);
  });

  it('accepts an overridden version, for shadow-running a new weighting', () => {
    const result = matchTender(STRONG_TENDER, STRONG_PROFILE, {
      now,
      matchingVersion: '2099.01.1',
    });
    expect(result.matchingVersion).toBe('2099.01.1');
  });

  it('includes a strong match and calls it high relevance', () => {
    const result = matchTender(STRONG_TENDER, STRONG_PROFILE, { now });
    expect(result.included).toBe(true);
    expect(result.confidence).toBe('high');
    expect(result.score).toBeGreaterThan(90);
  });

  it('never reports a score with no reasons behind it', () => {
    const result = matchTender(STRONG_TENDER, STRONG_PROFILE, { now });
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('reports a score equal to the sum of the contributions it shows', () => {
    const result = matchTender(STRONG_TENDER, STRONG_PROFILE, { now });
    const summed = result.reasons.reduce((total, reason) => total + reason.contribution, 0);
    expect(result.score).toBeCloseTo(summed, 10);
  });
});

describe('determinism', () => {
  it('produces byte-identical output across repeated runs', () => {
    const first = JSON.stringify(matchTender(STRONG_TENDER, STRONG_PROFILE, { now }));
    for (let run = 0; run < 100; run += 1) {
      expect(JSON.stringify(matchTender(STRONG_TENDER, STRONG_PROFILE, { now }))).toBe(first);
    }
  });

  it('is unaffected by the order of the profile arrays', () => {
    const baseline = matchTender(STRONG_TENDER, STRONG_PROFILE, { now });

    for (let by = 1; by < 4; by += 1) {
      const shuffled = makeProfile({
        ...STRONG_PROFILE,
        cpvInclude: rotate(STRONG_PROFILE.cpvInclude, by),
        keywordsInclude: rotate(STRONG_PROFILE.keywordsInclude, by),
        regionsInclude: rotate(STRONG_PROFILE.regionsInclude, by),
        municipalitiesInclude: rotate(STRONG_PROFILE.municipalitiesInclude, by),
        buyerInclude: rotate(STRONG_PROFILE.buyerInclude, by),
      });
      expect(matchTender(STRONG_TENDER, shuffled, { now })).toEqual(baseline);
    }
  });

  it('is unaffected by the order of the tender CPV codes', () => {
    const tender = makeTender({ ...STRONG_TENDER, cpvCodes: ['90910000', '90911200'] });
    const reversed = makeTender({ ...STRONG_TENDER, cpvCodes: ['90911200', '90910000'] });
    expect(matchTender(reversed, STRONG_PROFILE, { now })).toEqual(
      matchTender(tender, STRONG_PROFILE, { now }),
    );
  });

  it('depends on the supplied clock, not the system clock', () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
    const early = matchTender(STRONG_TENDER, STRONG_PROFILE, { now });

    vi.setSystemTime(new Date('2031-12-31T23:59:59.000Z'));
    const late = matchTender(STRONG_TENDER, STRONG_PROFILE, { now });

    expect(late).toEqual(early);
  });
});

describe('exclusion precedence', () => {
  const cases: ReadonlyArray<{
    name: string;
    tender?: Partial<Tender>;
    profile?: Partial<AlertProfile>;
    expected: string;
  }> = [
    { name: 'excluded CPV', profile: { cpvExclude: ['90000000'] }, expected: 'cpv_excluded' },
    {
      name: 'excluded keyword',
      profile: { keywordsExclude: ['vinterdrift'] },
      expected: 'keyword_excluded',
    },
    {
      name: 'excluded buyer',
      profile: { buyerExclude: ['Bærum kommune'] },
      expected: 'buyer_excluded',
    },
    {
      name: 'outside mandatory geography',
      tender: { regions: ['Troms'], municipalities: ['Tromsø'] },
      expected: 'geography_outside',
    },
    {
      name: 'outside the value range',
      profile: { estimatedValueMinNok: 1_000, estimatedValueMaxNok: 5_000 },
      expected: 'value_outside',
    },
    { name: 'closed', tender: { status: 'closed' }, expected: 'closed' },
    { name: 'cancelled', tender: { status: 'cancelled' }, expected: 'cancelled' },
    {
      name: 'past deadline',
      tender: { deadlineAt: inDays(-1) },
      expected: 'deadline_passed',
    },
    {
      name: 'deadline sooner than the profile minimum',
      profile: { deadlineMinimumDays: 60 },
      expected: 'deadline_too_soon',
    },
    {
      name: 'planned when the profile opted out',
      tender: { noticeCategory: 'planned' },
      profile: { includePlannedProcurements: false },
      expected: 'planned_opted_out',
    },
    { name: 'award notice', tender: { noticeCategory: 'award' }, expected: 'award_notice' },
  ];

  it.each(cases)('excludes on $name however high the score', ({ tender, profile, expected }) => {
    const result = matchTender(
      makeTender({ ...STRONG_TENDER, ...tender }),
      makeProfile({ ...STRONG_PROFILE, ...profile }),
      { now },
    );

    expect(result.included).toBe(false);
    expect(result.exclusions.map((exclusion) => exclusion.type)).toContain(expected);
    expect(result.exclusions[0]?.evidence.length).toBeGreaterThan(0);
  });

  it('keeps the score visible so the user can see what was lost', () => {
    const result = matchTender(
      STRONG_TENDER,
      makeProfile({ ...STRONG_PROFILE, buyerExclude: ['Bærum kommune'] }),
      { now },
    );
    expect(result.included).toBe(false);
    expect(result.score).toBeGreaterThan(90);
  });

  it('excludes even when the profile minimum score is zero', () => {
    const result = matchTender(
      makeTender({ ...STRONG_TENDER, noticeCategory: 'award' }),
      makeProfile({ ...STRONG_PROFILE, minimumMatchScore: 0 }),
      { now },
    );
    expect(result.included).toBe(false);
  });
});

describe('minimum match score', () => {
  it('excludes a match below the profile minimum without an exclusion rule', () => {
    const result = matchTender(
      STRONG_TENDER,
      makeProfile({ ...STRONG_PROFILE, minimumMatchScore: 99 }),
      { now },
    );
    expect(result.exclusions).toEqual([]);
    expect(result.included).toBe(false);
  });

  it('includes a match exactly at the profile minimum', () => {
    const unconstrained = matchTender(STRONG_TENDER, STRONG_PROFILE, { now });
    const result = matchTender(
      STRONG_TENDER,
      makeProfile({ ...STRONG_PROFILE, minimumMatchScore: unconstrained.score }),
      { now },
    );
    expect(result.included).toBe(true);
  });
});

describe('planned procurements', () => {
  const PLANNED = makeTender({
    ...STRONG_TENDER,
    id: 'aaaaaaaa-0000-4000-8000-00000000000a',
    noticeCategory: 'planned',
    noticeType: 'Veiledende kunngjøring',
    deadlineAt: undefined,
  });

  it('is included by default', () => {
    expect(matchTender(PLANNED, STRONG_PROFILE, { now }).included).toBe(true);
  });

  it('carries the exact required Norwegian sentence', () => {
    const result = matchTender(PLANNED, STRONG_PROFILE, { now });
    const noticeType = result.reasons.find((reason) => reason.type === 'notice_type');
    expect(noticeType?.label).toBe(PLANNED_NOTICE_TEXT_NB);
  });

  it('takes no deadline penalty: only the deadline reason is missing', () => {
    const planned = matchTender(PLANNED, STRONG_PROFILE, { now });
    const competition = matchTender(STRONG_TENDER, STRONG_PROFILE, { now });

    // The notice_type reason legitimately differs in wording; everything else
    // must be identical, and the deadline reason must simply be absent.
    const comparable = (reasons: typeof planned.reasons) =>
      reasons.filter((reason) => reason.type !== 'deadline' && reason.type !== 'notice_type');

    expect(comparable(planned.reasons)).toEqual(comparable(competition.reasons));
    expect(planned.reasons.some((reason) => reason.type === 'deadline')).toBe(false);
    expect(competition.reasons.some((reason) => reason.type === 'deadline')).toBe(true);
  });

  it('scores the notice_type reason identically to a competition', () => {
    const planned = matchTender(PLANNED, STRONG_PROFILE, { now });
    const competition = matchTender(STRONG_TENDER, STRONG_PROFILE, { now });
    const contribution = (result: typeof planned) =>
      result.reasons.find((reason) => reason.type === 'notice_type')?.contribution;

    expect(contribution(planned)).toBe(contribution(competition));
  });

  it('scores within the deadline budget of an otherwise identical competition', () => {
    const planned = matchTender(PLANNED, STRONG_PROFILE, { now });
    const competition = matchTender(STRONG_TENDER, STRONG_PROFILE, { now });
    expect(competition.score - planned.score).toBeCloseTo(DEFAULT_MATCH_WEIGHTS.deadline, 10);
  });
});

describe('score bounds', () => {
  it('never exceeds 100, even with contrived weights', () => {
    const result = matchTender(STRONG_TENDER, STRONG_PROFILE, {
      now,
      weights: {
        cpv: 1_000,
        keyword: 1_000,
        geography: 1_000,
        buyer: 1_000,
        value: 1_000,
        noticeType: 1_000,
        procedure: 1_000,
        deadline: 1_000,
        confidence: DEFAULT_MATCH_WEIGHTS.confidence,
      },
    });
    expect(result.score).toBe(MAX_SCORE);
  });

  it('never falls below 0, even with negative weights', () => {
    const result = matchTender(STRONG_TENDER, STRONG_PROFILE, {
      now,
      weights: {
        cpv: -1_000,
        keyword: -1_000,
        geography: -1_000,
        buyer: -1_000,
        value: -1_000,
        noticeType: -1_000,
        procedure: -1_000,
        deadline: -1_000,
        confidence: DEFAULT_MATCH_WEIGHTS.confidence,
      },
    });
    expect(result.score).toBe(0);
  });

  it('reports 0 for a tender with nothing in common with the profile', () => {
    const result = matchTender(
      makeTender({ title: 'Kjøp av kontorrekvisita', noticeCategory: 'other' }),
      makeProfile({ cpvInclude: ['45000000'], keywordsInclude: ['tunnel'], noticeTypes: ['X'] }),
      { now },
    );
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual([]);
    expect(result.included).toBe(false);
  });

  it('has default weights that sum to exactly the maximum score', () => {
    expect(totalWeight(DEFAULT_MATCH_WEIGHTS)).toBe(MAX_SCORE);
  });
});

describe('confidenceFor', () => {
  it.each([
    [100, 'high'],
    [70.01, 'high'],
    [70, 'high'],
    [69.99, 'medium'],
    [40.01, 'medium'],
    [40, 'medium'],
    [39.99, 'low'],
    [0, 'low'],
  ])('maps %s to %s', (score, expected) => {
    expect(confidenceFor(score)).toBe(expected);
  });

  it('honours overridden thresholds', () => {
    expect(confidenceFor(50, { high: 50, medium: 10 })).toBe('high');
    expect(confidenceFor(49.99, { high: 50, medium: 10 })).toBe('medium');
  });

  it('is the same function the engine uses', () => {
    const result = matchTender(STRONG_TENDER, STRONG_PROFILE, { now });
    expect(result.confidence).toBe(confidenceFor(result.score));
  });
});

describe('reason ordering', () => {
  it('sorts reasons by contribution, descending', () => {
    const result = matchTender(STRONG_TENDER, STRONG_PROFILE, { now });
    const contributions = result.reasons.map((reason) => reason.contribution);
    expect(contributions).toEqual([...contributions].sort((a, b) => b - a));
  });

  it('breaks ties in a fixed order rather than by scorer order', () => {
    const weights = {
      ...DEFAULT_MATCH_WEIGHTS,
      cpv: 10,
      keyword: 10,
      geography: 10,
      buyer: 10,
    };
    const first = matchTender(STRONG_TENDER, STRONG_PROFILE, { now, weights });
    const second = matchTender(STRONG_TENDER, STRONG_PROFILE, { now, weights });
    expect(second.reasons.map((reason) => reason.type)).toEqual(
      first.reasons.map((reason) => reason.type),
    );
    expect(first.reasons.map((reason) => reason.type).slice(0, 3)).toEqual([
      'cpv',
      'geography',
      'buyer',
    ]);
  });
});

/**
 * The Doffin reconnaissance found that 53% of notices state no value at all,
 * 18% are nationwide (`anyw`) rather than filed under a region, and no notice
 * carries municipality data. A corpus shaped like the real one is the only way
 * to catch a rule that quietly drops most of the market.
 */
describe('a corpus shaped like the real source', () => {
  const CORPUS_SIZE = 100;
  const WITHOUT_VALUE = 53;
  const NATIONWIDE = 18;

  const corpus: Tender[] = Array.from({ length: CORPUS_SIZE }, (_, index) => {
    const statesValue = index >= WITHOUT_VALUE;
    const nationwide = index % 5 === 0 && index / 5 < NATIONWIDE;
    return makeTender({
      ...STRONG_TENDER,
      id: `aaaaaaaa-0000-4000-8000-${`${index}`.padStart(12, '0')}`,
      // No source supplies municipalities; NUTS-3 is the finest level there is.
      municipalities: [],
      regions: nationwide ? ['anyw'] : ['Akershus'],
      ...(statesValue
        ? { estimatedValueMinNok: 9_000_000, estimatedValueMaxNok: 9_000_000 }
        : { estimatedValueMinNok: undefined, estimatedValueMaxNok: undefined }),
    });
  });

  const results = matchTenders(corpus, STRONG_PROFILE, { now });

  it('includes every tender: neither a missing value nor a missing municipality filters one out', () => {
    expect(results.filter((result) => result.included)).toHaveLength(CORPUS_SIZE);
  });

  it('scores no value component on the 53% that state none, and no penalty either', () => {
    const withoutValue = results.slice(0, WITHOUT_VALUE);
    expect(withoutValue).toHaveLength(WITHOUT_VALUE);
    for (const result of withoutValue) {
      expect(result.reasons.some((reason) => reason.type === 'value')).toBe(false);
      expect(result.exclusions).toEqual([]);
    }
  });

  it('gives every nationwide notice a geography reason', () => {
    const nationwide = results.filter((_, index) => index % 5 === 0 && index / 5 < NATIONWIDE);
    expect(nationwide).toHaveLength(NATIONWIDE);
    for (const result of nationwide) {
      const geography = result.reasons.find((reason) => reason.type === 'geography');
      expect(geography?.evidence).toEqual(['Gjelder hele landet']);
    }
  });
});

describe('matchTenders', () => {
  it('preserves the input order and matches each tender independently', () => {
    const other = makeTender({
      ...STRONG_TENDER,
      id: 'aaaaaaaa-0000-4000-8000-00000000000b',
      title: 'Kjøp av kontorrekvisita',
      cpvCodes: [],
    });

    const results = matchTenders([STRONG_TENDER, other], STRONG_PROFILE, { now });
    expect(results.map((result) => result.tenderId)).toEqual([STRONG_TENDER.id, other.id]);
    expect(results[0]).toEqual(matchTender(STRONG_TENDER, STRONG_PROFILE, { now }));
    expect(results[1]).toEqual(matchTender(other, STRONG_PROFILE, { now }));
  });

  it('returns an empty list for an empty corpus', () => {
    expect(matchTenders([], STRONG_PROFILE, { now })).toEqual([]);
  });
});
