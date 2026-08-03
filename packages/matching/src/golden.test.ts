import { describe, expect, it } from 'vitest';
import { matchTender } from './engine.js';
import { explainMatch } from './explain.js';
import { FIXED_NOW, GOLDEN_CASES } from './testing/fixtures.js';

/**
 * Golden file over a corpus of realistic tender/profile pairs.
 *
 * The snapshot is committed. Its job is to make any unintended scoring change
 * show up as a reviewable diff rather than as a silent shift in what lands in
 * people's inboxes. A deliberate change to weights, curves or wording is
 * expected to update this file *and* bump `MATCHING_VERSION` in the same
 * commit; a diff here with no version bump is the signal that something
 * changed by accident.
 *
 * `now` is fixed, so the deadline component contributes a stable number.
 */
describe('golden corpus', () => {
  for (const { name, tender, profile } of GOLDEN_CASES) {
    it(`matches: ${name}`, () => {
      const result = matchTender(tender, profile, { now: FIXED_NOW });
      expect({
        case: name,
        tender: tender.title,
        profile: profile.name,
        result,
        explanation: explainMatch(result).text,
      }).toMatchSnapshot();
    });
  }

  it('covers every notice category the MVP can encounter', () => {
    const categories = new Set(GOLDEN_CASES.map(({ tender }) => tender.noticeCategory));
    expect([...categories].sort()).toEqual(['award', 'competition', 'planned']);
  });
});
