import { CONFIDENCE_LABEL_NB, SCORE_DISCLAIMER_NB } from '@luma/domain';
import { describe, expect, it } from 'vitest';
import { matchTender } from './engine.js';
import {
  explainMatch,
  findForbiddenScorePhrasing,
  mainReasons,
  METHOD_NOTE_NB,
} from './explain.js';
import {
  CLEANING_FRAMEWORK,
  CLEANING_PROFILE,
  FIXED_NOW,
  GOLDEN_CASES,
  makeProfile,
  PLANNED_VENTILATION,
  VENTILATION_PROFILE,
} from './testing/fixtures.js';

const now = FIXED_NOW;

const strong = matchTender(CLEANING_FRAMEWORK, CLEANING_PROFILE, { now });
const excluded = matchTender(CLEANING_FRAMEWORK, VENTILATION_PROFILE, { now });
const belowMinimum = matchTender(
  PLANNED_VENTILATION,
  makeProfile({ ...VENTILATION_PROFILE, minimumMatchScore: 99 }),
  { now },
);

describe('explainMatch', () => {
  it('leads with the approved confidence wording, never a raw number', () => {
    expect(strong.confidence).toBe('high');
    expect(explainMatch(strong).headline).toBe(CONFIDENCE_LABEL_NB.high);
  });

  it('lists every reason with its points and its evidence', () => {
    const explanation = explainMatch(strong);
    expect(explanation.reasons).toHaveLength(strong.reasons.length);
    expect(explanation.reasons[0]).toContain('poeng');
    expect(explanation.reasons[0]).toContain(strong.reasons[0]?.label ?? '');
  });

  it('caps the reason list when the surface asks for a short form', () => {
    expect(explainMatch(strong, { maxReasons: 2 }).reasons).toHaveLength(2);
  });

  it('explains an exclusion instead of pretending the tender was ranked', () => {
    const explanation = explainMatch(excluded);
    expect(explanation.exclusions.length).toBeGreaterThan(0);
    expect(explanation.summary).toContain('holdt utenfor');
  });

  it('says plainly when a match fell below the profile minimum', () => {
    expect(belowMinimum.included).toBe(false);
    expect(explainMatch(belowMinimum).summary).toContain('lavere enn minstekravet');
  });

  it('always carries the score disclaimer from the domain', () => {
    for (const result of [strong, excluded, belowMinimum]) {
      const explanation = explainMatch(result);
      expect(explanation.disclaimer).toBe(SCORE_DISCLAIMER_NB);
      expect(explanation.text).toContain(SCORE_DISCLAIMER_NB);
    }
  });

  it('states that the assessment is rule-based, since there is no AI in the MVP', () => {
    const explanation = explainMatch(strong);
    expect(explanation.method).toBe(METHOD_NOTE_NB);
    expect(explanation.text).toContain('regelbasert');
    expect(explanation.text).toContain('Ingen AI-modell');
  });

  it('records the rule version, so a stored explanation stays traceable', () => {
    expect(explainMatch(strong).text).toContain(`Regelversjon: ${strong.matchingVersion}`);
  });

  it('surfaces the planned-procurement sentence in the explanation', () => {
    const planned = matchTender(PLANNED_VENTILATION, VENTILATION_PROFILE, { now });
    expect(explainMatch(planned).text).toContain(
      'Dette er en planlagt anskaffelse. Konkurransen er ikke publisert ennå.',
    );
  });

  it('is deterministic', () => {
    expect(explainMatch(strong)).toEqual(explainMatch(strong));
  });
});

describe('mainReasons', () => {
  it('returns the two or three main reasons a tender card shows', () => {
    expect(mainReasons(strong)).toHaveLength(3);
    expect(mainReasons(strong, 2)).toEqual(mainReasons(strong).slice(0, 2));
  });

  it('never returns more reasons than exist', () => {
    expect(mainReasons(excluded).length).toBeLessThanOrEqual(excluded.reasons.length);
  });
});

describe('findForbiddenScorePhrasing', () => {
  it.each([
    'Dere har 94 prosent sannsynlighet for å vinne dette anbudet.',
    'Garantert treff på profilen din.',
    'Dere bør definitivt levere tilbud her.',
    'Dette anbudet vil dere vinne.',
    'Høy vinnersannsynlighet.',
  ])('flags the forbidden phrasing in %s', (text) => {
    expect(findForbiddenScorePhrasing(text).length).toBeGreaterThan(0);
  });

  it.each([
    'Høy relevans.',
    'Sterkt samsvar med varslingsprofilen.',
    'Verdt å undersøke.',
    'Mulig treff.',
    'Treff med lav sikkerhet.',
  ])('accepts the approved phrasing %s', (text) => {
    expect(findForbiddenScorePhrasing(text)).toEqual([]);
  });

  it('does not flag the score disclaimer, whose job is to deny the claim', () => {
    expect(findForbiddenScorePhrasing(SCORE_DISCLAIMER_NB)).toEqual([]);
  });

  it('still flags a forbidden phrase that sits next to the disclaimer', () => {
    const text = `${SCORE_DISCLAIMER_NB} Men dere bør definitivt levere tilbud.`;
    expect(findForbiddenScorePhrasing(text)).toContain('bør definitivt levere');
  });

  it('finds nothing in any explanation the engine produces', () => {
    for (const { tender, profile } of GOLDEN_CASES) {
      const explanation = explainMatch(matchTender(tender, profile, { now }));
      expect(findForbiddenScorePhrasing(explanation.text)).toEqual([]);
    }
  });
});
