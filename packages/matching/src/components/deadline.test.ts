import { describe, expect, it } from 'vitest';
import { FIXED_NOW, makeProfile, makeTender } from '../testing/fixtures.js';
import { DEFAULT_MATCH_WEIGHTS } from '../weights.js';
import { COMFORTABLE_DAYS, scoreDeadline } from './deadline.js';

const weights = DEFAULT_MATCH_WEIGHTS;

function inDays(days: number): Date {
  return new Date(FIXED_NOW.getTime() + days * 86_400_000);
}

function score(days: number, overrides: Parameters<typeof makeTender>[0] = {}) {
  return scoreDeadline(
    makeTender({ deadlineAt: inDays(days), ...overrides }),
    makeProfile(),
    weights,
    FIXED_NOW,
  );
}

describe('scoreDeadline', () => {
  it('skips a planned procurement entirely, with no penalty', () => {
    const reason = scoreDeadline(
      makeTender({ noticeCategory: 'planned' }),
      makeProfile(),
      weights,
      FIXED_NOW,
    );
    expect(reason).toBeNull();
  });

  it('skips a planned procurement even if the source supplied a date', () => {
    const reason = scoreDeadline(
      makeTender({ noticeCategory: 'planned', deadlineAt: inDays(30) }),
      makeProfile(),
      weights,
      FIXED_NOW,
    );
    expect(reason).toBeNull();
  });

  it('does not apply when the notice has no deadline', () => {
    expect(scoreDeadline(makeTender(), makeProfile(), weights, FIXED_NOW)).toBeNull();
  });

  it('scores a tender closing in three weeks above one closing tomorrow', () => {
    expect(score(COMFORTABLE_DAYS)?.contribution).toBeGreaterThan(score(1)?.contribution ?? 0);
  });

  it('awards the whole budget once the deadline is comfortable', () => {
    expect(score(COMFORTABLE_DAYS)?.contribution).toBe(weights.deadline);
    expect(score(90)?.contribution).toBe(weights.deadline);
  });

  it('scales linearly inside the comfortable window', () => {
    expect(score(COMFORTABLE_DAYS / 2)?.contribution).toBe(weights.deadline / 2);
  });

  it('does not apply once the deadline has passed', () => {
    expect(score(-1)).toBeNull();
    expect(score(0)).toBeNull();
  });

  it('reports the remaining whole days and the date', () => {
    const reason = score(14);
    expect(reason?.label).toBe('Det er 14 dager igjen til fristen');
    expect(reason?.evidence).toEqual(['Frist: 17.08.2026', 'Dager igjen: 14']);
  });

  it('uses the singular form for one day', () => {
    expect(score(1.5)?.label).toBe('Det er én dag igjen til fristen');
  });

  it('mentions the profile minimum when the user set one', () => {
    const reason = scoreDeadline(
      makeTender({ deadlineAt: inDays(14) }),
      makeProfile({ deadlineMinimumDays: 7 }),
      weights,
      FIXED_NOW,
    );
    expect(reason?.evidence).toContain('Minstekrav i profilen: 7 dager');
  });

  it('depends only on the supplied clock, not on the system clock', () => {
    const later = new Date(FIXED_NOW.getTime() + 10 * 86_400_000);
    const tender = makeTender({ deadlineAt: inDays(14) });
    const atNow = scoreDeadline(tender, makeProfile(), weights, FIXED_NOW);
    const atLater = scoreDeadline(tender, makeProfile(), weights, later);
    expect(atLater?.contribution).toBeLessThan(atNow?.contribution ?? 0);
  });
});
