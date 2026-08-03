import { describe, expect, it } from 'vitest';
import { noticeCategorySchema } from '@luma/domain';
import { DOMAIN_ENUM_PAIRS } from './enum-parity.js';
import { noticeCategoryEnum } from './enums.js';

/**
 * The runtime half of the enum parity check. The compile-time half, and the
 * reasoning behind having both, lives in `enum-parity.ts`.
 *
 * No database required.
 */
describe('pgEnum parity with @luma/domain', () => {
  it.each(DOMAIN_ENUM_PAIRS)('$name matches its Zod enum exactly, in order', ({ pg, zod }) => {
    // `toEqual` on arrays compares order too, which is the point: PostgreSQL
    // enums are ordered, and `ORDER BY status` uses declaration order.
    expect(pg).toEqual(zod);
  });

  it('has a case for every domain-backed enum declared in enums.ts', () => {
    // A guard against the pair list quietly falling behind the enum file.
    expect(DOMAIN_ENUM_PAIRS).toHaveLength(21);
    expect(new Set(DOMAIN_ENUM_PAIRS.map((pair) => pair.name)).size).toBe(DOMAIN_ENUM_PAIRS.length);
  });

  it('would fail if a value were added on only one side', () => {
    // Proof that the comparison above can go red — it is not two references to
    // the same array.
    const tampered = [...noticeCategoryEnum.enumValues, 'framework'];
    expect(tampered).not.toEqual(noticeCategorySchema.options);
    expect(noticeCategoryEnum.enumValues).toEqual(noticeCategorySchema.options);
  });
});
