import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateRange,
  formatDateTime,
  formatInteger,
  formatValueRange,
} from './format.js';

/**
 * Formatting is Oslo local time and Norwegian words. The winter/summer pair
 * below is the test that matters: a deadline shown an hour off is a deadline
 * the user can miss.
 */
describe('dates in Oslo time', () => {
  it('formats a winter date (UTC+1)', () => {
    expect(formatDateTime(new Date('2026-03-12T08:00:00.000Z'))).toBe('12. mars 2026 kl. 09:00');
  });

  it('formats a summer date (UTC+2)', () => {
    expect(formatDateTime(new Date('2026-07-01T08:00:00.000Z'))).toBe('1. juli 2026 kl. 10:00');
  });

  it('handles the hour that crosses midnight in Oslo', () => {
    expect(formatDateTime(new Date('2026-03-11T23:30:00.000Z'))).toBe('12. mars 2026 kl. 00:30');
  });

  it('formats a plain date', () => {
    expect(formatDate(new Date('2026-12-24T12:00:00.000Z'))).toBe('24. desember 2026');
  });
});

describe('date ranges', () => {
  it('collapses a range inside one month', () => {
    expect(
      formatDateRange(new Date('2026-03-02T07:00:00Z'), new Date('2026-03-08T07:00:00Z')),
    ).toBe('2.–8. mars 2026');
  });

  it('spells out both months when the range crosses one', () => {
    expect(
      formatDateRange(new Date('2026-02-26T07:00:00Z'), new Date('2026-03-04T07:00:00Z')),
    ).toBe('26. februar–4. mars 2026');
  });

  it('spells out both years when the range crosses one', () => {
    expect(
      formatDateRange(new Date('2025-12-29T07:00:00Z'), new Date('2026-01-04T07:00:00Z')),
    ).toBe('29. desember 2025–4. januar 2026');
  });
});

describe('numbers and values', () => {
  it('groups thousands with a space', () => {
    expect(formatInteger(1500000)).toBe('1 500 000');
    expect(formatInteger(999)).toBe('999');
    expect(formatInteger(1000)).toBe('1 000');
  });

  it('renders a value range', () => {
    expect(formatValueRange(1000000, 2000000)).toBe('1 000 000–2 000 000 NOK');
    expect(formatValueRange(1000000, 1000000)).toBe('1 000 000 NOK');
    expect(formatValueRange(1000000, undefined)).toBe('fra 1 000 000 NOK');
    expect(formatValueRange(undefined, 500000)).toBe('inntil 500 000 NOK');
  });

  it('returns undefined rather than inventing a value (spec section 4.5)', () => {
    expect(formatValueRange(undefined, undefined)).toBeUndefined();
  });
});
