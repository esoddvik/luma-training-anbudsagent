import { MARKERS } from '../render/parts.js';

/**
 * The section 23.5 verification hook.
 *
 * Spec section 23.5 forbids placing promotion before the tender results or
 * between two tenders, and ADR-0006 and ADR-0014 both name a rendering-order
 * test as the way that rule is kept. This module is that test's engine, and it
 * lives in `src` rather than in a test file for two reasons: the same check
 * runs over every template in the suite, and other packages that render or
 * preview an email can run it too.
 *
 * It works on markers the renderer emits as HTML comments. Email clients
 * ignore comments, so the markers cost nothing in the delivered mail, and a
 * marker-based check cannot be fooled by CSS the way a visual check could.
 *
 * The check is written so that it can fail: `promotion-order.test.ts` feeds it
 * a digest whose promotion block has been moved above the tender cards and
 * asserts that it reports a violation. A verifier that has never been seen to
 * go red is not a verifier.
 */

export type PromotionOrderViolationCode =
  | 'promotion_before_tender_card'
  | 'promotion_before_planned_section'
  | 'tender_card_inside_promotion'
  | 'promotion_markup_before_content'
  | 'unbalanced_promotion_markers';

export interface PromotionOrderViolation {
  readonly code: PromotionOrderViolationCode;
  readonly message: string;
}

const START = `<!--${MARKERS.promotionStart}-->`;
const END = `<!--${MARKERS.promotionEnd}-->`;
const PROMOTION_ATTRIBUTE = 'data-luma-block="promotion"';
const COMPETITION_CARD_PREFIX = `<!--${MARKERS.tenderCard('')}`;
const PLANNED_CARD_PREFIX = `<!--${MARKERS.plannedCard('')}`;

function indicesOf(haystack: string, needle: string): number[] {
  const found: number[] = [];
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) return found;
    found.push(index);
    from = index + needle.length;
  }
}

/** The `[start, end)` span of the promotion block, including both markers. */
export function promotionBlockRange(html: string): { start: number; end: number } | null {
  const start = html.indexOf(START);
  const end = html.indexOf(END);
  if (start < 0 || end < 0) return null;
  return { start, end: end + END.length };
}

/**
 * Removes the promotion block, including the newline the assembler put after
 * it. The result is what the same email renders as with promotion turned off,
 * which is the property the off-switch test asserts byte for byte.
 */
export function stripPromotionBlock(html: string): string {
  const range = promotionBlockRange(html);
  if (!range) return html;
  const after = html.charAt(range.end) === '\n' ? range.end + 1 : range.end;
  return html.slice(0, range.start) + html.slice(after);
}

/** Every ordering rule broken by this rendered email. Empty means compliant. */
export function checkPromotionOrder(html: string): PromotionOrderViolation[] {
  const violations: PromotionOrderViolation[] = [];

  const starts = indicesOf(html, START);
  const ends = indicesOf(html, END);
  if (starts.length !== ends.length) {
    violations.push({
      code: 'unbalanced_promotion_markers',
      message: `Fant ${starts.length} start- og ${ends.length} sluttmarkører for promoteringsblokken.`,
    });
    return violations;
  }
  if (starts.length === 0) {
    // No promotion block. Nothing can be out of order, but promotional markup
    // must not have leaked in through another path either.
    if (html.includes(PROMOTION_ATTRIBUTE)) {
      violations.push({
        code: 'promotion_markup_before_content',
        message: 'Promoteringsmarkup uten start- og sluttmarkører.',
      });
    }
    return violations;
  }

  const start = starts[0] ?? 0;
  const end = ends[ends.length - 1] ?? html.length;

  const uniqueCards = [
    ...new Set([
      ...indicesOf(html, COMPETITION_CARD_PREFIX),
      ...indicesOf(html, PLANNED_CARD_PREFIX),
    ]),
  ].sort((a, b) => a - b);

  for (const cardIndex of uniqueCards) {
    if (cardIndex > start && cardIndex < end) {
      violations.push({
        code: 'tender_card_inside_promotion',
        message: 'Et anbudskort ligger inne i promoteringsblokken.',
      });
    } else if (cardIndex > start) {
      violations.push({
        code: 'promotion_before_tender_card',
        message:
          'Promoteringsblokken kommer før et anbudskort. Promotering skal alltid komme etter anbudsinnholdet (seksjon 23.5).',
      });
    }
  }

  const plannedEnd = html.indexOf(`<!--${MARKERS.plannedEnd}-->`);
  if (plannedEnd >= 0 && plannedEnd > start) {
    violations.push({
      code: 'promotion_before_planned_section',
      message:
        'Promoteringsblokken kommer før seksjonen for planlagte anskaffelser (seksjon 26, rekkefølge 5 før 8).',
    });
  }

  // Promotional markup outside the fenced block is promotion that the ordering
  // rules cannot see, which is exactly how it would end up between two cards.
  for (const attributeIndex of indicesOf(html, PROMOTION_ATTRIBUTE)) {
    if (attributeIndex < start || attributeIndex > end) {
      violations.push({
        code: 'promotion_markup_before_content',
        message: 'Promoteringsmarkup utenfor den merkede promoteringsblokken.',
      });
    }
  }

  return dedupe(violations);
}

function dedupe(violations: readonly PromotionOrderViolation[]): PromotionOrderViolation[] {
  const seen = new Set<string>();
  const result: PromotionOrderViolation[] = [];
  for (const violation of violations) {
    const key = `${violation.code}:${violation.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(violation);
  }
  return result;
}

/** Throws with every violation listed. */
export function assertPromotionOrder(html: string): void {
  const violations = checkPromotionOrder(html);
  if (violations.length === 0) return;
  throw new Error(
    `Promoteringsblokken er feilplassert:\n${violations
      .map((violation) => `  - [${violation.code}] ${violation.message}`)
      .join('\n')}`,
  );
}
