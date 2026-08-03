import { describe, expect, it } from 'vitest';
import { makeProfile, makeTender } from '../testing/fixtures.js';
import { DEFAULT_MATCH_WEIGHTS } from '../weights.js';
import { scoreValue } from './value.js';

const weights = DEFAULT_MATCH_WEIGHTS;

describe('scoreValue', () => {
  it('does not apply when the tender states no value', () => {
    const reason = scoreValue(
      makeTender(),
      makeProfile({ estimatedValueMinNok: 1_000_000, estimatedValueMaxNok: 5_000_000 }),
      weights,
    );
    expect(reason).toBeNull();
  });

  it('does not apply when the profile states no value', () => {
    const reason = scoreValue(
      makeTender({ estimatedValueMinNok: 2_000_000 }),
      makeProfile(),
      weights,
    );
    expect(reason).toBeNull();
  });

  it('awards the whole budget when the tender fits inside the window', () => {
    const reason = scoreValue(
      makeTender({ estimatedValueMinNok: 2_000_000, estimatedValueMaxNok: 3_000_000 }),
      makeProfile({ estimatedValueMinNok: 1_000_000, estimatedValueMaxNok: 5_000_000 }),
      weights,
    );
    expect(reason?.contribution).toBe(weights.value);
    expect(reason?.label).toContain('innenfor');
  });

  it('scores a partial overlap below a full fit', () => {
    const reason = scoreValue(
      makeTender({ estimatedValueMinNok: 4_000_000, estimatedValueMaxNok: 9_000_000 }),
      makeProfile({ estimatedValueMinNok: 1_000_000, estimatedValueMaxNok: 5_000_000 }),
      weights,
    );
    expect(reason?.contribution).toBeGreaterThan(0);
    expect(reason?.contribution).toBeLessThan(weights.value);
    expect(reason?.label).toContain('overlapper delvis');
  });

  it('does not apply when the ranges do not overlap at all', () => {
    const reason = scoreValue(
      makeTender({ estimatedValueMinNok: 40_000_000 }),
      makeProfile({ estimatedValueMinNok: 1_000_000, estimatedValueMaxNok: 5_000_000 }),
      weights,
    );
    expect(reason).toBeNull();
  });

  it('treats a single stated figure as a point value', () => {
    const reason = scoreValue(
      makeTender({ estimatedValueMaxNok: 3_000_000 }),
      makeProfile({ estimatedValueMinNok: 1_000_000, estimatedValueMaxNok: 5_000_000 }),
      weights,
    );
    expect(reason?.label).toBe(
      'Anslått verdi 3 000 000 kr ligger innenfor verdiintervallet i profilen din',
    );
  });

  it('does not apply when the tender is priced in another currency', () => {
    // Doffin returns PLN amounts among the NOK ones and supplies no rate.
    const reason = scoreValue(
      makeTender({
        estimatedValueMinNok: 3_000_000,
        estimatedValueMaxNok: 3_000_000,
        currency: 'PLN',
      }),
      makeProfile({ estimatedValueMinNok: 1_000_000, estimatedValueMaxNok: 5_000_000 }),
      weights,
    );
    expect(reason).toBeNull();
  });

  it('applies when the currency is explicitly NOK', () => {
    const reason = scoreValue(
      makeTender({
        estimatedValueMinNok: 3_000_000,
        estimatedValueMaxNok: 3_000_000,
        currency: 'NOK',
      }),
      makeProfile({ estimatedValueMinNok: 1_000_000, estimatedValueMaxNok: 5_000_000 }),
      weights,
    );
    expect(reason?.contribution).toBe(weights.value);
  });

  it('handles the single scalar Doffin actually returns, mirrored into both bounds', () => {
    const reason = scoreValue(
      makeTender({ estimatedValueMinNok: 3_000_000, estimatedValueMaxNok: 3_000_000 }),
      makeProfile({ estimatedValueMinNok: 1_000_000, estimatedValueMaxNok: 5_000_000 }),
      weights,
    );
    expect(reason?.label).toContain('3 000 000 kr');
  });

  it('treats an open-ended profile window as unbounded above', () => {
    const reason = scoreValue(
      makeTender({ estimatedValueMinNok: 900_000_000 }),
      makeProfile({ estimatedValueMinNok: 1_000_000 }),
      weights,
    );
    expect(reason?.contribution).toBe(weights.value);
    expect(reason?.evidence[1]).toBe('Verdiintervall i profilen: fra 1 000 000 kr');
  });
});
