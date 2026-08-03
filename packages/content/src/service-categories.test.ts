import { describe, expect, it } from 'vitest';
import {
  findServiceCategory,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_KEYS,
  serviceCategorySchema,
} from './service-categories.js';

/**
 * The service category keys are a public, permanent vocabulary.
 *
 * Every count, trend and demand map in the product groups on these strings.
 * Renaming one does not move a series — it *ends* one series and starts
 * another, with no marker anywhere that a break happened, and the numbers
 * still look plausible afterwards. That is why this is a pinned list rather
 * than a shape check: a shape check would happily accept
 * `renhold-og-fm` in place of `renhold-og-facility-management` and the
 * damage would surface months later as an unexplained cliff in a report.
 *
 * **Adding a category is expected and does not need this test changed** for
 * the wrong reason — the added key goes on the end of `PINNED_KEYS` in the
 * same commit, which is the moment to ask whether it is really new or is a
 * rename of something already here.
 */

/**
 * The key set as of ADR-17. Append only.
 *
 * A key removed or renamed here must be a deliberate, separately argued
 * decision with a migration for the historical rows that carry it — not a
 * tidy-up.
 */
const PINNED_KEYS = [
  'bygg-og-anlegg',
  'prosjektering-og-radgivning',
  'tekniske-installasjoner',
  'drift-og-vedlikehold-av-eiendom',
  'renhold-og-facility-management',
  'avfall-og-gjenvinning',
  'vann-og-avlop',
  'energi-og-kraft',
  'it-tjenester',
  'konsulentbistand-og-ledelse',
  'kommunikasjon-og-marked',
  'bemanning-og-rekruttering',
  'vakthold-og-sikkerhet',
  'kantine-og-matservering',
  'transport-og-logistikk',
  'kjoretoy-og-maskiner',
  'moblering-og-inventar',
  'medisinsk-utstyr-og-forbruksmateriell',
  'opplaering-og-kompetanse',
  'helse-og-omsorgstjenester',
];

describe('service category keys are stable forever', () => {
  it('still contains every pinned key', () => {
    const present = new Set(SERVICE_CATEGORY_KEYS);
    const missing = PINNED_KEYS.filter((key) => !present.has(key));
    expect(
      missing,
      `these category keys were removed or renamed: ${missing.join(', ')}. ` +
        'A key is the grouping column for every time series in the product; renaming one ' +
        'silently rebases its history. Add a new category instead, or migrate the stored ' +
        'values deliberately and update PINNED_KEYS in the same commit.',
    ).toEqual([]);
  });

  it('keeps the pinned keys in their original order', () => {
    // Order is not cosmetic: it is the order categories are offered in, and a
    // reorder that arrives with a rename is how a rename gets mistaken for a
    // reshuffle in review.
    expect(SERVICE_CATEGORY_KEYS.slice(0, PINNED_KEYS.length)).toEqual(PINNED_KEYS);
  });

  it('adds new categories on the end rather than in the middle', () => {
    expect(SERVICE_CATEGORY_KEYS.length).toBeGreaterThanOrEqual(PINNED_KEYS.length);
  });
});

describe('the service category list', () => {
  it('is an editorial list, not a taxonomy: flat and small enough to choose from', () => {
    // Below fifteen the categories stop distinguishing anything; above
    // twenty-five a supplier cannot find itself in the list, which is the
    // failure that pushes people to pick "other" and ruins the segmentation.
    expect(SERVICE_CATEGORIES.length).toBeGreaterThanOrEqual(15);
    expect(SERVICE_CATEGORIES.length).toBeLessThanOrEqual(25);
  });

  it('has a unique key per category', () => {
    expect(new Set(SERVICE_CATEGORY_KEYS).size).toBe(SERVICE_CATEGORY_KEYS.length);
  });

  it('has a unique label per category', () => {
    const labels = SERVICE_CATEGORIES.map((category) => category.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('satisfies its schema', () => {
    for (const category of SERVICE_CATEGORIES) {
      expect(serviceCategorySchema.parse(category)).toBeDefined();
    }
  });

  it('names each category the way a Norwegian supplier would, not in CPV jargon', () => {
    for (const category of SERVICE_CATEGORIES) {
      expect(category.label, `${category.key} reads as a code, not a trade`).not.toMatch(
        /\d{4}|CPV/,
      );
    }
  });

  it('records where each cut came from, so the editor reviewing it can argue with it', () => {
    for (const category of SERVICE_CATEGORIES) {
      expect(category.cpvProvenance, `${category.key} has no provenance`).toMatch(/CPV/);
    }
  });
});

describe('findServiceCategory', () => {
  it('finds a category by key', () => {
    expect(findServiceCategory('renhold-og-facility-management')?.label).toBe(
      'Renhold og facility management',
    );
  });

  it('returns undefined for an unknown key', () => {
    expect(findServiceCategory('ikke-en-kategori')).toBeUndefined();
  });
});
