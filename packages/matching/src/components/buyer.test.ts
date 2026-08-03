import { describe, expect, it } from 'vitest';
import { makeProfile, makeTender } from '../testing/fixtures.js';
import { DEFAULT_MATCH_WEIGHTS } from '../weights.js';
import { scoreBuyer } from './buyer.js';

const weights = DEFAULT_MATCH_WEIGHTS;

describe('scoreBuyer', () => {
  it('does not apply when the profile names no buyers', () => {
    expect(
      scoreBuyer(makeTender({ buyerName: 'Bærum kommune' }), makeProfile(), weights),
    ).toBeNull();
  });

  it('awards the whole budget on a match', () => {
    const reason = scoreBuyer(
      makeTender({ buyerName: 'Bærum kommune' }),
      makeProfile({ buyerInclude: ['Bærum kommune'] }),
      weights,
    );
    expect(reason?.contribution).toBe(weights.buyer);
  });

  it('matches a profile entry inside a longer buyer name', () => {
    const reason = scoreBuyer(
      makeTender({ buyerName: 'Oslo kommune, Utdanningsetaten' }),
      makeProfile({ buyerInclude: ['Oslo kommune'] }),
      weights,
    );
    expect(reason).not.toBeNull();
  });

  it('does not match a longer profile entry against a shorter buyer name', () => {
    const reason = scoreBuyer(
      makeTender({ buyerName: 'Oslo kommune' }),
      makeProfile({ buyerInclude: ['Oslo kommune, Utdanningsetaten'] }),
      weights,
    );
    expect(reason).toBeNull();
  });

  it('matches on organisation number regardless of spacing', () => {
    const reason = scoreBuyer(
      makeTender({ buyerName: 'Ukjent etat', buyerOrganizationNumber: '935 478 715' }),
      makeProfile({ buyerInclude: ['935478715'] }),
      weights,
    );
    expect(reason?.evidence).toEqual(['Oppdragsgiver i profilen: 935478715']);
  });

  it('does not treat a numeric profile entry as a name fragment', () => {
    const reason = scoreBuyer(
      makeTender({ buyerName: 'Etat 935478715 avdeling' }),
      makeProfile({ buyerInclude: ['935478715'] }),
      weights,
    );
    expect(reason).toBeNull();
  });

  it('is unaffected by the order of the profile buyers', () => {
    const tender = makeTender({ buyerName: 'Bærum kommune' });
    const forward = scoreBuyer(
      tender,
      makeProfile({ buyerInclude: ['Bærum kommune', 'Oslo kommune'] }),
      weights,
    );
    const reversed = scoreBuyer(
      tender,
      makeProfile({ buyerInclude: ['Oslo kommune', 'Bærum kommune'] }),
      weights,
    );
    expect(reversed).toEqual(forward);
  });
});
