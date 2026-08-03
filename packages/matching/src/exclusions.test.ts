import type { MatchExclusion } from '@luma/domain';
import { describe, expect, it } from 'vitest';
import { evaluateExclusions, EXCLUSION_TYPES } from './exclusions.js';
import { FIXED_NOW, INTENT_NOTICE, makeProfile, makeTender } from './testing/fixtures.js';

function inDays(days: number): Date {
  return new Date(FIXED_NOW.getTime() + days * 86_400_000);
}

function types(exclusions: MatchExclusion[]): string[] {
  return exclusions.map((exclusion) => exclusion.type);
}

const now = FIXED_NOW;

describe('evaluateExclusions', () => {
  it('finds nothing for an ordinary open competition', () => {
    const result = evaluateExclusions(makeTender({ deadlineAt: inDays(20) }), makeProfile(), {
      now,
    });
    expect(result).toEqual([]);
  });

  it('excludes a CPV code the user ruled out, including its children', () => {
    const result = evaluateExclusions(
      makeTender({ cpvCodes: ['45213316'] }),
      makeProfile({ cpvExclude: ['45000000'] }),
      { now },
    );
    expect(types(result)).toEqual(['cpv_excluded']);
    expect(result[0]?.evidence).toEqual(['45213316 (under 45000000)']);
    expect(result[0]?.label).toBe('Anbudet har en CPV-kode du har ekskludert');
  });

  it('excludes an excluded keyword, matched as a whole word', () => {
    const result = evaluateExclusions(
      makeTender({ title: 'Drift av bad og svømmehall' }),
      makeProfile({ keywordsExclude: ['bad'] }),
      { now },
    );
    expect(types(result)).toEqual(['keyword_excluded']);
    expect(result[0]?.evidence).toEqual(['«bad» i tittelen']);
  });

  it('does not exclude on a partial word', () => {
    const result = evaluateExclusions(
      makeTender({ title: 'Bemanning av badevakt' }),
      makeProfile({ keywordsExclude: ['bad'] }),
      { now },
    );
    expect(result).toEqual([]);
  });

  it('excludes an excluded buyer', () => {
    const result = evaluateExclusions(
      makeTender({ buyerName: 'Oslo kommune, Utdanningsetaten' }),
      makeProfile({ buyerExclude: ['Oslo kommune'] }),
      { now },
    );
    expect(types(result)).toEqual(['buyer_excluded']);
  });

  it('excludes a tender outside the geography the profile names', () => {
    const result = evaluateExclusions(
      makeTender({ regions: ['Troms'], municipalities: ['Tromsø'] }),
      makeProfile({ regionsInclude: ['Akershus'] }),
      { now },
    );
    expect(types(result)).toEqual(['geography_outside']);
    expect(result[0]?.evidence).toEqual([
      'Anbudet gjelder: Troms, Tromsø',
      'Profilen din dekker: Akershus',
    ]);
  });

  it('never excludes a nationwide notice, whatever the profile geography', () => {
    const result = evaluateExclusions(
      makeTender({ regions: ['anyw'] }),
      makeProfile({ regionsInclude: ['Akershus'], municipalitiesInclude: ['Bærum'] }),
      { now },
    );
    expect(result).toEqual([]);
  });

  it('does not exclude a region-only notice on a municipality-only profile', () => {
    // Doffin exposes no municipality data, so this comparison is inconclusive
    // rather than a mismatch. Excluding here would empty the inbox.
    const result = evaluateExclusions(
      makeTender({ regions: ['Akershus'], municipalities: [] }),
      makeProfile({ municipalitiesInclude: ['Bærum'], regionsInclude: [] }),
      { now },
    );
    expect(result).toEqual([]);
  });

  it('still excludes on geography once the profile states a region', () => {
    const result = evaluateExclusions(
      makeTender({ regions: ['Akershus'], municipalities: [] }),
      makeProfile({ municipalitiesInclude: ['Bærum'], regionsInclude: ['Oslo'] }),
      { now },
    );
    expect(types(result)).toEqual(['geography_outside']);
  });

  it('does not exclude a tender that states no geography at all', () => {
    const result = evaluateExclusions(makeTender(), makeProfile({ regionsInclude: ['Akershus'] }), {
      now,
    });
    expect(result).toEqual([]);
  });

  it('excludes a tender whose value is entirely outside the profile window', () => {
    const result = evaluateExclusions(
      makeTender({ estimatedValueMinNok: 40_000_000 }),
      makeProfile({ estimatedValueMinNok: 1_000_000, estimatedValueMaxNok: 5_000_000 }),
      { now },
    );
    expect(types(result)).toEqual(['value_outside']);
    expect(result[0]?.evidence).toEqual([
      'Anslått verdi i anbudet: 40 000 000 kr',
      'Verdiintervall i profilen: 1 000 000 kr–5 000 000 kr',
    ]);
  });

  it('does not exclude on a partial value overlap', () => {
    const result = evaluateExclusions(
      makeTender({ estimatedValueMinNok: 4_000_000, estimatedValueMaxNok: 9_000_000 }),
      makeProfile({ estimatedValueMinNok: 1_000_000, estimatedValueMaxNok: 5_000_000 }),
      { now },
    );
    expect(result).toEqual([]);
  });

  it('excludes a closed competition', () => {
    const result = evaluateExclusions(makeTender({ status: 'closed' }), makeProfile(), { now });
    expect(types(result)).toEqual(['closed']);
  });

  it('excludes a cancelled notice', () => {
    const result = evaluateExclusions(makeTender({ status: 'cancelled' }), makeProfile(), { now });
    expect(types(result)).toEqual(['cancelled']);
    expect(result[0]?.label).toBe('Kunngjøringen er kansellert');
  });

  it('excludes a competition that has already been awarded', () => {
    const result = evaluateExclusions(makeTender({ status: 'awarded' }), makeProfile(), { now });
    expect(types(result)).toEqual(['closed']);
    expect(result[0]?.label).toBe('Konkurransen er avgjort');
  });

  it('does not exclude on unknown status', () => {
    const result = evaluateExclusions(makeTender({ status: 'unknown' }), makeProfile(), { now });
    expect(result).toEqual([]);
  });

  it('excludes a passed deadline', () => {
    const result = evaluateExclusions(makeTender({ deadlineAt: inDays(-1) }), makeProfile(), {
      now,
    });
    expect(types(result)).toEqual(['deadline_passed']);
    expect(result[0]?.evidence).toEqual(['Frist: 02.08.2026']);
  });

  it('treats a deadline exactly at `now` as passed', () => {
    const result = evaluateExclusions(makeTender({ deadlineAt: now }), makeProfile(), { now });
    expect(types(result)).toEqual(['deadline_passed']);
  });

  it('excludes a deadline that is sooner than the profile minimum', () => {
    const result = evaluateExclusions(
      makeTender({ deadlineAt: inDays(3) }),
      makeProfile({ deadlineMinimumDays: 10 }),
      { now },
    );
    expect(types(result)).toEqual(['deadline_too_soon']);
    expect(result[0]?.evidence).toEqual([
      'Frist: 06.08.2026',
      'Dager igjen: 3',
      'Minstekrav i profilen: 10 dager',
    ]);
  });

  it('does not exclude a deadline exactly at the profile minimum', () => {
    const result = evaluateExclusions(
      makeTender({ deadlineAt: inDays(10) }),
      makeProfile({ deadlineMinimumDays: 10 }),
      { now },
    );
    expect(result).toEqual([]);
  });

  it('does not report both a passed deadline and a too-soon deadline', () => {
    const result = evaluateExclusions(
      makeTender({ deadlineAt: inDays(-2) }),
      makeProfile({ deadlineMinimumDays: 10 }),
      { now },
    );
    expect(types(result)).toEqual(['deadline_passed']);
  });

  it('includes planned procurements by default', () => {
    const result = evaluateExclusions(makeTender({ noticeCategory: 'planned' }), makeProfile(), {
      now,
    });
    expect(result).toEqual([]);
  });

  it('excludes planned procurements when the profile opts out', () => {
    const result = evaluateExclusions(
      makeTender({ noticeCategory: 'planned' }),
      makeProfile({ includePlannedProcurements: false }),
      { now },
    );
    expect(types(result)).toEqual(['planned_opted_out']);
  });

  it('excludes award notices in the MVP', () => {
    const result = evaluateExclusions(makeTender({ noticeCategory: 'award' }), makeProfile(), {
      now,
    });
    expect(types(result)).toEqual(['award_notice']);
  });

  it('does not exclude an intent notice that names a supplier', () => {
    // A VEAT names the intended supplier and Doffin files it under RESULT
    // alongside real awards, but spec section 13 makes it `planned`. The
    // exclusion keys on the category only, never on winner data.
    const result = evaluateExclusions(INTENT_NOTICE, makeProfile(), { now });
    expect(result).toEqual([]);
  });

  it('does not infer award-ness from winner data on a live competition', () => {
    const result = evaluateExclusions(
      makeTender({
        noticeCategory: 'competition',
        status: 'open',
        rawPayload: { lots: [{ winner: [{ name: 'Et firma AS' }] }] },
      }),
      makeProfile(),
      { now },
    );
    expect(result).toEqual([]);
  });

  it('does not exclude on value when the notice is priced in another currency', () => {
    const result = evaluateExclusions(
      makeTender({
        estimatedValueMinNok: 40_000_000,
        estimatedValueMaxNok: 40_000_000,
        currency: 'PLN',
      }),
      makeProfile({ estimatedValueMinNok: 1_000_000, estimatedValueMaxNok: 5_000_000 }),
      { now },
    );
    expect(result).toEqual([]);
  });

  it('does not exclude on value when the notice states none, which is the common case', () => {
    const result = evaluateExclusions(
      makeTender(),
      makeProfile({ estimatedValueMinNok: 1_000_000, estimatedValueMaxNok: 5_000_000 }),
      { now },
    );
    expect(result).toEqual([]);
  });

  it('reports every applicable exclusion, in a fixed order', () => {
    const result = evaluateExclusions(
      makeTender({
        noticeCategory: 'award',
        status: 'cancelled',
        cpvCodes: ['45213316'],
        regions: ['Troms'],
      }),
      makeProfile({ cpvExclude: ['45000000'], regionsInclude: ['Akershus'] }),
      { now },
    );
    expect(types(result)).toEqual([
      'cpv_excluded',
      'geography_outside',
      'cancelled',
      'award_notice',
    ]);
  });

  it('is unaffected by the order of the profile exclusion lists', () => {
    const tender = makeTender({ title: 'Drift av bad og garasje', cpvCodes: ['45213316'] });
    const forward = evaluateExclusions(
      tender,
      makeProfile({ keywordsExclude: ['bad', 'garasje'], cpvExclude: ['45000000', '72000000'] }),
      { now },
    );
    const reversed = evaluateExclusions(
      tender,
      makeProfile({ keywordsExclude: ['garasje', 'bad'], cpvExclude: ['72000000', '45000000'] }),
      { now },
    );
    expect(reversed).toEqual(forward);
  });

  it('only ever emits declared exclusion types', () => {
    const result = evaluateExclusions(
      makeTender({ noticeCategory: 'award', status: 'cancelled', deadlineAt: inDays(-1) }),
      makeProfile({ includePlannedProcurements: false }),
      { now },
    );
    for (const exclusion of result) {
      expect(EXCLUSION_TYPES).toContain(exclusion.type);
    }
  });
});
