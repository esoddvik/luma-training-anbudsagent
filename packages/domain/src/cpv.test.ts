import { describe, expect, it } from 'vitest';
import {
  cpvDepth,
  findCoveringCpvCodes,
  findCpvOverlaps,
  isCpvDescendantOf,
  isValidCpv,
  normalizeCpv,
  parseCpv,
} from './cpv.js';

describe('parseCpv', () => {
  it('accepts a bare eight-digit code', () => {
    expect(parseCpv('45000000')).toEqual({ digits: '45000000' });
  });

  it('accepts a code with a check digit and keeps it separate', () => {
    expect(parseCpv('45213316-1')).toEqual({ digits: '45213316', checkDigit: '1' });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseCpv('  45000000 ')?.digits).toBe('45000000');
  });

  it.each(['4500000', '450000000', '45000000-', 'abcdefgh', '', '45000000-12'])(
    'rejects the malformed code %s',
    (code) => {
      expect(parseCpv(code)).toBeNull();
      expect(isValidCpv(code)).toBe(false);
    },
  );
});

describe('normalizeCpv', () => {
  it('drops the check digit so codes compare consistently', () => {
    expect(normalizeCpv('45213316-1')).toBe('45213316');
  });

  it('returns null for an invalid code rather than a partial string', () => {
    expect(normalizeCpv('nonsense')).toBeNull();
  });
});

describe('cpvDepth', () => {
  it.each([
    ['45000000', 2],
    ['45200000', 3],
    ['45210000', 4],
    ['45213316', 8],
    ['45213316-1', 8],
  ])('reports depth %s as %i', (code, expected) => {
    expect(cpvDepth(code)).toBe(expected);
  });

  it('is zero for an invalid code', () => {
    expect(cpvDepth('bad')).toBe(0);
  });
});

describe('isCpvDescendantOf', () => {
  it('matches a code against itself', () => {
    expect(isCpvDescendantOf('45000000', '45000000')).toBe(true);
  });

  it('matches a specific tender code against a broad profile code', () => {
    expect(isCpvDescendantOf('45213316', '45000000')).toBe(true);
  });

  it('matches through an intermediate level', () => {
    expect(isCpvDescendantOf('45213316', '45210000')).toBe(true);
  });

  it('does not match a broad tender code against a specific profile code', () => {
    // A profile asking specifically for 45213316 should not be alerted about
    // every construction tender.
    expect(isCpvDescendantOf('45000000', '45213316')).toBe(false);
  });

  it('does not match across sibling branches', () => {
    expect(isCpvDescendantOf('45213316', '90000000')).toBe(false);
  });

  it('ignores check digits on either side', () => {
    expect(isCpvDescendantOf('45213316-1', '45000000-7')).toBe(true);
  });

  it('is false when either code is invalid', () => {
    expect(isCpvDescendantOf('bad', '45000000')).toBe(false);
    expect(isCpvDescendantOf('45000000', 'bad')).toBe(false);
  });

  it('does not treat a shared numeric prefix as a hierarchy match', () => {
    // 45210000 and 45213316 share a prefix, but 45213316 is not an ancestor.
    expect(isCpvDescendantOf('45210000', '45213316')).toBe(false);
  });
});

describe('findCoveringCpvCodes', () => {
  it('returns the most specific covering code first', () => {
    expect(findCoveringCpvCodes('45213316', ['45000000', '45210000'])).toEqual([
      '45210000',
      '45000000',
    ]);
  });

  it('returns an empty list when nothing covers the code', () => {
    expect(findCoveringCpvCodes('45213316', ['90000000'])).toEqual([]);
  });
});

describe('findCpvOverlaps', () => {
  it('pairs every tender code with every covering profile code', () => {
    const overlaps = findCpvOverlaps(['45213316', '71300000'], ['45000000', '71300000']);
    expect(overlaps).toEqual([
      { tenderCode: '71300000', profileCode: '71300000', specificity: 3 },
      { tenderCode: '45213316', profileCode: '45000000', specificity: 2 },
    ]);
  });

  it('is empty when the profile has no codes', () => {
    expect(findCpvOverlaps(['45213316'], [])).toEqual([]);
  });

  it('is empty when the tender has no codes', () => {
    expect(findCpvOverlaps([], ['45000000'])).toEqual([]);
  });
});
