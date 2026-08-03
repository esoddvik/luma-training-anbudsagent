import { describe, expect, it } from 'vitest';
import { isCpvDescendantOf, normalizeCpv } from '@luma/domain';
import {
  findIndustryTemplate,
  INDUSTRY_TEMPLATE_SEEDS,
  industryTemplateSeedSchema,
} from './industry-templates.js';

describe('the industry template set', () => {
  it('covers the five segments named in spec 11.2', () => {
    expect(INDUSTRY_TEMPLATE_SEEDS).toHaveLength(5);
    expect(INDUSTRY_TEMPLATE_SEEDS.map((t) => t.slug)).toEqual([
      'bygg-og-anlegg',
      'radgivende-ingeniorer',
      'drift-renhold-og-fm',
      'tekniske-tjenester',
      'it-og-konsulenttjenester',
    ]);
  });

  it('has a unique slug per template', () => {
    const slugs = INDUSTRY_TEMPLATE_SEEDS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('has a unique sort order, so onboarding renders them deterministically', () => {
    const orders = INDUSTRY_TEMPLATE_SEEDS.map((t) => t.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

describe.each(INDUSTRY_TEMPLATE_SEEDS)('template $slug', (template) => {
  it('satisfies its schema', () => {
    expect(industryTemplateSeedSchema.parse(template)).toBeDefined();
  });

  it('uses well-formed CPV codes throughout', () => {
    for (const code of [...template.cpvInclude, ...template.cpvExclude]) {
      expect(normalizeCpv(code), `${code} is not a valid CPV code`).not.toBeNull();
    }
  });

  it('does not exclude a CPV code it also includes', () => {
    // A code on both lists is always a no-op that looks like a filter, because
    // exclusions override inclusions. It would silently blank the template.
    for (const excluded of template.cpvExclude) {
      for (const included of template.cpvInclude) {
        expect(
          included === excluded,
          `${template.slug} both includes and excludes ${included}`,
        ).toBe(false);
      }
    }
  });

  it('does not exclude an ancestor of one of its own included codes', () => {
    // The subtler version of the same mistake: excluding 45000000 while
    // including 45300000 removes every tender the template was meant to find.
    for (const excluded of template.cpvExclude) {
      for (const included of template.cpvInclude) {
        expect(
          isCpvDescendantOf(included, excluded),
          `${template.slug} excludes ${excluded}, which swallows its own ${included}`,
        ).toBe(false);
      }
    }
  });

  it('does not exclude a keyword it also includes', () => {
    const included = new Set(template.keywordsInclude.map((k) => k.toLowerCase()));
    for (const excluded of template.keywordsExclude) {
      expect(included.has(excluded.toLowerCase()), `${excluded} is on both lists`).toBe(false);
    }
  });

  it('gives enough keywords to be useful on day one', () => {
    expect(template.keywordsInclude.length).toBeGreaterThanOrEqual(8);
  });

  it('explains why its exclusions exist', () => {
    // Exclusions are invisible when they work: the user never sees what was
    // filtered out. An unexplained one will eventually be deleted by someone
    // who cannot tell whether it is deliberate.
    expect(template.exclusionRationale.length).toBeGreaterThan(40);
  });

  it('is written in Norwegian', () => {
    const prose = `${template.name} ${template.description} ${template.exclusionRationale}`;
    expect(prose).not.toMatch(/\b(the|and the|services for|this template)\b/i);
  });

  it('describes itself for a buyer of the trade, not in CPV jargon', () => {
    expect(template.description).toMatch(/^For /);
    expect(template.description).not.toMatch(/CPV/);
  });
});

describe('findIndustryTemplate', () => {
  it('finds a template by slug', () => {
    expect(findIndustryTemplate('bygg-og-anlegg')?.name).toBe('Bygg og anlegg');
  });

  it('returns undefined for an unknown slug', () => {
    expect(findIndustryTemplate('ikke-en-mal')).toBeUndefined();
  });
});
