import { describe, expect, it } from 'vitest';
import { findResource, LUMA_RESOURCES } from './resources.js';

describe('the resource set', () => {
  it('exposes exactly the URIs spec 33 lists, minus the ones deferred', () => {
    expect(LUMA_RESOURCES.map((r) => r.uri)).toEqual([
      'luma://playbook/fase-1-utvelgelse',
      'luma://playbook/fase-2-krav-og-oppdragsforstaelse',
      'luma://methodology/bid-no-bid',
      'luma://service/about',
      'luma://service/match-scoring',
      'luma://service/begrensninger',
    ]);
  });

  it('has a unique URI per resource', () => {
    const uris = LUMA_RESOURCES.map((r) => r.uri);
    expect(new Set(uris).size).toBe(uris.length);
  });

  it('names the playbook phases so course alumni recognise the method', () => {
    // Spec 4.6 and 33: the naming is a product decision, not decoration.
    const playbook = LUMA_RESOURCES.filter((r) => r.uri.startsWith('luma://playbook/'));
    expect(playbook.map((r) => r.uri)).toContain('luma://playbook/fase-1-utvelgelse');
    expect(playbook.map((r) => r.uri)).toContain(
      'luma://playbook/fase-2-krav-og-oppdragsforstaelse',
    );
  });

  it('exposes no private course material', () => {
    // Spec 33 forbids exposing the paid prompt library without an entitlement.
    for (const resource of LUMA_RESOURCES) {
      expect(resource.uri).not.toMatch(/promptbibliotek|prompt-library|kursmateriell/i);
    }
  });
});

describe.each(LUMA_RESOURCES)('resource $name', (resource) => {
  it('uses the luma:// scheme', () => {
    expect(resource.uri.startsWith('luma://')).toBe(true);
  });

  it('is markdown with real content', () => {
    expect(resource.mimeType).toBe('text/markdown');
    expect(resource.text.length).toBeGreaterThan(400);
  });

  it('starts with a heading', () => {
    expect(resource.text.startsWith('# ')).toBe(true);
  });

  it('is written in Norwegian', () => {
    expect(resource.text).not.toMatch(/\b(the following|you should|this document|in order to)\b/i);
    expect(resource.description).not.toMatch(/\b(the|this|and the)\b/i);
  });

  it('contains no forbidden win-probability phrasing (spec 4.3)', () => {
    for (const forbidden of [
      /sannsynlighet for å vinne(?! er)/i,
      /garantert treff/i,
      /bør definitivt levere/i,
      /vil dere vinne/i,
    ]) {
      // "ikke en sannsynlighet for å vinne" is the approved denial and must
      // survive; the patterns above are the affirmative claims.
      const affirmative = resource.text.replace(/ikke en sannsynlighet for å vinne/gi, '');
      expect(affirmative, `${resource.name} matches ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('carries no sales copy', () => {
    // Spec 23.5: MCP tools must not automatically include promotional text.
    // These resources are the methodology, not the shop.
    //
    // The patterns target a call to action or a price, not the mere mention of
    // buying: "Anbudsdata holdes ikke tilbake for å presse frem kjøp" is a
    // promise not to sell, and a looser pattern flagged it as selling.
    for (const forbidden of [
      /\b\d[\d\s]*kroner\b/i,
      /\bkr\.?\s?\d/i,
      /\beks\. mva\b/i,
      /\bmeld deg på\b/i,
      /\bbestill\b/i,
      /\bkjøp (nå|kurset|abonnement)\b/i,
      /\bles mer om kurset\b/i,
    ]) {
      expect(resource.text, `${resource.name} matches ${forbidden}`).not.toMatch(forbidden);
    }
  });
});

describe('the resources that carry the trust contract', () => {
  it('states in the scoring resource that no commercial signal is included', () => {
    const scoring = findResource('luma://service/match-scoring');
    expect(scoring?.text).toMatch(/Ingen kommersielle signaler/i);
  });

  it('states that exclusion beats inclusion', () => {
    const scoring = findResource('luma://service/match-scoring');
    expect(scoring?.text).toMatch(/Eksklusjon slår alltid inkludering/i);
  });

  it('states that planned procurements are not penalised for lacking a deadline', () => {
    const scoring = findResource('luma://service/match-scoring');
    expect(scoring?.text).toMatch(/uten å trekke ned scoren/i);
  });

  it('reproduces all four known limitations from spec 5', () => {
    const limits = findResource('luma://service/begrensninger');
    expect(limits?.text).toMatch(/konkurransegjennomføringsverktøy/i);
    expect(limits?.text).toMatch(/terskelverdi/i);
    expect(limits?.text).toMatch(/TED/);
    expect(limits?.text).toMatch(/[Kk]ommunestyremøter/);
  });

  it('tells the user to follow the competition channel themselves', () => {
    // The most consequential limitation: missing a clarification because you
    // trusted this service to surface it would cost a real bid.
    const limits = findResource('luma://service/begrensninger');
    expect(limits?.text).toMatch(/[Ff]ølg alltid konkurransens egen kommunikasjonskanal/);
  });

  it('says the bid decision belongs to the user', () => {
    expect(findResource('luma://methodology/bid-no-bid')?.text).toMatch(
      /[Dd]ette er brukerens beslutning/,
    );
  });
});

describe('findResource', () => {
  it('finds a resource by URI', () => {
    expect(findResource('luma://service/about')?.name).toBe('service-about');
  });

  it('returns undefined for an unknown URI', () => {
    expect(findResource('luma://service/does-not-exist')).toBeUndefined();
  });
});
