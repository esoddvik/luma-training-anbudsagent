import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { industryTemplateSeedSchema, INDUSTRY_TEMPLATE_SEEDS } from './industry-templates.js';

/**
 * The core rule of the service model, made into a property of the build.
 *
 * A profile is defined by **what the business delivers**, never by which
 * industry it belongs to. The consequence is precise and it is the whole point:
 * for a great many suppliers the "industry" is the competitors, while the
 * customers are everyone else. A cleaning company competes with other cleaning
 * companies and sells to hospitals, schools, transit operators, museums and the
 * armed forces. The buyer's sector says nothing about whether a tender fits.
 *
 * So a template may narrow the **service** side — CPV codes and keywords — and
 * must never narrow the **buyer** side on the user's behalf. Buyer filters
 * exist on `AlertProfile`; they are the user's own explicit choice and start
 * empty.
 *
 * **Why this test rather than a comment.** The rule currently holds for a weak
 * reason: `industryTemplateSeedSchema` happens not to declare buyer-side
 * fields, so nobody could set one. That is an accident of the shape, not a
 * guarantee — the moment the seed type grows (and the service-template model
 * adds `serviceCategory`, `supplierForm` and `onboardingHint` to it), a
 * `buyerInclude` could be added alongside them and nothing would object. This
 * test objects.
 *
 * It checks the schema, the seed data and the source text, because each covers
 * a different way the rule can be broken: a field nobody populated yet, a
 * populated field, and a value smuggled in under a different name.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Fields that narrow who is buying rather than what is being bought.
 *
 * `noticeTypes` and `procedureTypes` are here for the same reason as the buyer
 * fields even though they are not literally about the buyer: a template that
 * restricted itself to, say, open procedures above the EEA threshold would be
 * encoding an assumption about which corner of the market the supplier plays
 * in. That is the user's call.
 */
const BUYER_SIDE_FIELDS = [
  'buyerInclude',
  'buyerExclude',
  'buyerTypes',
  'buyerOrganizationNumbers',
  'sectors',
  'noticeTypes',
  'procedureTypes',
];

describe('service templates never narrow the buyer side', () => {
  it('the seed schema declares no buyer-side field', () => {
    const declared = Object.keys(industryTemplateSeedSchema.shape);
    expect(declared.filter((field) => BUYER_SIDE_FIELDS.includes(field))).toEqual([]);
  });

  it('the seed schema rejects a buyer-side field rather than ignoring it', () => {
    // A schema that strips unknown keys would let a well-meaning editor add
    // `buyerInclude` to a seed and see no error, while the value silently
    // vanished. Failing loudly is what makes the first assertion meaningful.
    const withBuyerFilter = {
      ...INDUSTRY_TEMPLATE_SEEDS[0],
      buyerInclude: ['Helse Bergen HF'],
    };
    expect(industryTemplateSeedSchema.strict().safeParse(withBuyerFilter).success).toBe(false);
  });

  it('no seeded template carries a buyer-side value', () => {
    for (const seed of INDUSTRY_TEMPLATE_SEEDS) {
      const present = Object.keys(seed).filter((field) => BUYER_SIDE_FIELDS.includes(field));
      expect(present, `${seed.slug} narrows the buyer side`).toEqual([]);
    }
  });

  /**
   * The source scan catches the case the schema cannot: a buyer restriction
   * expressed as a CPV code or a keyword.
   *
   * CPV division 75 is public administration and defence services, 80 is
   * education, 85 is health and social work. A template including one of those
   * is describing the *customer*, not the service, and would quietly exclude
   * every other kind of buyer for that trade.
   */
  it('no template includes a CPV division that names a buyer sector', () => {
    const BUYER_SECTOR_DIVISIONS = ['75', '80', '85'];
    for (const seed of INDUSTRY_TEMPLATE_SEEDS) {
      for (const code of seed.cpvInclude) {
        const division = code.slice(0, 2);
        expect(
          BUYER_SECTOR_DIVISIONS,
          `${seed.slug} includes CPV ${code}, a buyer-sector division — that describes the customer, not the service`,
        ).not.toContain(division);
      }
    }
  });

  it('no template file mentions a buyer-side field at all', () => {
    const files = readdirSync(HERE).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    for (const file of files) {
      const source = readFileSync(join(HERE, file), 'utf8')
        // Comments may discuss the rule; code may not implement it.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const field of BUYER_SIDE_FIELDS) {
        expect(source, `${file} references ${field}`).not.toContain(field);
      }
    }
  });
});
