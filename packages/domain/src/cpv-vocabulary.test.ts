import { describe, expect, it } from 'vitest';
import {
  CPV_VOCABULARY,
  cpvFamilyLabel,
  cpvFamilyOf,
  cpvLabel,
  EXPLICIT_BROAD_CPV,
  EXPLICIT_PRECISE_CPV,
  isBroadCpv,
  searchCpv,
} from './cpv-vocabulary.js';
import { normalizeCpv } from './cpv.js';

/**
 * The seed-coverage test — every CPV code in `SERVICE_TEMPLATE_SEEDS` resolves
 * to a name — deliberately does **not** live here. It needs `@luma/content`,
 * and `@luma/content` already depends on `@luma/domain`; adding the reverse
 * edge would make this package import from the workspace, which the module
 * note in `index.ts` says it must never do. That test is
 * `packages/content/src/cpv-vocabulary-covers-seeds.test.ts`.
 */

describe('CPV_VOCABULARY', () => {
  it('has no duplicate codes', () => {
    const codes = CPV_VOCABULARY.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('stores every code as eight normalised digits', () => {
    for (const entry of CPV_VOCABULARY) {
      expect(normalizeCpv(entry.code)).toBe(entry.code);
    }
  });

  it('gives every entry a name, a sentence and a group', () => {
    for (const entry of CPV_VOCABULARY) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.about.length).toBeGreaterThan(0);
      expect(entry.group.length).toBeGreaterThan(0);
    }
  });

  it('places every code under a parent that is also in the table', () => {
    // A picker groups by division, so an eight-digit code with no ancestor
    // here would render under a heading nothing else shares.
    const codes = new Set(CPV_VOCABULARY.map((entry) => entry.code));
    for (const entry of CPV_VOCABULARY) {
      const division = `${entry.code.slice(0, 2)}000000`;
      expect(codes.has(division), `${entry.code} has no division entry`).toBe(true);
    }
  });
});

describe('cpvLabel', () => {
  it('names a code that is in the vocabulary', () => {
    expect(cpvLabel('90910000')).toBe('Renholdstjenester');
  });

  it('accepts a code written with its check digit', () => {
    expect(cpvLabel('90910000-9')).toBe('Renholdstjenester');
  });

  it('returns an unknown code unchanged rather than guessing at a parent', () => {
    expect(cpvLabel('50411000')).toBe('50411000');
  });

  it('returns nonsense unchanged instead of throwing', () => {
    expect(cpvLabel('ikke en kode')).toBe('ikke en kode');
    expect(cpvLabel('')).toBe('');
  });
});

describe('isBroadCpv', () => {
  it('calls a division broad, because it covers a whole branch', () => {
    expect(isBroadCpv('45000000')).toBe(true);
    expect(isBroadCpv('90000000')).toBe(true);
    expect(isBroadCpv('60000000')).toBe(true);
  });

  it('calls a code below division level precise', () => {
    expect(isBroadCpv('90910000')).toBe(false);
    expect(isBroadCpv('90911200')).toBe(false);
    expect(isBroadCpv('79993000')).toBe(false);
  });

  it('honours the explicit list for codes the digits alone would miss', () => {
    // 98300000 «Diverse tjenester» is a group, not a division, so the depth
    // rule would call it precise. It is the code a buyer picks when none fits,
    // and it was qualifying advokattjenester and frisørmøbler for a cleaning
    // company's page. Meaning, not arithmetic, is why it is on the list.
    expect(isBroadCpv('98300000')).toBe(true);
    expect(isBroadCpv('79900000')).toBe(true);
  });

  it('lists the codes the relevance spec named', () => {
    for (const code of ['98300000', '79900000', '45000000', '85000000', '72000000']) {
      expect(EXPLICIT_BROAD_CPV, `${code} missing`).toContain(code);
    }
  });

  it('lets the precise list override the broad one and the depth rule', () => {
    // The escape hatch is empty today, so the property is asserted rather than
    // an example: nothing may sit on both lists, since one would silently win.
    const broad = new Set(EXPLICIT_BROAD_CPV);
    for (const code of EXPLICIT_PRECISE_CPV) {
      expect(isBroadCpv(code)).toBe(false);
      expect(broad.has(code), `${code} is on both lists`).toBe(false);
    }
  });

  it('accepts a check digit', () => {
    expect(isBroadCpv('45000000-7')).toBe(true);
    expect(isBroadCpv('90910000-9')).toBe(false);
  });

  it('calls nonsense precise rather than broad, and never throws', () => {
    // Suppressing a notice on the strength of a typo would be the worse error.
    expect(isBroadCpv('ikke en kode')).toBe(false);
    expect(isBroadCpv('')).toBe(false);
  });
});

describe('cpv families', () => {
  it('takes the first four digits', () => {
    expect(cpvFamilyOf('90911200')).toBe('9091');
    expect(cpvFamilyOf('90911200-9')).toBe('9091');
  });

  it('returns null for an unparseable code', () => {
    expect(cpvFamilyOf('ikke en kode')).toBeNull();
  });

  it('names a family from the table rather than repeating its digits', () => {
    expect(cpvFamilyLabel('9091')).toBe('Renholdstjenester');
    expect(cpvFamilyLabel('4500')).toBe('Bygge- og anleggsarbeid');
  });

  it('gives no name to a family outside the vocabulary', () => {
    // The caller's cue to leave the codes as separate rows. A row headed «CPV:
    // 5041» would be worse than no merge at all.
    expect(cpvFamilyLabel('5041')).toBeUndefined();
    expect(cpvFamilyLabel('90911200')).toBeUndefined();
    expect(cpvFamilyLabel('')).toBeUndefined();
  });
});

describe('searchCpv', () => {
  it('finds vinduspuss from the plain words a supplier would type', () => {
    // The design's own example: nothing in the official name contains this
    // phrase, so only the synonym list can carry it.
    const hits = searchCpv('vask av vinduer');
    expect(hits[0]?.code).toBe('90911300');
    expect(hits[0]?.name).toBe('Vinduspuss');
  });

  it('ignores case and Norwegian letters', () => {
    expect(searchCpv('VINDUSPUSS')[0]?.code).toBe('90911300');
    expect(searchCpv('måltidslevering')[0]?.code).toBe('55521200');
  });

  it('puts an exact code first', () => {
    expect(searchCpv('90911200')[0]?.code).toBe('90911200');
  });

  it('accepts a code prefix', () => {
    const hits = searchCpv('7962');
    expect(hits.map((entry) => entry.code)).toContain('79620000');
  });

  it('ranks a name match above a synonym-only match', () => {
    const hits = searchCpv('rekruttering');
    expect(hits[0]?.code).toBe('79600000');
  });

  it('returns nothing for an empty query rather than everything', () => {
    expect(searchCpv('')).toEqual([]);
    expect(searchCpv('   ')).toEqual([]);
  });

  it('returns nothing when no entry matches', () => {
    expect(searchCpv('kvasarfjord')).toEqual([]);
  });

  it('respects the limit', () => {
    expect(searchCpv('renhold', 2)).toHaveLength(2);
  });
});
