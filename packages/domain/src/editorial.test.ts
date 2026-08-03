import { describe, expect, it } from 'vitest';
import { isRecommendationEligible, type EditorialRecommendation } from './editorial.js';

const base: EditorialRecommendation = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Faglig påfyll',
  description: 'Månedlig fagbrev om tilbudsarbeid.',
  url: 'https://luma-training.com/paafyll',
  placement: 'digest_footer',
  relevanceTags: [],
  ladderLevel: 2,
  regionScope: 'national',
  marketingCategory: 'paid_newsletter',
  isPaid: true,
  active: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const now = new Date('2026-06-01');
const OSLO = ['NO081', 'NO082'];

describe('isRecommendationEligible', () => {
  it('shows an active national recommendation to anyone', () => {
    expect(
      isRecommendationEligible({
        recommendation: base,
        now,
        userRegionCodes: ['NO0A2'],
        osloRegionCodes: OSLO,
      }),
    ).toBe(true);
  });

  it('never shows an inactive recommendation', () => {
    expect(
      isRecommendationEligible({
        recommendation: { ...base, active: false },
        now,
        userRegionCodes: ['NO081'],
        osloRegionCodes: OSLO,
      }),
    ).toBe(false);
  });

  it('respects a start date that has not been reached', () => {
    expect(
      isRecommendationEligible({
        recommendation: { ...base, activeFrom: new Date('2026-07-01') },
        now,
        userRegionCodes: [],
        osloRegionCodes: OSLO,
      }),
    ).toBe(false);
  });

  it('respects an end date that has passed', () => {
    expect(
      isRecommendationEligible({
        recommendation: { ...base, activeUntil: new Date('2026-05-01') },
        now,
        userRegionCodes: [],
        osloRegionCodes: OSLO,
      }),
    ).toBe(false);
  });

  it('is inclusive of the exact start instant', () => {
    expect(
      isRecommendationEligible({
        recommendation: { ...base, activeFrom: now },
        now,
        userRegionCodes: [],
        osloRegionCodes: OSLO,
      }),
    ).toBe(true);
  });

  describe('regional routing of the Oslo-only full-day course (spec 23.2)', () => {
    const osloOnly: EditorialRecommendation = {
      ...base,
      ladderLevel: 4,
      regionScope: 'oslo_region',
      marketingCategory: 'course',
      title: 'Vinn flere anbud med AI',
    };

    it('shows it to a user whose profile covers the Oslo region', () => {
      expect(
        isRecommendationEligible({
          recommendation: osloOnly,
          now,
          userRegionCodes: ['NO081'],
          osloRegionCodes: OSLO,
        }),
      ).toBe(true);
    });

    it('hides it from a user outside the Oslo region', () => {
      expect(
        isRecommendationEligible({
          recommendation: osloOnly,
          now,
          userRegionCodes: ['NO0A2'],
          osloRegionCodes: OSLO,
        }),
      ).toBe(false);
    });

    it('shows it when any one of several profile regions qualifies', () => {
      expect(
        isRecommendationEligible({
          recommendation: osloOnly,
          now,
          userRegionCodes: ['NO0A2', 'NO082'],
          osloRegionCodes: OSLO,
        }),
      ).toBe(true);
    });

    it('hides it from a user with no stated geography rather than defaulting to show', () => {
      expect(
        isRecommendationEligible({
          recommendation: osloOnly,
          now,
          userRegionCodes: [],
          osloRegionCodes: OSLO,
        }),
      ).toBe(false);
    });

    it('compares region codes case-insensitively', () => {
      expect(
        isRecommendationEligible({
          recommendation: osloOnly,
          now,
          userRegionCodes: ['no081'],
          osloRegionCodes: OSLO,
        }),
      ).toBe(true);
    });

    it('hides it when the Oslo region list is unconfigured', () => {
      expect(
        isRecommendationEligible({
          recommendation: osloOnly,
          now,
          userRegionCodes: ['NO081'],
          osloRegionCodes: [],
        }),
      ).toBe(false);
    });
  });
});
