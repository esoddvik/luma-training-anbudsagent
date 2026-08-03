import { SCORE_DISCLAIMER_NB } from '@luma/domain';
import {
  BRAND_NB,
  CARD_NB,
  COMMON_NB,
  DIGEST_NB,
  FOOTER_NB,
  plannedHeadingWithCount,
} from '../copy.js';
import { formatDate } from '../format.js';
import type { EmailLinks } from '../links.js';
import type { SenderIdentity, TenderCardItem, TenderChangeItem } from '../types.js';
import * as h from './html.js';
import { comment, joinParts, MARKERS, type Part } from './parts.js';
import { renderTenderCard } from './tender-card.js';
import * as t from './text.js';

/** Section 1 of spec section 26: the product name. */
export function renderHeader(): Part {
  const html = [
    comment(MARKERS.header),
    h.rawParagraph(`<strong>${h.escapeHtml(BRAND_NB.productName)}</strong>`),
    h.paragraph(BRAND_NB.freeServiceByline, { muted: true }),
  ].join('\n');
  return {
    html,
    text: `${BRAND_NB.productName}\n${BRAND_NB.freeServiceByline}`,
  };
}

/** Section 2: title and date. */
export function renderTitle(title: string, dateLabel: string): Part {
  const html = [
    comment(MARKERS.title),
    h.heading(title, 1),
    h.paragraph(dateLabel, { muted: true }),
  ].join('\n');
  return { html, text: `${t.underlined(title, '=')}\n${dateLabel}` };
}

/** Section 3: the count of new matches, plus the score disclaimer. */
export function renderMatchCount(sentence: string, options?: { withDisclaimer?: boolean }): Part {
  const withDisclaimer = options?.withDisclaimer ?? true;
  const html = [
    comment(MARKERS.count),
    h.paragraph(sentence),
    withDisclaimer ? h.paragraph(SCORE_DISCLAIMER_NB, { muted: true }) : '',
  ]
    .filter((chunk) => chunk.length > 0)
    .join('\n');
  const text = withDisclaimer
    ? `${t.wrap(sentence)}\n\n${t.wrap(SCORE_DISCLAIMER_NB)}`
    : t.wrap(sentence);
  return { html, text };
}

/** Section 4: the active competitions. */
export function renderCompetitions(
  items: readonly TenderCardItem[],
  links: EmailLinks,
): Part | null {
  if (items.length === 0) return null;
  const cards = items.map((item) => renderTenderCard(item, links, { variant: 'competition' }));
  const joined = joinParts(cards);
  return {
    html: [comment(MARKERS.competitions), joined.html].join('\n'),
    text: joined.text,
  };
}

/**
 * Section 5: planned procurements, in their own clearly marked section.
 *
 * Spec section 26 fixes both the heading with its count and the explanatory
 * line about the competition not being published yet. The section is rendered
 * only when there is something in it; an empty "Planlagte anskaffelser (0)"
 * heading would be noise.
 */
export function renderPlannedProcurements(
  items: readonly TenderCardItem[],
  links: EmailLinks,
): Part | null {
  if (items.length === 0) return null;
  const cards = joinParts(
    items.map((item) => renderTenderCard(item, links, { variant: 'planned' })),
  );

  const html = [
    comment(MARKERS.plannedStart),
    h.heading(plannedHeadingWithCount(items.length), 2),
    h.paragraph(DIGEST_NB.plannedExplanation),
    cards.html,
    comment(MARKERS.plannedEnd),
  ].join('\n');

  const text = [
    t.underlined(plannedHeadingWithCount(items.length), '='),
    t.wrap(DIGEST_NB.plannedExplanation),
    '',
    cards.text,
  ].join('\n');

  return { html, text };
}

/** Section 6: changes to tenders the user follows. */
export function renderSavedTenderChanges(
  items: readonly TenderChangeItem[],
  links: EmailLinks,
): Part | null {
  if (items.length === 0) return null;

  const entries = items.map((item) => {
    const detailUrl = links.tenderDetail(item.tender.id);
    const lines = item.changes.map(
      (change) => `${change.summary} (${formatDate(change.detectedAt)})`,
    );
    const html = h.panel(
      [
        h.rawParagraph(`<strong>${h.link(detailUrl, item.tender.title)}</strong>`),
        h.bulletList(lines),
        h.rawParagraph(h.link(detailUrl, CARD_NB.detailLink), { muted: true }),
      ].join('\n'),
      { attributes: { 'data-luma-card': 'change', 'data-luma-tender-id': item.tender.id } },
    );
    const text = [
      t.underlined(item.tender.title),
      ...lines.map((line) => t.bullet(line)),
      '',
      t.labelledLink(CARD_NB.detailLink, detailUrl),
    ].join('\n');
    return { html, text };
  });

  const joined = joinParts(entries);
  return {
    html: [comment(MARKERS.changes), h.heading(DIGEST_NB.changesHeading, 2), joined.html].join(
      '\n',
    ),
    text: [t.underlined(DIGEST_NB.changesHeading, '='), '', joined.text].join('\n'),
  };
}

/** Section 7: profile administration. Always present in a tender email. */
export function renderProfileAdmin(links: EmailLinks): Part {
  const items = [
    { label: FOOTER_NB.manageProfile, url: links.manageAlertProfile },
    { label: FOOTER_NB.pauseAlerts, url: links.pauseAlerts },
  ];
  const html = [
    comment(MARKERS.profileAdmin),
    h.heading(DIGEST_NB.profileAdminHeading, 3),
    h.rawBulletList(items.map((item) => h.link(item.url, item.label))),
  ].join('\n');
  const text = [
    DIGEST_NB.profileAdminHeading,
    ...items.map((item) => t.labelledLink(item.label, item.url)),
  ].join('\n');
  return { html, text };
}

/**
 * Section 9: notification settings.
 *
 * The promotion control appears here in every tender email, whether or not a
 * promotion block was rendered. Spec section 25 requires the footer to carry
 * it, and keeping it unconditional is what makes the promotion block a
 * cleanly removable span: the digest with promotion off is byte-for-byte the
 * digest with promotion on, minus the block.
 */
export function renderNotificationSettings(links: EmailLinks): Part {
  const items = [
    { label: FOOTER_NB.notificationSettings, url: links.notificationSettings },
    { label: FOOTER_NB.promotionSetting, url: links.disablePromotion },
    { label: FOOTER_NB.unsubscribeTenderAlerts, url: links.unsubscribeTenderAlerts },
  ];
  const html = [
    comment(MARKERS.notificationSettings),
    h.heading(DIGEST_NB.notificationSettingsHeading, 3),
    h.rawBulletList(items.map((item) => h.link(item.url, item.label))),
  ].join('\n');
  const text = [
    DIGEST_NB.notificationSettingsHeading,
    ...items.map((item) => t.labelledLink(item.label, item.url)),
  ].join('\n');
  return { html, text };
}

/** Section 10: why this email, privacy, terms, sender and contact information. */
export function renderLegalFooter(input: {
  links: EmailLinks;
  sender: SenderIdentity;
  why: string;
  /** Coverage honesty (spec section 5). Only meaningful on tender email. */
  coverageNote?: string;
}): Part {
  const { links, sender, why, coverageNote } = input;
  const legalItems = [
    { label: FOOTER_NB.privacy, url: links.privacy },
    { label: FOOTER_NB.terms, url: links.terms },
  ];

  const html = [
    comment(MARKERS.legal),
    h.separator(),
    h.heading(FOOTER_NB.whyHeading, 3),
    h.paragraph(why, { muted: true }),
    coverageNote ? h.paragraph(coverageNote, { muted: true }) : '',
    h.rawBulletList(legalItems.map((item) => h.link(item.url, item.label))),
    h.paragraph(`${COMMON_NB.senderHeading}: ${sender.name}, ${sender.postalAddress}`, {
      muted: true,
    }),
    h.rawParagraph(
      `${h.escapeHtml(COMMON_NB.contactHeading)}: <a class="luma-link" href="mailto:${h.escapeHtml(
        sender.contactEmail,
      )}" style="color:${h.PALETTE.link}">${h.escapeHtml(sender.contactEmail)}</a>`,
      { muted: true },
    ),
  ]
    .filter((chunk) => chunk.length > 0)
    .join('\n');

  const text = [
    t.rule(),
    FOOTER_NB.whyHeading,
    t.wrap(why),
    ...(coverageNote ? ['', t.wrap(coverageNote)] : []),
    '',
    ...legalItems.map((item) => t.labelledLink(item.label, item.url)),
    '',
    `${COMMON_NB.senderHeading}: ${sender.name}, ${sender.postalAddress}`,
    `${COMMON_NB.contactHeading}: ${sender.contactEmail}`,
  ].join('\n');

  return { html, text };
}

/** The empty state, used when a digest has no matches at all. */
export function renderEmptyState(links: EmailLinks): Part {
  const html = [
    h.heading(DIGEST_NB.emptyStateHeading, 2),
    h.paragraph(DIGEST_NB.emptyStateBody),
    h.rawParagraph(h.link(links.manageAlertProfile, DIGEST_NB.emptyStateAction)),
  ].join('\n');
  const text = [
    t.underlined(DIGEST_NB.emptyStateHeading, '='),
    t.wrap(DIGEST_NB.emptyStateBody),
    '',
    t.labelledLink(DIGEST_NB.emptyStateAction, links.manageAlertProfile),
  ].join('\n');
  return { html, text };
}
