import { describe, expect, it } from 'vitest';
import { isCpvDescendantOf, normalizeCpv } from '@luma/domain';
import {
  findServiceTemplate,
  SERVICE_TEMPLATE_SEEDS,
  serviceTemplateSeedSchema,
} from './service-templates.js';
import { SERVICE_CATEGORY_KEYS } from './service-categories.js';

describe('the service template set', () => {
  it('covers the eight service templates named in the model (ADR-17)', () => {
    expect(SERVICE_TEMPLATE_SEEDS).toHaveLength(8);
    expect(SERVICE_TEMPLATE_SEEDS.map((t) => t.slug)).toEqual([
      'bygg-og-anlegg-utforende',
      'radgivende-ingeniortjenester',
      'renhold-og-facility-management',
      'it-tjenester-og-konsulentbistand',
      'drift-og-vedlikehold-av-eiendom',
      'vakthold-og-sikkerhet',
      'kantine-og-matservering',
      'bemanning-og-rekruttering',
    ]);
  });

  it('has a unique slug per template', () => {
    const slugs = SERVICE_TEMPLATE_SEEDS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('has a unique sort order, so onboarding renders them deterministically', () => {
    const orders = SERVICE_TEMPLATE_SEEDS.map((t) => t.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  /**
   * The cross-sector supplier is the hard case the model exists for, and it is
   * the majority here on purpose: cleaning, IT, property operations, security,
   * catering and staffing all sell the same service to any buyer. If this ever
   * inverts, someone has been classifying by industry again.
   */
  it('is mostly cross-sector, which is what the model predicts', () => {
    const crossSector = SERVICE_TEMPLATE_SEEDS.filter((t) => t.supplierForm === 'cross_sector');
    expect(crossSector.length).toBeGreaterThan(SERVICE_TEMPLATE_SEEDS.length / 2);
  });
});

describe.each(SERVICE_TEMPLATE_SEEDS)('template $slug', (template) => {
  it('satisfies its schema', () => {
    expect(serviceTemplateSeedSchema.parse(template)).toBeDefined();
  });

  it('declares a service category that exists', () => {
    // The category is the only segmentation key in the product (ADR-17). A
    // typo here would create a silent one-template segment that never joins
    // the reporting for the category it meant.
    expect(SERVICE_CATEGORY_KEYS).toContain(template.serviceCategory);
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
    const prose = `${template.name} ${template.description} ${template.exclusionRationale} ${template.onboardingHint}`;
    expect(prose).not.toMatch(/\b(the|and the|services for|this template)\b/i);
  });

  it('describes itself for a buyer of the trade, not in CPV jargon', () => {
    expect(template.description).toMatch(/^For /);
    expect(template.description).not.toMatch(/CPV/);
  });

  /**
   * The onboarding hint is where `supplierForm` earns its keep — it is the
   * only place the distinction is visible to a user. A cross-sector hint that
   * forgot to name geography would leave the supplier with the one axis that
   * actually narrows their feed unset, which is the failure mode ADR-17 opens
   * with: a cleaning company in Bergen told to search the whole country.
   */
  it('names geography in its hint when the buyer side carries no information', () => {
    if (template.supplierForm !== 'cross_sector') return;
    expect(template.onboardingHint.toLowerCase()).toContain('geografi');
  });
});

describe('findServiceTemplate', () => {
  it('finds a template by slug', () => {
    expect(findServiceTemplate('bygg-og-anlegg-utforende')?.name).toBe('Bygg og anlegg, utførende');
  });

  it('returns undefined for an unknown slug', () => {
    expect(findServiceTemplate('ikke-en-mal')).toBeUndefined();
  });

  /**
   * The five pre-ADR-17 slugs. Every one of them was remapped by
   * `0004_service_templates.sql`, and the remap is recorded per profile in
   * `alert_profile_template_remaps` rather than applied silently. If a slug
   * from that era resolves again, someone has re-added a template under the
   * old key and the remap history now points at a live row that means
   * something else.
   */
  it('does not resolve a retired industry-era slug', () => {
    for (const retired of [
      'bygg-og-anlegg',
      'radgivende-ingeniorer',
      'drift-renhold-og-fm',
      'tekniske-tjenester',
      'it-og-konsulenttjenester',
    ]) {
      expect(findServiceTemplate(retired), `${retired} is a retired slug`).toBeUndefined();
    }
  });
});
