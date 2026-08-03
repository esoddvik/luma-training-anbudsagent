import { describe, expect, it } from 'vitest';
import { makeProfile, makeTender } from '../testing/fixtures.js';
import { DEFAULT_MATCH_WEIGHTS } from '../weights.js';
import { scoreKeyword } from './keyword.js';

const weights = DEFAULT_MATCH_WEIGHTS;

function score(tender: { title: string; description?: string }, keywords: string[]) {
  return scoreKeyword(makeTender(tender), makeProfile({ keywordsInclude: keywords }), weights);
}

describe('scoreKeyword', () => {
  it('does not apply when the profile lists no keywords', () => {
    expect(score({ title: 'Rammeavtale renhold' }, [])).toBeNull();
  });

  it('matches whole words only', () => {
    expect(score({ title: 'Drift av badeanlegg med badevakt' }, ['bad'])).toBeNull();
  });

  it('matches the whole word when it stands alone', () => {
    expect(score({ title: 'Rehabilitering av bad i omsorgsbolig' }, ['bad'])).not.toBeNull();
  });

  it('matches a multi-word phrase only as a contiguous run', () => {
    expect(score({ title: 'Renhold av kommunale bygg' }, ['kommunale bygg'])).not.toBeNull();
    expect(
      score({ title: 'Renhold av bygg i kommunale eiendommer' }, ['kommunale bygg']),
    ).toBeNull();
  });

  it('folds Norwegian characters when the tender spells them out', () => {
    expect(score({ title: 'Rammeavtale for baerekraftig drift' }, ['bærekraftig'])).not.toBeNull();
  });

  it('folds Norwegian characters when the profile spells them out', () => {
    expect(score({ title: 'Rammeavtale for bærekraftig drift' }, ['baerekraftig'])).not.toBeNull();
  });

  it('is case insensitive', () => {
    expect(score({ title: 'RAMMEAVTALE RENHOLD' }, ['Renhold'])).not.toBeNull();
  });

  it('scores more distinct keywords higher, with diminishing returns', () => {
    const title = 'Renhold, vaktmester og vinduspuss i kommunale bygg';
    const one = score({ title }, ['renhold'])?.contribution ?? 0;
    const two = score({ title }, ['renhold', 'vaktmester'])?.contribution ?? 0;
    const three = score({ title }, ['renhold', 'vaktmester', 'vinduspuss'])?.contribution ?? 0;

    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
    // Each step adds less than the one before it.
    expect(three - two).toBeLessThan(two - one);
  });

  it('never lets repetition of one keyword outweigh two distinct keywords', () => {
    const repeated = score(
      {
        title: 'Renhold',
        description: 'renhold renhold renhold renhold renhold renhold renhold renhold',
      },
      ['renhold', 'vaktmester'],
    );
    const distinct = score({ title: 'Renhold og vaktmester' }, ['renhold', 'vaktmester']);
    expect(distinct?.contribution).toBeGreaterThan(repeated?.contribution ?? 0);
  });

  it('stays inside the configured budget however many keywords match', () => {
    const many = Array.from({ length: 40 }, (_, index) => `ord${index}`);
    const title = many.join(' ');
    const reason = score({ title }, many);
    expect(reason?.contribution).toBeLessThanOrEqual(weights.keyword);
  });

  it('weighs a title hit above a description-only hit', () => {
    const inTitle = score({ title: 'Renhold av bygg', description: 'Ingenting her' }, ['renhold']);
    const inBody = score({ title: 'Anskaffelse av tjenester', description: 'Renhold av bygg' }, [
      'renhold',
    ]);
    expect(inTitle?.contribution).toBeGreaterThan(inBody?.contribution ?? 0);
  });

  it('reports where each keyword was found', () => {
    const reason = score({ title: 'Renhold av bygg', description: 'Med vaktmester' }, [
      'vaktmester',
      'renhold',
    ]);
    expect(reason?.evidence).toEqual(['«renhold» i tittelen', '«vaktmester» i beskrivelsen']);
  });

  it('is unaffected by the order of the profile keywords', () => {
    const tender = { title: 'Renhold og vaktmester i kommunale bygg' };
    expect(score(tender, ['vaktmester', 'renhold'])).toEqual(
      score(tender, ['renhold', 'vaktmester']),
    );
  });

  it('counts a keyword once even when the user listed it twice in two spellings', () => {
    const tender = { title: 'Rammeavtale for renhold' };
    const once = score(tender, ['renhold']);
    const twice = score(tender, ['renhold', 'Renhold']);
    expect(twice?.contribution).toBe(once?.contribution);
  });
});
