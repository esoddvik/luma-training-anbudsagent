import { DIGEST_NB, FOOTER_NB, immediateSubject, newMatchesSentence } from '../../copy.js';
import { formatDate } from '../../format.js';
import { buildLinks } from '../../links.js';
import type { ImmediateAlertContext, RenderedEmail } from '../../types.js';
import type { Part } from '../parts.js';
import { renderPromotion } from '../promotion.js';
import {
  renderCompetitions,
  renderHeader,
  renderLegalFooter,
  renderMatchCount,
  renderNotificationSettings,
  renderPlannedProcurements,
  renderProfileAdmin,
  renderTitle,
} from '../sections.js';
import { assemble } from '../shell.js';

/**
 * The immediate alert: one tender, sent as soon as it is matched.
 *
 * It follows the same section order as the digest (spec section 26), because
 * spec section 23.3 allows a promotion block at the bottom of a relevant
 * immediate alert and the placement rule has to hold identically here. A
 * planned procurement arriving as an immediate alert is rendered in the
 * planned section, not as a competition with a missing deadline.
 */
export function renderImmediateAlert(
  context: ImmediateAlertContext,
): RenderedEmail<'tender-immediate-v1'> {
  const links = buildLinks(context.links);
  const isPlanned = context.item.tender.noticeCategory === 'planned';

  const sections: (Part | null)[] = [
    renderHeader(),
    renderTitle(DIGEST_NB.immediateTitle, formatDate(context.now)),
    renderMatchCount(newMatchesSentence(1, context.profileName)),
    isPlanned ? null : renderCompetitions([context.item], links),
    isPlanned ? renderPlannedProcurements([context.item], links) : null,
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
    template: 'tender-immediate-v1',
    subject: immediateSubject(context.item.tender.title),
    preheader: context.item.tender.buyerName,
    sections,
  });
}
