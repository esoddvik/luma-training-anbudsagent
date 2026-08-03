import type { NotificationPreferences } from '@luma/domain';
import { FOOTER_NB, PROMOTION_NB } from '../copy.js';
import type { EmailLinks } from '../links.js';
import type { PromotionBlock } from '../promotion.js';
import * as h from './html.js';
import { comment, MARKERS, type Part } from './parts.js';
import * as t from './text.js';

/**
 * The promotion block, rendered (spec section 23.4).
 *
 * Everything this function does is a requirement, so the list is short and
 * each item is checked by a test:
 *
 * - It is fenced by a horizontal rule and drawn on its own background, so it
 *   reads as a separate thing rather than as another tender.
 * - It carries one of the approved headings and the section 43 disclosure.
 * - A paid offer is labelled "Betalt tilbud".
 * - It carries its own off switch.
 * - It renders nothing at all when the user has turned promotion off - and it
 *   refuses even if a caller hands it a block anyway, which is the second of
 *   the two independent checks on the off switch.
 *
 * Where it appears is not decided here. Templates place it after all tender
 * content, and the ordering test verifies that from the rendered output.
 */
export function renderPromotion(input: {
  promotion: PromotionBlock | null;
  preferences: NotificationPreferences;
  links: EmailLinks;
}): Part | null {
  const { promotion, preferences, links } = input;
  if (!promotion) return null;
  if (!preferences.includeLumaPromotionsInTenderEmails) return null;

  const badge = promotion.isPaid
    ? `<span style="${h.style({
        display: 'inline-block',
        padding: '2px 8px',
        'margin-bottom': '8px',
        'font-family': h.FONT_STACK,
        'font-size': '12px',
        'line-height': '1.4',
        color: h.PALETTE.mutedText,
        'background-color': h.PALETTE.cardBackground,
        border: `1px solid ${h.PALETTE.promotionBorder}`,
        'border-radius': '3px',
      })}" class="luma-muted">${h.escapeHtml(promotion.paidLabel)}</span>`
    : '';

  const body = [
    h.heading(promotion.heading, 2),
    badge,
    h.rawParagraph(`<strong>${h.escapeHtml(promotion.title)}</strong>`),
    h.paragraph(promotion.description),
    h.rawParagraph(h.link(promotion.url, PROMOTION_NB.readMore)),
    h.paragraph(promotion.disclosure, { muted: true }),
    h.rawParagraph(
      `${h.escapeHtml(PROMOTION_NB.offSwitchIntro)} ${h.link(
        links.disablePromotion,
        FOOTER_NB.disablePromotion,
      )}`,
      { muted: true },
    ),
  ]
    .filter((chunk) => chunk.length > 0)
    .join('\n');

  const html = [
    comment(MARKERS.promotionStart),
    h.separator(),
    h.panel(body, {
      background: h.PALETTE.promotionBackground,
      borderColor: h.PALETTE.promotionBorder,
      className: 'luma-promotion',
      attributes: {
        'data-luma-block': 'promotion',
        'data-luma-recommendation-id': promotion.recommendationId,
      },
    }),
    h.separator(),
    comment(MARKERS.promotionEnd),
  ].join('\n');

  const textLines: string[] = [
    t.rule(),
    promotion.heading,
    ...(promotion.isPaid ? [`[${promotion.paidLabel}]`] : []),
    '',
    promotion.title,
    t.wrap(promotion.description),
    '',
    t.labelledLink(PROMOTION_NB.readMore, promotion.url),
    '',
    t.wrap(promotion.disclosure),
    t.wrap(PROMOTION_NB.offSwitchIntro),
    t.labelledLink(FOOTER_NB.disablePromotion, links.disablePromotion),
    t.rule(),
  ];

  return { html, text: textLines.join('\n') };
}
