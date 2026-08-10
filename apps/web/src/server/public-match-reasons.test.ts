import { describe, expect, it } from 'vitest';
import { landsdelBySlug } from '@luma/domain';
import { buildPublicReasons } from './public-match-reasons';
import type { PublicTenderSummary } from './public-search';
import type { ServiceTemplateChoice } from './profiles';

/**
 * The rules, asserted one at a time.
 *
 * The last test is the one that matters most: nothing this function produces
 * may contain a number that reads as a score (spec section 4.3). It is written
 * as a scan over the whole output rather than as an assertion on one string, so
 * a new reason type cannot slip a percentage in unnoticed.
 */

const TEMPLATE: ServiceTemplateChoice = {
  slug: 'renhold-og-facility-management',
  name: 'Renhold og facility management',
  description: 'For leverandører av renhold.',
  supplierForm: 'cross_sector',
  onboardingHint: 'Bruk geografi som hovedavgrensning.',
  cpvInclude: ['90910000', '90911200'],
  keywordsInclude: ['renhold', 'vinduspuss'],
};

function tender(overrides: Partial<PublicTenderSummary> = {}): PublicTenderSummary {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    title: 'Rammeavtale for renhold av skoler',
    buyerName: 'Testkommune',
    noticeCategory: 'competition',
    deadlineAt: null,
    publishedAt: new Date('2026-08-01T00:00:00Z'),
    regionCodes: ['NO081'],
    nationwide: false,
    estimatedValueMinNok: null,
    cpvCodes: [],
    matchedKeywords: [],
    ...overrides,
  };
}

const VESTLANDET = landsdelBySlug('vestlandet')!;

describe('buildPublicReasons', () => {
  it('returns nothing when nothing matched', () => {
    expect(buildPublicReasons({ template: TEMPLATE, tender: tender() })).toEqual([]);
  });

  it('calls a CPV code the template asked for a strong reason, and names it', () => {
    const [reason] = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ cpvCodes: ['90910000'] }),
    });

    expect(reason).toEqual({
      type: 'cpv',
      label: 'CPV: Renholdstjenester',
      strength: 'sterk',
      evidence: 'Kunngjøringen er merket 90910000 Renholdstjenester.',
    });
  });

  it('ignores a CPV code the notice carries but the template never asked for', () => {
    const reasons = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ cpvCodes: ['45000000'] }),
    });
    expect(reasons).toEqual([]);
  });

  it('still names an unknown code rather than printing an empty label', () => {
    const [reason] = buildPublicReasons({
      template: { ...TEMPLATE, cpvInclude: ['50411000'] },
      tender: tender({ cpvCodes: ['50411000'] }),
    });
    expect(reason?.label).toBe('CPV: 50411000');
    expect(reason?.evidence).toBe('Kunngjøringen er merket med CPV-koden 50411000.');
  });

  it('calls a keyword in the title strong', () => {
    const [reason] = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ matchedKeywords: ['renhold'] }),
    });

    expect(reason).toEqual({
      type: 'keyword',
      label: 'Søkeord: «renhold»',
      strength: 'sterk',
      evidence: 'Ordet «renhold» står i tittelen på kunngjøringen.',
    });
  });

  it('calls a keyword found outside the title middels, and says where it was not', () => {
    const [reason] = buildPublicReasons({
      template: TEMPLATE,
      // Matched somewhere other than the title — the title says nothing about
      // windows. Today only the title is scanned, so this is the rule holding
      // for a caller that scans more.
      tender: tender({ matchedKeywords: ['vinduspuss'] }),
    });

    expect(reason?.strength).toBe('middels');
    expect(reason?.evidence).toBe(
      'Ordet «vinduspuss» er nevnt i kunngjøringen, men ikke i tittelen.',
    );
  });

  it('calls a region inside the requested landsdel strong and names the county', () => {
    const [reason] = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ regionCodes: ['NO0A2'] }),
      landsdel: VESTLANDET,
    });

    expect(reason?.type).toBe('geography');
    expect(reason?.strength).toBe('sterk');
    expect(reason?.label).toBe('Område: Vestlandet');
    expect(reason?.evidence).toContain('Vestlandet');
  });

  it('gives no geography reason when the notice is in a different landsdel', () => {
    const reasons = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ regionCodes: ['NO081'] }),
      landsdel: VESTLANDET,
    });
    expect(reasons.filter((reason) => reason.type === 'geography')).toEqual([]);
  });

  it('gives no geography reason on a national page, where there is no area to confirm', () => {
    const reasons = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ regionCodes: ['NO081'] }),
    });
    expect(reasons.filter((reason) => reason.type === 'geography')).toEqual([]);
  });

  it('calls a nationwide notice middels and says it is not tied to one landsdel', () => {
    const [reason] = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ regionCodes: [], nationwide: true }),
      landsdel: VESTLANDET,
    });

    expect(reason?.strength).toBe('middels');
    expect(reason?.evidence).toBe(
      'Kunngjøringen gjelder hele landet og er ikke knyttet til én landsdel.',
    );
  });

  it('builds one reason per hit across all three kinds', () => {
    const reasons = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({
        cpvCodes: ['90910000', '90911200'],
        matchedKeywords: ['renhold'],
        regionCodes: ['NO0A2'],
      }),
      landsdel: VESTLANDET,
    });

    expect(reasons.map((reason) => reason.type)).toEqual(['cpv', 'cpv', 'keyword', 'geography']);
  });

  it('never emits a score, a percentage or a number that reads as one', () => {
    const reasons = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({
        cpvCodes: ['90910000'],
        matchedKeywords: ['renhold'],
        regionCodes: ['NO0A2'],
      }),
      landsdel: VESTLANDET,
    });

    for (const reason of reasons) {
      expect(reason.evidence).not.toMatch(/%/);
      expect(`${reason.label} ${reason.evidence}`.toLowerCase()).not.toContain('score');
      expect(reason.strength).toMatch(/^(sterk|middels|svak)$/);
    }
  });
});
