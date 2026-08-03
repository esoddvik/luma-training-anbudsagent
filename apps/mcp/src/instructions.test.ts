import { describe, expect, it } from 'vitest';
import { SERVER_INFO, SERVER_INSTRUCTIONS_NB } from './instructions.js';

describe('server instructions', () => {
  it('states that the score is not a win probability (spec 31)', () => {
    expect(SERVER_INSTRUCTIONS_NB).toMatch(/ikke en sannsynlighet for å vinne/i);
  });

  it('requires the source link to be shown', () => {
    expect(SERVER_INSTRUCTIONS_NB).toMatch(/kildelenke/i);
  });

  it('says summaries are not legal advice', () => {
    expect(SERVER_INSTRUCTIONS_NB).toMatch(/ikke juridisk rådgivning/i);
  });

  it('forbids changing a profile without an explicit request', () => {
    expect(SERVER_INSTRUCTIONS_NB).toMatch(/uttrykkelig/i);
  });

  it('marks Luma resources as optional and never automatic', () => {
    expect(SERVER_INSTRUCTIONS_NB).toMatch(/valgfrie/i);
    expect(SERVER_INSTRUCTIONS_NB).toMatch(/aldri automatisk/i);
  });

  it('keeps marketing separate from tender data', () => {
    expect(SERVER_INSTRUCTIONS_NB).toMatch(/markedsføring atskilt/i);
  });

  it('declares tender text untrusted and refuses embedded instructions', () => {
    // The prompt-injection boundary: a competition document is data, and an
    // instruction inside one must never be followed as a system instruction.
    expect(SERVER_INSTRUCTIONS_NB).toMatch(/ubetrodd ekstern input/i);
    expect(SERVER_INSTRUCTIONS_NB).toMatch(/aldri følges som systeminstruksjoner/i);
  });

  it('leaves the bid/no-bid decision with the user', () => {
    expect(SERVER_INSTRUCTIONS_NB).toMatch(/brukerens jobb/i);
  });

  it('is written in Norwegian, with no untranslated English sentence', () => {
    expect(SERVER_INSTRUCTIONS_NB).not.toMatch(/\b(the|this server|you should|please)\b/i);
  });

  it('uses none of the forbidden win-probability phrasings (spec 4.3)', () => {
    for (const forbidden of [
      /garantert treff/i,
      /bør definitivt levere/i,
      /vil dere vinne/i,
      /\d+\s*prosent sannsynlighet for å vinne/i,
    ]) {
      expect(SERVER_INSTRUCTIONS_NB).not.toMatch(forbidden);
    }
  });
});

describe('server info', () => {
  it('identifies the service by a stable machine name', () => {
    expect(SERVER_INFO.name).toBe('luma-anbudsvarsling');
  });
});
