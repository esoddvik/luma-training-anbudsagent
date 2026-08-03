import { describe, expect, it } from 'vitest';
import { makeProfile, makeTender } from '../testing/fixtures.js';
import { DEFAULT_MATCH_WEIGHTS, NOTICE_AND_PROCEDURE_BUDGET } from '../weights.js';
import { PLANNED_NOTICE_TEXT_NB, scoreNoticeType, scoreProcedure } from './noticeType.js';

const weights = DEFAULT_MATCH_WEIGHTS;

describe('scoreNoticeType', () => {
  it('splits the spec budget between notice type and procedure', () => {
    expect(weights.noticeType + weights.procedure).toBe(NOTICE_AND_PROCEDURE_BUDGET);
  });

  it('carries the exact required sentence for a planned procurement', () => {
    const reason = scoreNoticeType(
      makeTender({ noticeCategory: 'planned', noticeType: 'Veiledende kunngjøring' }),
      makeProfile(),
      weights,
    );
    expect(reason?.label).toBe(
      'Dette er en planlagt anskaffelse. Konkurransen er ikke publisert ennå.',
    );
    expect(reason?.evidence).toContain(PLANNED_NOTICE_TEXT_NB);
  });

  it('produces the planned reason even when the notice type is not one the profile asked for', () => {
    const reason = scoreNoticeType(
      makeTender({ noticeCategory: 'planned', noticeType: 'Veiledende kunngjøring' }),
      makeProfile({ noticeTypes: ['Kunngjøring av konkurranse'] }),
      weights,
    );
    expect(reason?.contribution).toBe(0);
    expect(reason?.label).toBe(PLANNED_NOTICE_TEXT_NB);
  });

  it('scores a planned procurement the same as a competition', () => {
    const planned = scoreNoticeType(
      makeTender({ noticeCategory: 'planned' }),
      makeProfile(),
      weights,
    );
    const competition = scoreNoticeType(
      makeTender({ noticeCategory: 'competition' }),
      makeProfile(),
      weights,
    );
    expect(planned?.contribution).toBe(competition?.contribution);
    expect(competition?.contribution).toBe(weights.noticeType);
  });

  it('labels an active competition in Norwegian', () => {
    const reason = scoreNoticeType(
      makeTender({ noticeCategory: 'competition', noticeType: 'Kunngjøring av konkurranse' }),
      makeProfile(),
      weights,
    );
    expect(reason?.label).toBe('Aktiv konkurranse');
  });

  it('gives an award notice nothing, since it never reaches the product in the MVP', () => {
    expect(
      scoreNoticeType(makeTender({ noticeCategory: 'award' }), makeProfile(), weights),
    ).toBeNull();
  });

  it('halves the budget for an uncategorised notice', () => {
    const reason = scoreNoticeType(makeTender({ noticeCategory: 'other' }), makeProfile(), weights);
    expect(reason?.contribution).toBe(weights.noticeType / 2);
  });

  it('scores nothing when the profile asked for a different notice type', () => {
    const reason = scoreNoticeType(
      makeTender({ noticeCategory: 'competition', noticeType: 'Kunngjøring av konkurranse' }),
      makeProfile({ noticeTypes: ['Intensjonskunngjøring'] }),
      weights,
    );
    expect(reason).toBeNull();
  });
});

describe('scoreProcedure', () => {
  it('does not apply when the profile names no procedures', () => {
    const reason = scoreProcedure(
      makeTender({ procedureType: 'Åpen anbudskonkurranse' }),
      makeProfile(),
      weights,
    );
    expect(reason).toBeNull();
  });

  it('does not apply when the tender states no procedure', () => {
    const reason = scoreProcedure(
      makeTender(),
      makeProfile({ procedureTypes: ['Åpen anbudskonkurranse'] }),
      weights,
    );
    expect(reason).toBeNull();
  });

  it('awards the procedure budget on a match', () => {
    const reason = scoreProcedure(
      makeTender({ procedureType: 'Åpen anbudskonkurranse' }),
      makeProfile({ procedureTypes: ['Åpen anbudskonkurranse'] }),
      weights,
    );
    expect(reason?.contribution).toBe(weights.procedure);
    expect(reason?.type).toBe('procedure');
  });
});
