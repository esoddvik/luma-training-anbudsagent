import { describe, expect, it } from 'vitest';
import { EDITORIAL_SEEDS, FORBIDDEN_PROMOTION_PHRASES } from './editorial-seeds.js';

describe('the editorial seed set', () => {
  it('has a unique slug per recommendation', () => {
    const slugs = EDITORIAL_SEEDS.map((seed) => seed.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('covers every rung of the promotion ladder (spec 23.1)', () => {
    const levels = new Set(EDITORIAL_SEEDS.map((seed) => seed.ladderLevel));
    expect([...levels].sort()).toEqual([1, 2, 3, 4]);
  });

  it('offers free content at the entry rung, which is the default for new users', () => {
    const entry = EDITORIAL_SEEDS.filter((seed) => seed.ladderLevel === 1);
    expect(entry.length).toBeGreaterThan(0);
    expect(entry.every((seed) => !seed.isPaid)).toBe(true);
  });

  it('makes Påfyll the paid newsletter at rung two', () => {
    const paafyll = EDITORIAL_SEEDS.find((seed) => seed.slug === 'paafyll');
    expect(paafyll).toMatchObject({ ladderLevel: 2, marketingCategory: 'paid_newsletter' });
  });
});

describe('regional routing (spec 23.2)', () => {
  it('restricts the Oslo full-day course to the Oslo region', () => {
    const course = EDITORIAL_SEEDS.find((seed) => seed.slug === 'heldagskurs-vinn-flere-anbud');
    expect(course?.regionScope).toBe('oslo_region');
  });

  it('scopes every top-rung item regionally, since rung four is the Oslo course', () => {
    for (const seed of EDITORIAL_SEEDS.filter((s) => s.ladderLevel === 4)) {
      expect(seed.regionScope, `${seed.slug} is national at ladder level 4`).toBe('oslo_region');
    }
  });

  it('keeps a national alternative available at the middle rung', () => {
    // A user outside Oslo must still have something to be shown, or regional
    // routing turns into no promotion at all for most of the country.
    const national = EDITORIAL_SEEDS.filter(
      (seed) => seed.ladderLevel === 3 && seed.regionScope === 'national',
    );
    expect(national.length).toBeGreaterThan(0);
  });
});

describe.each(EDITORIAL_SEEDS)('recommendation $slug', (seed) => {
  it('links to an https URL', () => {
    expect(() => new URL(seed.url)).not.toThrow();
    expect(new URL(seed.url).protocol).toBe('https:');
  });

  it('uses no artificial scarcity, false urgency or overblown promise', () => {
    const copy = `${seed.title} ${seed.description}`;
    for (const forbidden of FORBIDDEN_PROMOTION_PHRASES) {
      expect(copy, `${seed.slug} matches ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('never claims a purchase is required', () => {
    const copy = `${seed.title} ${seed.description}`.toLowerCase();
    expect(copy).not.toMatch(/du m[åa] kj[øo]pe|kreves for [åa]|uten dette kan du ikke/);
  });

  it('tells the reader what a paid offer costs, or where to find out', () => {
    // Spec 23.4: a paid offer must be labelled as paid. Naming the price is
    // the honest version of that. Where a third party sets the price (the NHO
    // course), saying where to find it is the honest alternative to either
    // silence or a number we do not control.
    if (!seed.isPaid) return;
    const statesPrice = /kroner|kr\b|eks\. mva/i.test(seed.description);
    const pointsAtPrice = /pris .*(hos|finner du|se )/i.test(seed.description);
    expect(
      statesPrice || pointsAtPrice,
      `${seed.slug} is paid but neither states a price nor says where to find one`,
    ).toBe(true);
  });

  it('is written in Norwegian', () => {
    expect(`${seed.title} ${seed.description}`).not.toMatch(
      /\b(the|your|free trial|sign up|learn more)\b/i,
    );
  });

  it('has a description long enough to be informative', () => {
    expect(seed.description.length).toBeGreaterThan(40);
  });
});

describe('the forbidden-phrase list itself', () => {
  it('actually catches the copy it is meant to catch', () => {
    // Guards against the list silently becoming inert through a bad regex.
    const bad = 'Siste sjanse! Kun i dag. Dette er nødvendig for å vinne, garantert.';
    const hits = FORBIDDEN_PROMOTION_PHRASES.filter((pattern) => pattern.test(bad));
    expect(hits.length).toBeGreaterThanOrEqual(4);
  });

  it('does not fire on ordinary, honest copy', () => {
    const good = 'Månedlig fagbrev om tilbudsarbeid. 395 kroner måneden eks. mva.';
    expect(FORBIDDEN_PROMOTION_PHRASES.filter((pattern) => pattern.test(good))).toEqual([]);
  });
});
