import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { matchTender } from './engine.js';
import { CLEANING_PROFILE, CLEANING_FRAMEWORK, FIXED_NOW } from './testing/fixtures.js';

/**
 * The service model's acceptance criterion 4, as a property of the build:
 * **no match may be traceable to a sector assumption the system made on the
 * user's behalf.**
 *
 * A cleaning company competes with other cleaning companies and sells to
 * hospitals, schools, municipalities and the armed forces. Its "industry" is
 * the competitors; its customers are everyone else. Any narrowing on the buyer
 * side that the user did not ask for destroys the match quality for exactly
 * this kind of supplier, and destroys it invisibly — the tenders simply never
 * arrive, and nothing in the product says why.
 *
 * Two things are checked, because the assumption can enter in two ways.
 *
 * The first is behavioural: with the buyer fields empty, tenders from wildly
 * different kinds of buyer must all match. The second is structural: the
 * engine must not be able to see the fields that would let it infer a sector
 * at all. `supplierForm` in particular exists only to weight onboarding and to
 * group analysis; the model states outright that it never affects matching, so
 * the engine should not be able to read it even by accident.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Identifiers naming what a supplier *is* rather than what a tender *contains*.
 *
 * The engine's inputs are a tender and a profile's stated criteria. Anything
 * here would be a claim about the supplier's identity or the buyer's sector,
 * which is precisely what must not influence a score.
 */
const BANNED_IDENTIFIERS = [
  'supplierForm',
  'serviceCategory',
  'serviceTemplateId',
  'industryTemplateId',
  'sectorBound',
  'crossSector',
  'buyerSector',
  'buyerType',
  'nace',
  'naceCode',
];

describe('no sector assumptions reach the matching engine', () => {
  it('does not read any identifier naming a supplier identity or buyer sector', () => {
    const files = readdirSync(HERE).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      // Comments are allowed to explain the rule; code may not implement it.
      const source = readFileSync(join(HERE, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const identifier of BANNED_IDENTIFIERS) {
        expect(
          source.toLowerCase(),
          `${file} references ${identifier} — the engine must not know what the supplier is, only what the tender contains`,
        ).not.toContain(identifier.toLowerCase());
      }
    }
  });

  /**
   * Acceptance criterion 1, reduced to what the engine can answer.
   *
   * The full criterion is a journey — a cleaning company in Bergen sets a
   * geography and receives hits from hospitals, schools, municipalities and
   * state agencies without making a single buyer-side choice. The engine's part
   * of it is that an empty `buyerInclude` means every buyer qualifies, and that
   * changing only the buyer's name changes nothing about the score.
   */
  it('scores a tender identically whoever the buyer is, when the user named no buyer', () => {
    // Built explicitly rather than taken from the fixture. `CLEANING_PROFILE`
    // names a buyer, which is a perfectly legitimate profile — it is the
    // sector-bound form, where the user has chosen to narrow. The cross-sector
    // form is the one this test is about, and it is defined by those fields
    // being empty.
    const crossSector = { ...CLEANING_PROFILE, buyerInclude: [], buyerExclude: [] };

    const buyers = [
      'Helse Bergen HF',
      'Bergen kommune',
      'Universitetet i Bergen',
      'Forsvarsbygg',
      'Vestland fylkeskommune',
      'Skyss AS',
    ];

    const results = buyers.map((buyerName) =>
      matchTender({ ...CLEANING_FRAMEWORK, buyerName }, crossSector, { now: FIXED_NOW }),
    );

    const scores = new Set(results.map((result) => result.score));
    expect(
      scores.size,
      `the same cleaning contract scored differently depending on who was buying: ${[...scores].join(', ')}`,
    ).toBe(1);

    for (const result of results) {
      expect(result.included).toBe(true);
    }

    // And no reason may cite the buyer, since the user never mentioned one.
    // A reason is what the product shows to explain a match; a buyer reason
    // here would be the system taking credit for a judgement it did not make.
    for (const result of results) {
      expect(result.reasons.map((reason) => reason.type)).not.toContain('buyer');
    }
  });

  /**
   * The opposite direction, which is just as important: the model narrows the
   * buyer side only when the user asks. An exclusion the user *did* state must
   * still take effect, or "buyer filters are opt-in" would mean "buyer filters
   * do not work".
   */
  it('still honours a buyer exclusion the user stated themselves', () => {
    const withExclusion = {
      ...CLEANING_PROFILE,
      buyerInclude: [],
      buyerExclude: ['Bergen kommune'],
    };

    const excluded = matchTender(
      { ...CLEANING_FRAMEWORK, buyerName: 'Bergen kommune' },
      withExclusion,
      { now: FIXED_NOW },
    );
    const untouched = matchTender(
      { ...CLEANING_FRAMEWORK, buyerName: 'Helse Bergen HF' },
      withExclusion,
      { now: FIXED_NOW },
    );

    expect(excluded.included).toBe(false);
    expect(untouched.included).toBe(true);
  });
});
