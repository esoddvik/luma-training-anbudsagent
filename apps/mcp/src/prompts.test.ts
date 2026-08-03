import { describe, expect, it } from 'vitest';
import { findPrompt, LUMA_PROMPTS } from './prompts.js';

const ARGS = { tenderId: '2026-112541', profileId: 'profil-1' };

describe('the prompt set', () => {
  it('exposes exactly the three prompts spec 34 lists', () => {
    expect(LUMA_PROMPTS.map((p) => p.name)).toEqual([
      'review_tender_opportunity',
      'compare_tender_to_profile',
      'prepare_bid_no_bid_meeting',
    ]);
  });

  it('has a unique name per prompt', () => {
    const names = LUMA_PROMPTS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe.each(LUMA_PROMPTS)('prompt $name', (prompt) => {
  const rendered = prompt.render(ARGS);

  it('substitutes its arguments', () => {
    for (const argument of prompt.argumentNames) {
      expect(rendered).toContain(ARGS[argument as keyof typeof ARGS]);
    }
  });

  it('still renders when an argument is missing, rather than printing undefined', () => {
    // A client may invoke a prompt without filling every argument. Leaking
    // the string "undefined" into the model's instructions is worse than a
    // gap, because the model will try to interpret it.
    expect(prompt.render({})).not.toContain('undefined');
  });

  it('directs the model to the structured tools rather than to memory', () => {
    // Spec 34: prompts must use structured tool results. Without this the
    // model answers from training data and invents deadlines and values.
    expect(rendered).toMatch(/get_tender|explain_tender_match|get_alert_profile/);
  });

  it('forbids stating a win probability', () => {
    expect(rendered).toMatch(/[Ii]kke oppgi sannsynlighet for å vinne/);
  });

  it('leaves the bid decision with the user', () => {
    expect(rendered).toMatch(/brukerens|Ikke konkluder|la brukeren bestemme/i);
  });

  it('declares tender text untrusted and refuses embedded instructions', () => {
    // The prompt-injection boundary. A competition document is written by a
    // third party and reaches the model verbatim.
    expect(rendered).toMatch(/ubetrodd ekstern input/);
    expect(rendered).toMatch(/skal den ikke følges/);
  });

  it('carries no sales copy', () => {
    for (const forbidden of [/Påfyll/i, /webinar/i, /heldagskurs/i, /meld deg på/i, /kroner/i]) {
      expect(rendered, `${prompt.name} matches ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('is written in Norwegian', () => {
    expect(rendered).not.toMatch(/\b(you should|the following|please provide|summarize)\b/i);
    expect(prompt.description).not.toMatch(/\b(the|this|and the)\b/i);
  });

  it('uses none of the forbidden phrasings from spec 4.3', () => {
    for (const forbidden of [
      /garantert treff/i,
      /bør definitivt levere/i,
      /vil dere vinne/i,
      /\d+\s*prosent sannsynlighet/i,
    ]) {
      expect(rendered).not.toMatch(forbidden);
    }
  });
});

describe('individual prompt requirements', () => {
  it('review_tender_opportunity separates fact from assumption', () => {
    const rendered = findPrompt('review_tender_opportunity')!.render(ARGS);
    expect(rendered).toMatch(/Skill tydelig mellom det som står i kunngjøringen og det du antar/);
  });

  it('review_tender_opportunity handles a planned procurement explicitly', () => {
    const rendered = findPrompt('review_tender_opportunity')!.render(ARGS);
    expect(rendered).toMatch(/planlagt anskaffelse/i);
    expect(rendered).toMatch(/ikke er publisert ennå|ikke publisert ennå/);
  });

  it('review_tender_opportunity says the notice is not the competition documents', () => {
    // The most common misreading: a user assumes award criteria are in the
    // notice, when they are in the konkurransegrunnlag.
    const rendered = findPrompt('review_tender_opportunity')!.render(ARGS);
    expect(rendered).toMatch(/konkurransegrunnlaget, ikke i kunngjøringen/);
  });

  it('compare_tender_to_profile refuses to change the profile itself', () => {
    // Spec 31: profiles are not modified without an explicit request.
    const rendered = findPrompt('compare_tender_to_profile')!.render(ARGS);
    expect(rendered).toMatch(/Ikke endre profilen/);
  });

  it('compare_tender_to_profile states that exclusion beats inclusion', () => {
    const rendered = findPrompt('compare_tender_to_profile')!.render(ARGS);
    expect(rendered).toMatch(/Eksklusjon slår alltid inkludering/);
  });

  it('prepare_bid_no_bid_meeting demands arguments on both sides', () => {
    // A decision pack that only argues one way is advocacy, not preparation.
    const rendered = findPrompt('prepare_bid_no_bid_meeting')!.render(ARGS);
    expect(rendered).toMatch(/Argumenter for å levere/);
    expect(rendered).toMatch(/Argumenter for ikke å levere/);
    expect(rendered).toMatch(/Begge listene skal være ekte/);
  });

  it('prepare_bid_no_bid_meeting raises the opportunity cost', () => {
    const rendered = findPrompt('prepare_bid_no_bid_meeting')!.render(ARGS);
    expect(rendered).toMatch(/alternativkostnad/i);
  });
});

describe('findPrompt', () => {
  it('finds a prompt by name', () => {
    expect(findPrompt('review_tender_opportunity')?.title).toBe('Førstevurdering av et anbud');
  });

  it('returns undefined for an unknown name', () => {
    expect(findPrompt('nope')).toBeUndefined();
  });
});
