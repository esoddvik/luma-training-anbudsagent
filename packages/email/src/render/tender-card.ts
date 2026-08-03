import { CONFIDENCE_LABEL_NB, expectsDeadline, type MatchReason } from '@luma/domain';
import { CARD_NB, FALLBACK_NB } from '../copy.js';
import { formatDate, formatDateTime, formatValueRange } from '../format.js';
import { externalSourceLink, type EmailLinks } from '../links.js';
import type { TenderCardItem } from '../types.js';
import * as h from './html.js';
import { comment, MARKERS, type Part } from './parts.js';
import * as t from './text.js';

/**
 * One tender card (spec section 25).
 *
 * Required content: title, buyer, deadline - or the "Planlagt anskaffelse"
 * label where there is none - match level, two or three main reasons, a link
 * to the detail page, a link to Doffin, and save and dismiss links.
 *
 * Two rules are load-bearing:
 *
 * - A planned procurement never shows a deadline, not even an empty one, and
 *   certainly not a derived one. There is no competition yet, so there is no
 *   date to state (spec section 13, `expectsDeadline`).
 * - The match level is the approved vocabulary from `CONFIDENCE_LABEL_NB`. No
 *   numeric score appears on the card, so nothing here can read as a
 *   probability of winning (spec section 4.3).
 */

/** Spec section 25: two or three main reasons. Ordered by contribution. */
export const MAX_REASONS = 3;

export function mainReasons(reasons: readonly MatchReason[]): MatchReason[] {
  return [...reasons].sort((a, b) => b.contribution - a.contribution).slice(0, MAX_REASONS);
}

function reasonSentence(reason: MatchReason): string {
  if (reason.evidence.length === 0) return reason.label;
  return `${reason.label}: ${reason.evidence.join(', ')}`;
}

export interface TenderCardOptions {
  /**
   * Save and dismiss are rendered as links to the tender page carrying an
   * intent parameter, not as one-click mutations. Spec section 25 allows
   * dismiss only "dersom sikkert implementert", and a bare GET that mutates
   * state is exactly what an email scanner or a link prefetcher will trip.
   */
  readonly includeSaveAndDismiss?: boolean;
  /** `planned` switches the marker and the deadline row. */
  readonly variant?: 'competition' | 'planned';
}

export function renderTenderCard(
  item: TenderCardItem,
  links: EmailLinks,
  options?: TenderCardOptions,
): Part {
  const { tender, match } = item;
  const variant =
    options?.variant ?? (tender.noticeCategory === 'planned' ? 'planned' : 'competition');
  const isPlanned = variant === 'planned';
  const includeActions = options?.includeSaveAndDismiss ?? true;

  const detailUrl = links.tenderDetail(tender.id);
  const doffinUrl = externalSourceLink(tender.sourceUrl);
  const reasons = mainReasons(match.reasons);
  const value = formatValueRange(
    tender.estimatedValueMinNok,
    tender.estimatedValueMaxNok,
    tender.currency ?? 'NOK',
  );

  const deadlineRow: { label: string; value: string } = isPlanned
    ? { label: CARD_NB.deadlineLabel, value: CARD_NB.plannedLabel }
    : {
        label: CARD_NB.deadlineLabel,
        value:
          tender.deadlineAt && expectsDeadline(tender.noticeCategory)
            ? formatDateTime(tender.deadlineAt)
            : FALLBACK_NB.unknownDeadline,
      };

  const rows: string[] = [
    h.definitionRow(CARD_NB.buyerLabel, tender.buyerName || FALLBACK_NB.unknownBuyer),
    h.definitionRow(deadlineRow.label, deadlineRow.value),
    h.definitionRow(CARD_NB.matchLevelLabel, CONFIDENCE_LABEL_NB[match.confidence]),
    h.definitionRow(CARD_NB.publishedLabel, formatDate(tender.publishedAt)),
  ];
  if (value) rows.push(h.definitionRow(CARD_NB.valueLabel, value));

  const actionLinks: string[] = [
    h.link(detailUrl, CARD_NB.detailLink),
    h.link(doffinUrl, CARD_NB.doffinLink),
  ];
  if (includeActions) {
    actionLinks.push(h.link(links.saveTender(tender.id), CARD_NB.saveLink));
    actionLinks.push(h.link(links.dismissTender(tender.id), CARD_NB.dismissLink));
  }

  const body = [
    h.rawParagraph(`<strong>${h.link(detailUrl, tender.title)}</strong>`),
    h.definitionList(rows),
    isPlanned ? h.paragraph(CARD_NB.noDeadlineExplanation, { muted: true }) : '',
    reasons.length > 0 ? h.heading(CARD_NB.reasonsHeading, 3) : '',
    h.bulletList(reasons.map(reasonSentence)),
    h.rawParagraph(actionLinks.join(' &nbsp;·&nbsp; '), { muted: true }),
  ]
    .filter((chunk) => chunk.length > 0)
    .join('\n');

  const html = h.panel(body, {
    marker: isPlanned ? MARKERS.plannedCard(tender.id) : MARKERS.tenderCard(tender.id),
    background: isPlanned ? h.PALETTE.plannedBackground : h.PALETTE.cardBackground,
    borderColor: isPlanned ? h.PALETTE.plannedBorder : h.PALETTE.border,
    className: isPlanned ? 'luma-planned' : 'luma-panel',
    attributes: {
      'data-luma-card': isPlanned ? 'planned' : 'competition',
      'data-luma-tender-id': tender.id,
    },
  });

  const textLines: string[] = [
    t.underlined(tender.title),
    t.definition(CARD_NB.buyerLabel, tender.buyerName || FALLBACK_NB.unknownBuyer),
    t.definition(deadlineRow.label, deadlineRow.value),
    t.definition(CARD_NB.matchLevelLabel, CONFIDENCE_LABEL_NB[match.confidence]),
    t.definition(CARD_NB.publishedLabel, formatDate(tender.publishedAt)),
  ];
  if (value) textLines.push(t.definition(CARD_NB.valueLabel, value));
  if (isPlanned) textLines.push(CARD_NB.noDeadlineExplanation);
  if (reasons.length > 0) {
    textLines.push('', `${CARD_NB.reasonsHeading}:`);
    for (const reason of reasons) textLines.push(t.bullet(reasonSentence(reason)));
  }
  textLines.push('', t.labelledLink(CARD_NB.detailLink, detailUrl));
  textLines.push(t.labelledLink(CARD_NB.doffinLink, doffinUrl));
  if (includeActions) {
    textLines.push(t.labelledLink(CARD_NB.saveLink, links.saveTender(tender.id)));
    textLines.push(t.labelledLink(CARD_NB.dismissLink, links.dismissTender(tender.id)));
  }

  return { html, text: textLines.join('\n') };
}

/** The marker comment for a card, so tests can locate it without a parser. */
export function tenderCardMarker(tenderId: string, variant: 'competition' | 'planned'): string {
  return comment(
    variant === 'planned' ? MARKERS.plannedCard(tenderId) : MARKERS.tenderCard(tenderId),
  );
}
