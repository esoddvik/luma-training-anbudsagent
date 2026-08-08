import { FOOTER_NB, SIGNUP_CONFIRMATION_NB, magicLinkValiditySentence } from '../../copy.js';
import { buildLinks } from '../../links.js';
import type { RenderedEmail, SignupConfirmationContext } from '../../types.js';
import * as h from '../html.js';
import type { Part } from '../parts.js';
import { renderHeader, renderLegalFooter, renderTitle } from '../sections.js';
import { assemble } from '../shell.js';
import * as t from '../text.js';
import { formatDate } from '../../format.js';

/**
 * Confirming the address that a search-first signup was submitted with
 * (IDE Agent Spec v3, section 3.1).
 *
 * Account-critical mail, so it follows `auth-magic-link-v1` exactly: no
 * promotion, no unsubscribe, no tracking indirection, and the URL printed in
 * full in both parts because a button that does not render leaves the reader
 * with nothing.
 *
 * The single branch below is on `hasExistingAccount`, and it changes one
 * sentence. Everything else — subject, heading, structure, footer, the link
 * itself — is byte-identical across the two, which is what keeps the two paths
 * a single code path rather than two templates that drift.
 */
export function renderSignupConfirmation(
  context: SignupConfirmationContext,
): RenderedEmail<'signup-confirmation-v1'> {
  const links = buildLinks(context.links);
  const intro = context.hasExistingAccount
    ? SIGNUP_CONFIRMATION_NB.introExisting
    : SIGNUP_CONFIRMATION_NB.introNew;
  const validity = magicLinkValiditySentence(context.validForMinutes);

  const body: Part = {
    html: [
      h.paragraph(intro),
      h.paragraph(`${SIGNUP_CONFIRMATION_NB.pausedNotice}`),
      h.rawParagraph(
        `<strong>${h.link(context.confirmUrl, SIGNUP_CONFIRMATION_NB.action)}</strong>`,
      ),
      h.paragraph(`${validity} ${SIGNUP_CONFIRMATION_NB.singleUse}`),
      h.paragraph(SIGNUP_CONFIRMATION_NB.fallbackIntro, { muted: true }),
      h.rawParagraph(h.link(context.confirmUrl, context.confirmUrl), { muted: true }),
      h.paragraph(SIGNUP_CONFIRMATION_NB.notRequested, { muted: true }),
    ].join('\n'),
    text: [
      t.wrap(intro),
      '',
      t.wrap(SIGNUP_CONFIRMATION_NB.pausedNotice),
      '',
      t.labelledLink(SIGNUP_CONFIRMATION_NB.action, context.confirmUrl),
      '',
      t.wrap(`${validity} ${SIGNUP_CONFIRMATION_NB.singleUse}`),
      '',
      t.wrap(SIGNUP_CONFIRMATION_NB.notRequested),
    ].join('\n'),
  };

  return assemble({
    template: 'signup-confirmation-v1',
    subject: SIGNUP_CONFIRMATION_NB.subject,
    preheader: validity,
    sections: [
      renderHeader(),
      renderTitle(SIGNUP_CONFIRMATION_NB.heading, formatDate(context.now)),
      body,
      renderLegalFooter({ links, sender: context.sender, why: FOOTER_NB.whyTransactional }),
    ],
  });
}
