import {
  PAID_OFFER_LABEL_NB,
  PROMOTION_DISCLOSURE_NB,
  PROMOTION_HEADINGS_NB,
  type EditorialRecommendation,
} from '@luma/domain';
import { describe, expect, it } from 'vitest';
import {
  ladderStateForAccount,
  selectPromotion,
  selectPromotionDetailed,
  toPromotionBlock,
  type SelectPromotionInput,
} from './promotion.js';
import * as f from './testing/fixtures.js';

const baseInput: SelectPromotionInput = {
  recommendations: f.RECOMMENDATIONS,
  placement: 'digest_footer',
  medium: 'digest',
  preferences: f.PREFERENCES_PROMOTION_ON,
  userRegionCodes: ['NO081'],
  osloRegionCodes: f.OSLO_REGION_CODES,
  ladder: { highestAllowedLevel: 4, rotationIndex: 0 },
  now: f.FIXED_NOW,
};

describe('the off switch (spec sections 22 and 23.4)', () => {
  it('selects nothing when the user turned promotion off', () => {
    const result = selectPromotionDetailed({
      ...baseInput,
      preferences: f.PREFERENCES_PROMOTION_OFF,
    });
    expect(result.block).toBeNull();
    expect(result.reason).toBe('promotion_disabled_by_user');
  });

  it('does not require marketing consent to show the block', () => {
    // The in-email block is a content setting, not marketing consent
    // (spec section 22). marketingEmailConsent is false in the fixture.
    expect(f.PREFERENCES_PROMOTION_ON.marketingEmailConsent).toBe(false);
    expect(selectPromotion(baseInput)).not.toBeNull();
  });
});

describe('the ladder (spec section 23.1)', () => {
  it('gives a brand-new account free professional content', () => {
    const ladder = ladderStateForAccount({
      accountCreatedAt: new Date('2026-03-10T08:00:00.000Z'),
      now: f.FIXED_NOW,
      rotationIndex: 0,
    });
    expect(ladder.highestAllowedLevel).toBe(1);

    const block = selectPromotion({ ...baseInput, ladder });
    expect(block?.recommendationId).toBe(f.GUIDE_RECOMMENDATION.id);
    expect(block?.ladderLevel).toBe(1);
    expect(block?.isPaid).toBe(false);
  });

  it('opens the higher rungs as the account ages', () => {
    const at = (days: number): number =>
      ladderStateForAccount({
        accountCreatedAt: new Date(f.FIXED_NOW.getTime() - days * 24 * 60 * 60 * 1000),
        now: f.FIXED_NOW,
        rotationIndex: 0,
      }).highestAllowedLevel;
    expect(at(0)).toBe(1);
    expect(at(13)).toBe(1);
    expect(at(14)).toBe(2);
    expect(at(30)).toBe(3);
    expect(at(60)).toBe(4);
    expect(at(400)).toBe(4);
  });

  it('rotates deterministically and independently of input order', () => {
    const forward = [0, 1, 2].map(
      (rotationIndex) =>
        selectPromotion({ ...baseInput, ladder: { highestAllowedLevel: 4, rotationIndex } })
          ?.recommendationId,
    );
    const reversedInput = { ...baseInput, recommendations: [...f.RECOMMENDATIONS].reverse() };
    const backward = [0, 1, 2].map(
      (rotationIndex) =>
        selectPromotion({ ...reversedInput, ladder: { highestAllowedLevel: 4, rotationIndex } })
          ?.recommendationId,
    );
    expect(forward).toEqual(backward);
    expect(new Set(forward).size).toBe(3);
  });

  it('is a pure function: the same input gives the same output', () => {
    expect(selectPromotion(baseInput)).toEqual(selectPromotion(baseInput));
  });
});

describe('regional routing (spec section 23.2)', () => {
  it('shows the Oslo full-day course to a profile inside the region', () => {
    const block = selectPromotion({
      ...baseInput,
      recommendations: [f.FULL_DAY_COURSE_RECOMMENDATION],
      userRegionCodes: ['NO081'],
    });
    expect(block?.recommendationId).toBe(f.FULL_DAY_COURSE_RECOMMENDATION.id);
  });

  it('never shows it outside the region, whatever the ladder says', () => {
    for (const rotationIndex of [0, 1, 2, 3, 4]) {
      const block = selectPromotion({
        ...baseInput,
        userRegionCodes: ['NO0A2'],
        ladder: { highestAllowedLevel: 4, rotationIndex },
      });
      expect(block?.marketingCategory).not.toBe('course');
      expect(block?.recommendationId).not.toBe(f.FULL_DAY_COURSE_RECOMMENDATION.id);
    }
  });

  it('falls back to national offers outside the region', () => {
    const block = selectPromotion({
      ...baseInput,
      recommendations: [f.FULL_DAY_COURSE_RECOMMENDATION, f.PAAFYLL_RECOMMENDATION],
      userRegionCodes: ['NO071'],
    });
    expect(block?.recommendationId).toBe(f.PAAFYLL_RECOMMENDATION.id);
  });
});

describe('labelling (spec sections 23.4 and 43)', () => {
  it('uses the approved heading per category', () => {
    expect(toPromotionBlock(f.PAAFYLL_RECOMMENDATION, 'digest').heading).toBe(
      PROMOTION_HEADINGS_NB.paafyll,
    );
    expect(toPromotionBlock(f.FULL_DAY_COURSE_RECOMMENDATION, 'digest').heading).toBe(
      PROMOTION_HEADINGS_NB.skill,
    );
    expect(toPromotionBlock(f.GUIDE_RECOMMENDATION, 'digest').heading).toBe(
      PROMOTION_HEADINGS_NB.generic,
    );
  });

  it('marks a paid offer as paid even if the record forgot to', () => {
    const sloppy: EditorialRecommendation = { ...f.PAAFYLL_RECOMMENDATION, isPaid: false };
    const block = toPromotionBlock(sloppy, 'digest');
    expect(block.isPaid).toBe(true);
    expect(block.paidLabel).toBe(PAID_OFFER_LABEL_NB);
  });

  it('always carries the section 43 disclosure', () => {
    expect(toPromotionBlock(f.GUIDE_RECOMMENDATION, 'digest').disclosure).toBe(
      PROMOTION_DISCLOSURE_NB,
    );
  });

  it('sends every promotion link through withUtm, campaign tagged', () => {
    const block = toPromotionBlock(f.PAAFYLL_RECOMMENDATION, 'digest');
    const url = new URL(block.url);
    expect(url.searchParams.get('utm_source')).toBe('anbudsvarsling');
    expect(url.searchParams.get('utm_medium')).toBe('digest');
    expect(url.searchParams.get('utm_campaign')).toBe(f.PAAFYLL_RECOMMENDATION.id);
  });
});

describe('section 23.5 prohibitions applied to admin-editable copy', () => {
  const hypey: EditorialRecommendation = {
    ...f.PAAFYLL_RECOMMENDATION,
    id: '66666666-6666-4666-8666-000000000009',
    title: 'Siste plasser: kurset er nødvendig for å vinne',
    description: 'Meld deg på nå. Garantert flere treff.',
  };

  it('drops a recommendation whose copy breaks the rules', () => {
    const result = selectPromotionDetailed({ ...baseInput, recommendations: [hypey] });
    expect(result.block).toBeNull();
    expect(result.reason).toBe('all_candidates_rejected');
    expect(result.copyIssues).toHaveLength(1);
    expect(result.copyIssues[0]?.matches.map((match) => match.ruleId)).toEqual(
      expect.arrayContaining(['scarcity', 'course-necessary', 'urgency', 'guarantee']),
    );
  });

  it('falls back to a clean recommendation rather than rendering nothing', () => {
    const result = selectPromotionDetailed({
      ...baseInput,
      recommendations: [hypey, f.GUIDE_RECOMMENDATION],
      ladder: { highestAllowedLevel: 4, rotationIndex: 0 },
    });
    expect(result.block?.recommendationId).toBe(f.GUIDE_RECOMMENDATION.id);
    expect(result.copyIssues).toHaveLength(1);
  });
});

describe('eligibility', () => {
  it('ignores recommendations for another placement', () => {
    const result = selectPromotionDetailed({
      ...baseInput,
      recommendations: f.RECOMMENDATIONS.map((recommendation) => ({
        ...recommendation,
        placement: 'tender_detail' as const,
      })),
    });
    expect(result.reason).toBe('no_eligible_recommendation');
  });

  it('ignores an inactive or expired recommendation', () => {
    const expired: EditorialRecommendation = {
      ...f.GUIDE_RECOMMENDATION,
      activeUntil: new Date('2026-02-01T00:00:00.000Z'),
    };
    expect(selectPromotion({ ...baseInput, recommendations: [expired] })).toBeNull();
    expect(
      selectPromotion({
        ...baseInput,
        recommendations: [{ ...f.GUIDE_RECOMMENDATION, active: false }],
      }),
    ).toBeNull();
  });
});
