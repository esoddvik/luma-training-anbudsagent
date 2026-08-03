import {
  ALERT_CONFIRMATION_NB,
  alertConfirmationSubject,
  FOOTER_NB,
  FREQUENCY_LABEL_NB,
} from '../../copy.js';
import { formatDate, formatValueRange } from '../../format.js';
import { buildLinks } from '../../links.js';
import type { AlertConfirmationContext, RenderedEmail } from '../../types.js';
import * as h from '../html.js';
import type { Part } from '../parts.js';
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
 * Confirmation that an alert profile is active (spec section 11).
 *
 * It repeats the criteria back to the user, because a profile that silently
 * matches nothing is the most common way this service can fail quietly, and
 * seeing the criteria in writing is the cheapest way to catch it. It also
 * carries the two pieces of approved copy from spec section 43 that set
 * expectations for everything that follows: the trust text and the coverage
 * text.
 */
export function renderAlertConfirmation(
  context: AlertConfirmationContext,
): RenderedEmail<'alert-confirmation-v1'> {
  const links = buildLinks(context.links);
  const profile = context.profile;

  const none = ALERT_CONFIRMATION_NB.noCriteria;
  const list = (values: readonly string[]): string =>
    values.length > 0 ? values.join(', ') : none;
  const value =
    formatValueRange(profile.estimatedValueMinNok, profile.estimatedValueMaxNok) ?? none;

  const criteria: ReadonlyArray<readonly [string, string]> = [
    [ALERT_CONFIRMATION_NB.cpvLabel, list(profile.cpvInclude)],
    [ALERT_CONFIRMATION_NB.keywordsLabel, list(profile.keywordsInclude)],
    [
      ALERT_CONFIRMATION_NB.regionsLabel,
      list([...profile.regionsInclude, ...profile.municipalitiesInclude]),
    ],
    [ALERT_CONFIRMATION_NB.buyersLabel, list(profile.buyerInclude)],
    [ALERT_CONFIRMATION_NB.valueLabel, value],
    [
      ALERT_CONFIRMATION_NB.plannedIncludedLabel,
      profile.includePlannedProcurements
        ? ALERT_CONFIRMATION_NB.plannedIncludedYes
        : ALERT_CONFIRMATION_NB.plannedIncludedNo,
    ],
    [ALERT_CONFIRMATION_NB.frequencyLabel, FREQUENCY_LABEL_NB[profile.frequency]],
  ];

  const body: Part = {
    html: [
      h.paragraph(ALERT_CONFIRMATION_NB.intro),
      h.heading(ALERT_CONFIRMATION_NB.criteriaHeading, 3),
      h.definitionList(criteria.map(([label, text]) => h.definitionRow(label, text))),
      h.rawParagraph(h.link(links.manageAlertProfile, ALERT_CONFIRMATION_NB.action)),
      h.paragraph(ALERT_CONFIRMATION_NB.trustText, { muted: true }),
      h.paragraph(ALERT_CONFIRMATION_NB.coverageText, { muted: true }),
    ].join('\n'),
    text: [
      t.wrap(ALERT_CONFIRMATION_NB.intro),
      '',
      ALERT_CONFIRMATION_NB.criteriaHeading,
      ...criteria.map(([label, text]) => t.definition(label, text)),
      '',
      t.labelledLink(ALERT_CONFIRMATION_NB.action, links.manageAlertProfile),
      '',
      t.wrap(ALERT_CONFIRMATION_NB.trustText),
      '',
      t.wrap(ALERT_CONFIRMATION_NB.coverageText),
    ].join('\n'),
  };

  return assemble({
    template: 'alert-confirmation-v1',
    subject: alertConfirmationSubject(profile.name),
    preheader: ALERT_CONFIRMATION_NB.intro,
    sections: [
      renderHeader(),
      renderTitle(ALERT_CONFIRMATION_NB.heading, formatDate(context.now)),
      body,
      renderProfileAdmin(links),
      renderNotificationSettings(links),
      renderLegalFooter({ links, sender: context.sender, why: FOOTER_NB.whyTenderAlerts }),
    ],
  });
}
