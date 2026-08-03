import { describe, expect, it } from 'vitest';
import { makeProfile, makeTender } from '../testing/fixtures.js';
import { DEFAULT_MATCH_WEIGHTS } from '../weights.js';
import { scoreCpv } from './cpv.js';

const weights = DEFAULT_MATCH_WEIGHTS;

function score(tenderCodes: string[], profileCodes: string[]) {
  return scoreCpv(
    makeTender({ cpvCodes: tenderCodes }),
    makeProfile({ cpvInclude: profileCodes }),
    weights,
  );
}

describe('scoreCpv', () => {
  it('does not apply when the profile lists no codes', () => {
    expect(score(['45213316'], [])).toBeNull();
  });

  it('does not apply when nothing overlaps', () => {
    expect(score(['45213316'], ['72000000'])).toBeNull();
  });

  it('matches a specific tender code against a broad profile code', () => {
    const reason = score(['45213316'], ['45000000']);
    expect(reason?.evidence).toEqual(['CPV 45213316 ligger under profilkoden 45000000']);
    expect(reason?.contribution).toBeGreaterThan(0);
  });

  it('does not match a broad tender code against a specific profile code', () => {
    expect(score(['45000000'], ['45213316'])).toBeNull();
  });

  it('scores an exact match higher than an ancestor match', () => {
    const exact = score(['45213316'], ['45213316']);
    const ancestor = score(['45213316'], ['45000000']);
    expect(exact?.contribution).toBeGreaterThan(ancestor?.contribution ?? 0);
  });

  it('awards the whole budget for a single exact code', () => {
    expect(score(['45213316'], ['45213316'])?.contribution).toBe(weights.cpv);
  });

  it('treats an exact match on a shallow code as full precision', () => {
    // The buyer filed the notice coarsely; the user asked for exactly that.
    expect(score(['45000000'], ['45000000'])?.contribution).toBe(weights.cpv);
  });

  it('rewards covering more of the tender codes', () => {
    const one = score(['72000000', '45213316'], ['45213316']);
    const both = score(['72000000', '45213316'], ['45213316', '72000000']);
    expect(both?.contribution).toBeGreaterThan(one?.contribution ?? 0);
  });

  it('names the closest covering profile code, not the broadest', () => {
    const reason = score(['45213316'], ['45000000', '45210000']);
    expect(reason?.evidence).toEqual(['CPV 45213316 ligger under profilkoden 45210000']);
  });

  it('tolerates check digits and duplicates on both sides', () => {
    const reason = score(['45213316-1', '45213316'], ['45213316-7']);
    expect(reason?.evidence).toEqual(['CPV 45213316 står i profilen din']);
    expect(reason?.contribution).toBe(weights.cpv);
  });

  it('is unaffected by the order of the profile codes', () => {
    const forward = score(['45213316', '72000000'], ['45000000', '72000000']);
    const reversed = score(['72000000', '45213316'], ['72000000', '45000000']);
    expect(reversed).toEqual(forward);
  });

  it('labels a multi-code match with the counts', () => {
    const reason = score(['90910000', '90911200'], ['90910000']);
    expect(reason?.label).toBe('Treff på 2 av 2 CPV-koder i anbudet');
  });

  it('scales with the configured weight', () => {
    const doubled = scoreCpv(
      makeTender({ cpvCodes: ['45213316'] }),
      makeProfile({ cpvInclude: ['45213316'] }),
      { ...weights, cpv: 70 },
    );
    expect(doubled?.contribution).toBe(70);
  });
});
