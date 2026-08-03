import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  formatRatio,
  meetsContrast,
  parseHexColor,
  relativeLuminance,
  requiredRatio,
  WCAG_AA_LARGE_TEXT,
  WCAG_AA_NON_TEXT,
  WCAG_AA_TEXT,
} from './contrast.js';

describe('parseHexColor', () => {
  it('parses six-digit hex', () => {
    expect(parseHexColor('#14508f')).toEqual({ r: 0x14, g: 0x50, b: 0x8f });
  });

  it('expands three-digit shorthand', () => {
    expect(parseHexColor('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });

  it('is case insensitive and tolerates surrounding whitespace', () => {
    expect(parseHexColor('  #FFFFFF ')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it.each(['ffffff', '#ff', '#fffff', '#gggggg', '', 'rgb(0,0,0)'])('rejects %o', (input) => {
    expect(() => parseHexColor(input)).toThrow(/hex/i);
  });
});

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 10);
  });

  it('weights green most heavily', () => {
    const green = relativeLuminance({ r: 0, g: 255, b: 0 });
    const red = relativeLuminance({ r: 255, g: 0, b: 0 });
    const blue = relativeLuminance({ r: 0, g: 0, b: 255 });
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
  });
});

describe('contrastRatio', () => {
  it('gives 21:1 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('gives 1:1 for a colour against itself', () => {
    expect(contrastRatio('#14507f', '#14507f')).toBeCloseTo(1, 10);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#767676'),
      10,
    );
  });

  it('matches the known WCAG boundary case #767676 on white', () => {
    // #767676 is the canonical lightest grey that still clears 4.5:1 on white.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
  });
});

describe('requiredRatio', () => {
  it('maps each kind to its WCAG AA threshold', () => {
    expect(requiredRatio('text')).toBe(WCAG_AA_TEXT);
    expect(requiredRatio('large-text')).toBe(WCAG_AA_LARGE_TEXT);
    expect(requiredRatio('non-text')).toBe(WCAG_AA_NON_TEXT);
  });
});

describe('meetsContrast', () => {
  // These two cases are the proof that the checker can fail. If either flips,
  // the token suite below is measuring nothing.
  it('rejects a deliberately bad pair', () => {
    expect(meetsContrast('#bbbbbb', '#ffffff', 'text')).toBe(false);
    expect(meetsContrast('#bbbbbb', '#ffffff', 'non-text')).toBe(false);
  });

  it('accepts a deliberately good pair', () => {
    expect(meetsContrast('#14181f', '#ffffff', 'text')).toBe(true);
  });

  it('applies the looser threshold to large text', () => {
    // ~3.9:1 — fails as body text, passes as large text.
    expect(meetsContrast('#8a8a8a', '#ffffff', 'text')).toBe(false);
    expect(meetsContrast('#8a8a8a', '#ffffff', 'large-text')).toBe(true);
  });
});

describe('formatRatio', () => {
  it('renders two decimals without rounding up past the threshold', () => {
    expect(formatRatio(4.499)).toBe('4.49:1');
    expect(formatRatio(21)).toBe('21.00:1');
  });
});
