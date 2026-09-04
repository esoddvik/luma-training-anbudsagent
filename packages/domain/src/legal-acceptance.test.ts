import { describe, expect, it } from 'vitest';
import { isAcceptanceOutstanding } from './consent.js';

/**
 * Whether a user owes an acceptance (spec section 20.1, ADR-11).
 *
 * Extracted from `apps/core`'s `getLegalStatus` so `apps/web`'s gate cannot
 * answer this question differently from the API that reports it.
 */
describe('isAcceptanceOutstanding', () => {
  it('is outstanding when the accepted version is not the one in force', () => {
    expect(isAcceptanceOutstanding('2026-03', '2026-01-utkast')).toBe(true);
  });

  it('is settled when they match', () => {
    expect(isAcceptanceOutstanding('2026-03', '2026-03')).toBe(false);
  });

  it('is outstanding when nothing has been accepted', () => {
    expect(isAcceptanceOutstanding('2026-03', null)).toBe(true);
  });

  // The service must not lock everyone out because the table is empty. There
  // is nothing to accept, so nothing is owed.
  it('is not outstanding when no version is in force', () => {
    expect(isAcceptanceOutstanding(null, null)).toBe(false);
    expect(isAcceptanceOutstanding(null, '2026-01-utkast')).toBe(false);
  });
});
