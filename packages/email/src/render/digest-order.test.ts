import { describe, expect, it } from 'vitest';
import { CARD_NB, DIGEST_NB } from '../copy.js';
import { toPromotionBlock } from '../promotion.js';
import { digestContext, renderAllTemplates } from '../testing/all-templates.js';
import * as f from '../testing/fixtures.js';
import {
  assertPromotionOrder,
  checkPromotionOrder,
  promotionBlockRange,
  stripPromotionBlock,
} from '../testing/promotion-order.js';
import { renderDailyDigest, renderWeeklyDigest } from './templates/index.js';
import { MARKERS } from './parts.js';

const withPromotion = renderDailyDigest(digestContext());
const withoutPromotion = renderDailyDigest(
  digestContext({ preferences: f.PREFERENCES_PROMOTION_OFF }),
);

function indexOfMarker(html: string, marker: string): number {
  return html.indexOf(`<!--${marker}-->`);
}

describe('spec section 26: the section order', () => {
  it('renders the ten sections in the specified order', () => {
    const html = withPromotion.html;
    const order = [
      indexOfMarker(html, MARKERS.header),
      indexOfMarker(html, MARKERS.title),
      indexOfMarker(html, MARKERS.count),
      indexOfMarker(html, MARKERS.competitions),
      indexOfMarker(html, MARKERS.plannedStart),
      indexOfMarker(html, MARKERS.changes),
      indexOfMarker(html, MARKERS.profileAdmin),
      indexOfMarker(html, MARKERS.promotionStart),
      indexOfMarker(html, MARKERS.notificationSettings),
      indexOfMarker(html, MARKERS.legal),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

/**
 * The section 23.5 verification hook.
 *
 * The last test in this block is the one that matters: it feeds the checker a
 * digest whose promotion block has been moved above the tender cards and
 * asserts that the checker reports it. Without that, a checker that returned
 * an empty array unconditionally would pass every other test here.
 */
describe('spec section 23.5: promotion never precedes tender content', () => {
  it('reports no violation for any rendered template', () => {
    for (const email of renderAllTemplates()) {
      expect(() => assertPromotionOrder(email.html)).not.toThrow();
    }
  });

  it('places the promotion block after the last tender card', () => {
    const html = withPromotion.html;
    const lastCard = Math.max(
      html.lastIndexOf(`<!--${MARKERS.tenderCard('')}`),
      html.lastIndexOf(`<!--${MARKERS.plannedCard('')}`),
    );
    expect(lastCard).toBeGreaterThan(0);
    expect(indexOfMarker(html, MARKERS.promotionStart)).toBeGreaterThan(lastCard);
  });

  it('places the promotion block after the planned-procurement section', () => {
    const html = withPromotion.html;
    expect(indexOfMarker(html, MARKERS.promotionStart)).toBeGreaterThan(
      indexOfMarker(html, MARKERS.plannedEnd),
    );
  });

  it('places no promotion markup between two tender cards', () => {
    const html = withPromotion.html;
    const firstCard = html.indexOf(`<!--${MARKERS.tenderCard('')}`);
    const lastCard = html.lastIndexOf(`<!--${MARKERS.plannedCard('')}`);
    const between = html.slice(firstCard, lastCard);
    expect(between).not.toContain('data-luma-block="promotion"');
    expect(between).not.toContain(`<!--${MARKERS.promotionStart}-->`);
  });

  it('CAN FAIL: reports a violation when the block is moved above the cards', () => {
    const html = withPromotion.html;
    const range = promotionBlockRange(html);
    expect(range).not.toBeNull();
    if (!range) throw new Error('unreachable');

    const block = html.slice(range.start, range.end);
    const stripped = stripPromotionBlock(html);
    const firstCard = stripped.indexOf(`<!--${MARKERS.tenderCard('')}`);
    const sabotaged = stripped.slice(0, firstCard) + block + '\n' + stripped.slice(firstCard);

    const violations = checkPromotionOrder(sabotaged);
    expect(violations.map((violation) => violation.code)).toContain('promotion_before_tender_card');
    expect(violations.map((violation) => violation.code)).toContain(
      'promotion_before_planned_section',
    );
    expect(() => assertPromotionOrder(sabotaged)).toThrow(/feilplassert/);
  });

  it('CAN FAIL: reports promotional markup smuggled in without markers', () => {
    const leaked = withoutPromotion.html.replace(
      '<!--luma:section:notification-settings-->',
      '<div data-luma-block="promotion">Kurs</div><!--luma:section:notification-settings-->',
    );
    expect(checkPromotionOrder(leaked).map((violation) => violation.code)).toContain(
      'promotion_markup_before_content',
    );
  });
});

/**
 * Spec section 23.5, "gi dårligere treff til brukere som slår av promotering".
 *
 * The strong form: with promotion off, the digest is byte-for-byte the digest
 * with promotion on, minus the fenced block. Nothing about the tender content
 * can differ, because there is nothing left that could differ.
 */
describe('the promotion off switch', () => {
  it('renders no promotion block', () => {
    expect(withoutPromotion.html).not.toContain('data-luma-block="promotion"');
    expect(withoutPromotion.html).not.toContain(`<!--${MARKERS.promotionStart}-->`);
    expect(withoutPromotion.text).not.toContain(f.PAAFYLL_RECOMMENDATION.title);
  });

  it('is byte-identical to the promotion-on digest minus the block', () => {
    expect(stripPromotionBlock(withPromotion.html)).toBe(withoutPromotion.html);
  });

  it('still contains every tender, in the same order', () => {
    const ids = (html: string): string[] =>
      [...html.matchAll(/data-luma-tender-id="([^"]+)"/g)].map((match) => match[1] ?? '');
    expect(ids(withoutPromotion.html)).toEqual(ids(withPromotion.html));
    expect(ids(withoutPromotion.html).length).toBeGreaterThan(0);
  });

  it('keeps the same subject and the same tender links', () => {
    expect(withoutPromotion.subject).toBe(withPromotion.subject);
    for (const item of [...f.COMPETITION_ITEMS, ...f.PLANNED_ITEMS]) {
      expect(withoutPromotion.html).toContain(item.tender.title);
      expect(withoutPromotion.html).toContain(item.tender.sourceUrl);
    }
  });

  it('still offers a way back to the promotion setting (spec section 25)', () => {
    expect(withoutPromotion.html).toContain('handling=slaa-av-promotering');
  });

  it('refuses to render a block even if the caller supplies one', () => {
    const contradictory = renderDailyDigest(
      digestContext({
        preferences: f.PREFERENCES_PROMOTION_OFF,
        promotion: toPromotionBlock(f.PAAFYLL_RECOMMENDATION, 'digest'),
      }),
    );
    expect(contradictory.html).toBe(withoutPromotion.html);
  });
});

describe('planned procurements (spec section 26, item 5)', () => {
  const html = withPromotion.html;

  it('has its own section with the count and the explanatory line', () => {
    expect(html).toContain(`Planlagte anskaffelser (${f.PLANNED_ITEMS.length})`);
    expect(html).toContain(DIGEST_NB.plannedExplanation);
    // The text part hard-wraps, so match the first sentence rather than the
    // whole paragraph.
    expect(withPromotion.text).toContain('Konkurransene er ikke publisert ennå.');
  });

  it('keeps planned procurements out of the competitions section', () => {
    const plannedStart = indexOfMarker(html, MARKERS.plannedStart);
    const competitionsStart = indexOfMarker(html, MARKERS.competitions);
    for (const item of f.COMPETITION_ITEMS) {
      expect(html.indexOf(`data-luma-tender-id="${item.tender.id}"`)).toBeGreaterThan(
        competitionsStart,
      );
      expect(html.indexOf(`data-luma-tender-id="${item.tender.id}"`)).toBeLessThan(plannedStart);
    }
    for (const item of f.PLANNED_ITEMS) {
      expect(html.indexOf(`data-luma-tender-id="${item.tender.id}"`)).toBeGreaterThan(plannedStart);
    }
  });

  it('labels a planned procurement instead of inventing a deadline', () => {
    const plannedStart = indexOfMarker(html, MARKERS.plannedStart);
    const plannedEnd = indexOfMarker(html, MARKERS.plannedEnd);
    const section = html.slice(plannedStart, plannedEnd);
    expect(section).toContain(CARD_NB.plannedLabel);
    // No date at all in the planned section's deadline row.
    expect(section).not.toMatch(/Frist<\/td><td[^>]*>\d/);
    for (const item of f.PLANNED_ITEMS) {
      expect(item.tender.deadlineAt).toBeUndefined();
    }
  });

  it('renders the same distinction in the plain-text part', () => {
    expect(withPromotion.text).toContain(`${CARD_NB.deadlineLabel}: ${CARD_NB.plannedLabel}`);
  });
});

describe('the weekly digest', () => {
  it('differs from the daily one only in title, date range and subject', () => {
    const weekly = renderWeeklyDigest(digestContext());
    expect(weekly.template).toBe('tender-weekly-digest-v1');
    expect(weekly.subject).not.toBe(withPromotion.subject);
    expect(weekly.html).toContain(DIGEST_NB.weeklyTitle);
    expect(() => assertPromotionOrder(weekly.html)).not.toThrow();
  });
});

describe('the empty state', () => {
  it('is honest about coverage rather than silent', () => {
    const empty = renderDailyDigest({
      ...digestContext(),
      competitions: [],
      plannedProcurements: [],
      savedTenderChanges: [],
    });
    expect(empty.html).toContain(DIGEST_NB.emptyStateHeading);
    expect(empty.html).toContain(DIGEST_NB.coverageNote);
    expect(() => assertPromotionOrder(empty.html)).not.toThrow();
  });
});
