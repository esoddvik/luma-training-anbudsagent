import { describe, expect, it } from 'vitest';
import { landsdelBySlug } from '@luma/domain';
import { buildPublicReasons, RELEVANCE_LEVEL_LABEL_NB } from './public-match-reasons';
import type { PublicTenderSummary } from './public-search';
import type { ServiceTemplateChoice } from './profiles';

/**
 * The rules, asserted one at a time.
 *
 * Two tests matter more than the rest. Nothing this function produces may
 * contain a number that reads as a score (spec section 4.3) — written as a scan
 * over the whole output rather than an assertion on one string, so a new reason
 * type cannot slip a percentage in unnoticed. And the weight table (R2) is
 * asserted through the *level*, because the weights themselves are private and
 * must stay that way: the level is the only thing a caller can see, so it is
 * the only thing worth pinning.
 */

const TEMPLATE: ServiceTemplateChoice = {
  slug: 'renhold-og-facility-management',
  name: 'Renhold og facility management',
  description: 'For leverandører av renhold.',
  supplierForm: 'cross_sector',
  onboardingHint: 'Bruk geografi som hovedavgrensning.',
  cpvInclude: ['90900000', '90910000', '90911200', '79993000', '98300000'],
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
    descriptionKeywords: [],
    ...overrides,
  };
}

const VESTLANDET = landsdelBySlug('vestlandet')!;

describe('buildPublicReasons', () => {
  it('returns nothing when nothing matched', () => {
    expect(buildPublicReasons({ template: TEMPLATE, tender: tender() }).reasons).toEqual([]);
  });

  it('calls a precise CPV code the template asked for a strong reason, and names it', () => {
    const [reason] = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ cpvCodes: ['90910000'] }),
    }).reasons;

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
    }).reasons;
    expect(reasons).toEqual([]);
  });

  it('still names an unknown code rather than printing an empty label', () => {
    const [reason] = buildPublicReasons({
      template: { ...TEMPLATE, cpvInclude: ['50411000'] },
      tender: tender({ cpvCodes: ['50411000'] }),
    }).reasons;
    expect(reason?.label).toBe('CPV: 50411000');
    expect(reason?.evidence).toBe('Kunngjøringen er merket med CPV-koden 50411000.');
  });

  it('calls a keyword in the title strong', () => {
    const [reason] = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ matchedKeywords: ['renhold'] }),
    }).reasons;

    expect(reason).toEqual({
      type: 'keyword',
      label: 'Søkeord: «renhold»',
      strength: 'sterk',
      evidence: 'Ordet «renhold» står i tittelen på kunngjøringen.',
    });
  });

  it('calls a keyword found only in the description svak, and says where it was not', () => {
    const [reason] = buildPublicReasons({
      template: TEMPLATE,
      // The title says nothing about windows.
      tender: tender({ descriptionKeywords: ['vinduspuss'] }),
    }).reasons;

    expect(reason?.strength).toBe('svak');
    expect(reason?.evidence).toBe(
      'Ordet «vinduspuss» er nevnt i kunngjøringen, men ikke i tittelen.',
    );
  });

  it('counts a word in both title and description once, at the title weight', () => {
    const { level, reasons } = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ matchedKeywords: ['renhold'], descriptionKeywords: ['renhold'] }),
    });

    expect(reasons).toHaveLength(1);
    // 3 alone, not 3 + 1.
    expect(level).toBe('middels');
  });

  it('re-checks the title rather than trusting the caller to have done it', () => {
    // A caller that scans a wider text and files everything under
    // `matchedKeywords` must not get title weight for a word that is not there.
    const [reason] = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ matchedKeywords: ['vinduspuss'] }),
    }).reasons;
    expect(reason?.strength).toBe('svak');
  });

  it('calls a region inside the requested landsdel svak and names the county', () => {
    const [reason] = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ regionCodes: ['NO0A2'] }),
      landsdel: VESTLANDET,
    }).reasons;

    expect(reason?.type).toBe('geography');
    // Weight 1 under R2, and strength is weight-derived, so «Svak» — it used to
    // read «Sterk», which claimed more than being in the right county proves.
    expect(reason?.strength).toBe('svak');
    expect(reason?.label).toBe('Område: Vestlandet');
    expect(reason?.evidence).toContain('Vestlandet');
  });

  it('gives no geography reason when the notice is in a different landsdel', () => {
    const reasons = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ regionCodes: ['NO081'] }),
      landsdel: VESTLANDET,
    }).reasons;
    expect(reasons.filter((reason) => reason.type === 'geography')).toEqual([]);
  });

  it('gives no geography reason on a national page, where there is no area to confirm', () => {
    const reasons = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ regionCodes: ['NO081'] }),
    }).reasons;
    expect(reasons.filter((reason) => reason.type === 'geography')).toEqual([]);
  });

  // ── R10 ────────────────────────────────────────────────────────────────────
  it('words the nationwide reason exactly as R10 requires', () => {
    const [reason] = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ regionCodes: [], nationwide: true }),
      landsdel: VESTLANDET,
    }).reasons;

    expect(reason?.label).toBe('Område: gjelder hele landet');
    expect(reason?.strength).toBe('middels');
    expect(reason?.evidence).toBe(
      'Konkurransen er ikke knyttet til én landsdel, så den er like aktuell der du holder til.',
    );
  });

  it('no longer calls a nationwide notice unconnected to any landsdel', () => {
    const [reason] = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ regionCodes: [], nationwide: true }),
    }).reasons;
    // The old sentence implied a poorer fit. It must be gone, not merely edited
    // around.
    expect(reason?.evidence).not.toContain('ikke knyttet til én landsdel.');
    expect(reason?.label).not.toBe('Område: hele landet');
  });

  // ── R3: family merge ───────────────────────────────────────────────────────
  it('merges codes in one family into a single row that cites all of them', () => {
    const { reasons } = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ cpvCodes: ['90900000', '90910000', '90911200'] }),
    });

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toEqual({
      type: 'cpv',
      label: 'CPV: Renholds- og renovasjonstjenester',
      strength: 'sterk',
      evidence: 'Kunngjøringen er merket 90900000, 90910000 og 90911200.',
    });
  });

  it('names a merged family, never a bare four-digit number', () => {
    const { reasons } = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ cpvCodes: ['90910000', '90911200'] }),
    });
    expect(reasons[0]?.label).toBe('CPV: Renholdstjenester');
    expect(reasons[0]?.label).not.toMatch(/CPV: \d/);
  });

  it('leaves an unnamed family as separate rows rather than heading them with digits', () => {
    const { reasons } = buildPublicReasons({
      template: { ...TEMPLATE, cpvInclude: ['50411000', '50411100'] },
      tender: tender({ cpvCodes: ['50411000', '50411100'] }),
    });
    expect(reasons).toHaveLength(2);
    expect(reasons.map((reason) => reason.label)).toEqual(['CPV: 50411000', 'CPV: 50411100']);
  });

  it('keeps a family of one on its own precise name rather than its vaguer parent', () => {
    // 79993000 is «Bygnings- og eiendomsforvaltning»; family 7999 is «Diverse
    // forretningstjenester», which says less.
    const { reasons } = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ cpvCodes: ['79993000'] }),
    });
    expect(reasons[0]?.label).toBe('CPV: Bygnings- og eiendomsforvaltning');
  });

  it('counts a merged family once towards the level', () => {
    const three = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ cpvCodes: ['90900000', '90910000', '90911200'] }),
    });
    const one = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ cpvCodes: ['90910000'] }),
    });
    // Three codes in one branch are worth what one code is worth. This is the
    // assertion that stops «Sterk» from being the answer to everything.
    expect(three.level).toBe(one.level);
    expect(three.level).toBe('middels');
  });

  it('separates families that share no ancestry', () => {
    const { reasons, level } = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ cpvCodes: ['90910000', '79993000'] }),
    });
    expect(reasons).toHaveLength(2);
    // 3 + 3.
    expect(level).toBe('hoy');
  });

  // ── R2: weights and thresholds ─────────────────────────────────────────────
  //
  // There are two bands, not R2's three. `RelevanceLevel` records why «Lav» was
  // measured to be unreachable and dropped; these two cases are what used to
  // produce it, kept so the widening at the bottom is visible rather than
  // implied. The *row* strength still discriminates — a weak signal reads
  // «Svak» on its own line even though the notice as a whole reads «Middels».
  it('still calls a broad code alone a weak row, though the notice is Middels', () => {
    // 98300000 «Diverse tjenester» is broad, so it weighs 1. `searchPublicTenders`
    // drops this notice before it ever reaches a page (R1); the weight is
    // asserted here because that is where it is decided.
    const { level, reasons } = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ cpvCodes: ['98300000'] }),
    });
    expect(level).toBe('middels');
    expect(reasons[0]?.strength).toBe('svak');
  });

  it('puts a broad code plus a description mention at Middels — the old bottom band', () => {
    const { level } = buildPublicReasons({
      template: TEMPLATE,
      // A title that does not contain the word, so the re-check cannot promote
      // the mention to title weight.
      tender: tender({
        title: 'Rammeavtale for diverse driftstjenester',
        cpvCodes: ['98300000'],
        descriptionKeywords: ['renhold'],
      }),
    });
    expect(level).toBe('middels');
  });

  it('has no third band — every reachable sum is one of two words', () => {
    // The guard against quietly reintroducing «Lav»: if a third value ever
    // returns, this fails rather than rendering an unlabelled badge.
    expect(Object.keys(RELEVANCE_LEVEL_LABEL_NB).sort()).toEqual(['hoy', 'middels']);
  });

  it('puts one precise code alone at Middels relevans', () => {
    const { level } = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ cpvCodes: ['90910000'] }),
    });
    expect(level).toBe('middels');
  });

  it('reaches Høy relevans on a precise code plus a title keyword', () => {
    // 3 + 3.
    const { level } = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ cpvCodes: ['90910000'], matchedKeywords: ['renhold'] }),
    });
    expect(level).toBe('hoy');
  });

  it('does not reach Høy on a precise code plus geography alone', () => {
    // 3 + 1 = 4, which is the middle band and not the top one.
    const { level } = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({ cpvCodes: ['90910000'], regionCodes: ['NO0A2'] }),
      landsdel: VESTLANDET,
    });
    expect(level).toBe('middels');
  });

  it('pins the Høy threshold from both sides', () => {
    // 3 + 1 + 1 = 5, still middels — the boundary is worth pinning from below.
    const five = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({
        cpvCodes: ['90910000'],
        descriptionKeywords: ['vinduspuss'],
        regionCodes: ['NO0A2'],
      }),
      landsdel: VESTLANDET,
    });
    expect(five.level).toBe('middels');

    // 3 + 3 + 1 = 7.
    const seven = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({
        cpvCodes: ['90910000'],
        matchedKeywords: ['renhold'],
        regionCodes: ['NO0A2'],
      }),
      landsdel: VESTLANDET,
    });
    expect(seven.level).toBe('hoy');
  });

  it('builds one reason per hit across all three kinds', () => {
    const { reasons } = buildPublicReasons({
      template: TEMPLATE,
      tender: tender({
        cpvCodes: ['90910000', '90911200'],
        matchedKeywords: ['renhold'],
        regionCodes: ['NO0A2'],
      }),
      landsdel: VESTLANDET,
    });

    // Two CPV codes, one family, one row.
    expect(reasons.map((reason) => reason.type)).toEqual(['cpv', 'keyword', 'geography']);
  });

  it('never emits a score, a percentage or a number that reads as one', () => {
    const { level, reasons } = buildPublicReasons({
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
    expect(level).toMatch(/^(hoy|middels)$/);
    // The level is a word wherever it is rendered, and never a digit.
    expect(RELEVANCE_LEVEL_LABEL_NB[level]).toMatch(/^(Høy|Middels) relevans$/);
  });
});
