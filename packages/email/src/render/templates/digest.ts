import {
  dailyDigestSubject,
  DIGEST_NB,
  FOOTER_NB,
  newMatchesSentence,
  weeklyDigestSubject,
} from '../../copy.js';
import { formatDate, formatDateRange } from '../../format.js';
import { buildLinks } from '../../links.js';
import type { DigestContext, RenderedEmail } from '../../types.js';
import type { Part } from '../parts.js';
import { renderPromotion } from '../promotion.js';
import {
  renderCompetitions,
  renderEmptyState,
  renderHeader,
  renderLegalFooter,
  renderMatchCount,
  renderNotificationSettings,
  renderPlannedProcurements,
  renderProfileAdmin,
  renderSavedTenderChanges,
  renderTitle,
} from '../sections.js';
import { assemble } from '../shell.js';

/**
 * The daily and weekly digests.
 *
 * The section order is spec section 26 and is not negotiable:
 *
 *  1 Luma Anbudsvarsling
 *  2 title and date
 *  3 count of new matches
 *  4 tender cards, active competitions
 *  5 planned procurements, own clearly marked section
 *  6 changes to saved tenders
 *  7 profile administration
 *  8 clearly separated Luma promotion
 *  9 notification settings
 * 10 privacy, terms, sender information
 *
 * The array below *is* that list, in that order, and the ordering test reads
 * the order back out of the rendered HTML rather than out of this file.
 */
export type DigestVariant = 'daily' | 'weekly';

export type DigestEmail = RenderedEmail<'tender-daily-digest-v1' | 'tender-weekly-digest-v1'>;

export function renderDigest(context: DigestContext, variant: DigestVariant): DigestEmail {
  const links = buildLinks(context.links);
  const totalNew = context.competitions.length + context.plannedProcurements.length;

  const title = variant === 'daily' ? DIGEST_NB.dailyTitle : DIGEST_NB.weeklyTitle;
  const dateLabel =
    variant === 'daily'
      ? formatDate(context.periodEnd)
      : formatDateRange(context.periodStart, context.periodEnd);
  const subject =
    variant === 'daily'
      ? dailyDigestSubject(totalNew, context.profileName)
      : weeklyDigestSubject(totalNew, context.profileName);

  const hasContent = totalNew > 0 || context.savedTenderChanges.length > 0;

  const sections: (Part | null)[] = [
    renderHeader(),
    renderTitle(title, dateLabel),
    renderMatchCount(newMatchesSentence(totalNew, context.profileName), {
      withDisclaimer: totalNew > 0,
    }),
    renderCompetitions(context.competitions, links),
    renderPlannedProcurements(context.plannedProcurements, links),
    renderSavedTenderChanges(context.savedTenderChanges, links),
    hasContent ? null : renderEmptyState(links),
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
    template: variant === 'daily' ? 'tender-daily-digest-v1' : 'tender-weekly-digest-v1',
    subject,
    preheader: newMatchesSentence(totalNew, context.profileName),
    sections,
  });
}

export function renderDailyDigest(context: DigestContext): DigestEmail {
  return renderDigest(context, 'daily');
}

export function renderWeeklyDigest(context: DigestContext): DigestEmail {
  return renderDigest(context, 'weekly');
}
