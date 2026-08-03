import { expectsDeadline } from '@luma/domain';
import {
  CARD_NB,
  DIGEST_NB,
  FALLBACK_NB,
  FOOTER_NB,
  MATERIAL_CHANGE_NB,
  materialChangeSubject,
} from '../../copy.js';
import { formatDate, formatDateTime } from '../../format.js';
import { buildLinks, externalSourceLink } from '../../links.js';
import type { MaterialChangeContext, RenderedEmail } from '../../types.js';
import * as h from '../html.js';
import { comment, MARKERS, type Part } from '../parts.js';
import { renderPromotion } from '../promotion.js';
import {
  renderHeader,
  renderLegalFooter,
  renderNotificationSettings,
  renderProfileAdmin,
  renderTitle,
} from '../sections.js';
import { assemble } from '../shell.js';
import * as t from '../text.js';

/**
 * A material change to a tender the user follows (spec section 13).
 *
 * The change list is the whole point of the email, so it comes first and the
 * detail is factual: what changed, from what, to what, and when it was
 * detected. The KGV note is not decoration - spec section 5 point 1 says the
 * service sees formal Doffin changes and not the competition's question and
 * answer stream, and an email about a change is exactly where a user could
 * otherwise conclude the opposite.
 */
export function renderMaterialChange(
  context: MaterialChangeContext,
): RenderedEmail<'tender-material-change-v1'> {
  const links = buildLinks(context.links);
  const { tender, changes } = context.item;
  const detailUrl = links.tenderDetail(tender.id);
  const doffinUrl = externalSourceLink(tender.sourceUrl);

  const deadlineValue =
    tender.deadlineAt && expectsDeadline(tender.noticeCategory)
      ? formatDateTime(tender.deadlineAt)
      : tender.noticeCategory === 'planned'
        ? CARD_NB.plannedLabel
        : FALLBACK_NB.unknownDeadline;

  const changeRows = changes.map((change) => {
    const detail: string[] = [];
    if (change.previousValue)
      detail.push(`${MATERIAL_CHANGE_NB.previousLabel}: ${change.previousValue}`);
    if (change.currentValue)
      detail.push(`${MATERIAL_CHANGE_NB.currentLabel}: ${change.currentValue}`);
    const suffix = detail.length > 0 ? ` (${detail.join('; ')})` : '';
    return `${change.summary}${suffix} – ${formatDate(change.detectedAt)}`;
  });

  const cardHtml = h.panel(
    [
      h.rawParagraph(`<strong>${h.link(detailUrl, tender.title)}</strong>`),
      h.definitionList([
        h.definitionRow(CARD_NB.buyerLabel, tender.buyerName || FALLBACK_NB.unknownBuyer),
        h.definitionRow(CARD_NB.deadlineLabel, deadlineValue),
      ]),
      h.paragraph(MATERIAL_CHANGE_NB.intro),
      h.bulletList(changeRows),
      h.rawParagraph(
        [h.link(detailUrl, CARD_NB.detailLink), h.link(doffinUrl, CARD_NB.doffinLink)].join(
          ' &nbsp;·&nbsp; ',
        ),
        { muted: true },
      ),
    ].join('\n'),
    {
      marker: MARKERS.tenderCard(tender.id),
      attributes: { 'data-luma-card': 'change', 'data-luma-tender-id': tender.id },
    },
  );

  const cardText = [
    t.underlined(tender.title),
    t.definition(CARD_NB.buyerLabel, tender.buyerName || FALLBACK_NB.unknownBuyer),
    t.definition(CARD_NB.deadlineLabel, deadlineValue),
    '',
    t.wrap(MATERIAL_CHANGE_NB.intro),
    ...changeRows.map((row) => t.bullet(row)),
    '',
    t.labelledLink(CARD_NB.detailLink, detailUrl),
    t.labelledLink(CARD_NB.doffinLink, doffinUrl),
  ].join('\n');

  const card: Part = {
    html: [comment(MARKERS.competitions), cardHtml].join('\n'),
    text: cardText,
  };

  const notes: Part = {
    html: [
      h.paragraph(MATERIAL_CHANGE_NB.verifyAtSource, { muted: true }),
      h.paragraph(MATERIAL_CHANGE_NB.kgvNote, { muted: true }),
    ].join('\n'),
    text: [t.wrap(MATERIAL_CHANGE_NB.verifyAtSource), '', t.wrap(MATERIAL_CHANGE_NB.kgvNote)].join(
      '\n',
    ),
  };

  const sections: (Part | null)[] = [
    renderHeader(),
    renderTitle(MATERIAL_CHANGE_NB.heading, formatDate(context.now)),
    card,
    notes,
    renderProfileAdmin(links),
    renderPromotion({
      promotion: context.promotion,
      preferences: context.preferences,
      links,
    }),
    renderNotificationSettings(links),
    renderLegalFooter({
      links,
      sender: context.sender,
      why: FOOTER_NB.whyTenderAlerts,
      coverageNote: DIGEST_NB.coverageNote,
    }),
  ];

  return assemble({
    template: 'tender-material-change-v1',
    subject: materialChangeSubject(tender.title),
    preheader: changes[0]?.summary ?? MATERIAL_CHANGE_NB.heading,
    sections,
  });
}
