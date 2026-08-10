import { describe, expect, it } from 'vitest';
import { SERVICE_TEMPLATE_SEEDS } from '@luma/content';
import { tradeMonogram } from './trade-monogram';

/**
 * The uniqueness test runs against `SERVICE_TEMPLATE_SEEDS` on purpose, not
 * against a fixture.
 *
 * A fixture would let a ninth template ship with a colliding mark and leave
 * this file green — the collision that existed before («Bygg og anlegg,
 * utførende» and «Bemanning og rekruttering» both rendered BO) was exactly
 * that kind: nothing was wrong with the function in the abstract, it was wrong
 * about the names we actually have. Reading the real seeds is what makes the
 * suite fail when the content changes under it.
 */
describe('tradeMonogram', () => {
  it('gives every seeded template a distinct mark', () => {
    const byMonogram = new Map<string, string[]>();
    for (const seed of SERVICE_TEMPLATE_SEEDS) {
      const monogram = tradeMonogram(seed.name);
      byMonogram.set(monogram, [...(byMonogram.get(monogram) ?? []), seed.name]);
    }

    const collisions = [...byMonogram.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([monogram, names]) => `${monogram}: ${names.join(' / ')}`);

    expect(collisions).toEqual([]);
    // Guards the guard: if the seeds were ever empty, the assertion above
    // would pass over nothing at all.
    expect(byMonogram.size).toBe(SERVICE_TEMPLATE_SEEDS.length);
  });

  it('reads the words that carry the name, not the conjunction', () => {
    // The two names that used to collide, and what they say now.
    expect(tradeMonogram('Bygg og anlegg, utførende')).toBe('BA');
    expect(tradeMonogram('Bemanning og rekruttering')).toBe('BR');
  });

  it('gives a one-word name a single letter rather than a padded one', () => {
    expect(tradeMonogram('Rådgivende ingeniørtjenester')).toBe('RI');
    expect(tradeMonogram('Renhold')).toBe('R');
  });

  it('uppercases with Norwegian casing and ignores leading punctuation', () => {
    expect(tradeMonogram('  økonomi- og  «lønnstjenester» ')).toBe('ØL');
  });
});
