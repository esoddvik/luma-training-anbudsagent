import { ACCOUNT_DELETE_NB, FOOTER_NB } from '../../copy.js';
import { formatDateTime } from '../../format.js';
import { buildLinks } from '../../links.js';
import type { AccountDeletedContext, RenderedEmail } from '../../types.js';
import * as h from '../html.js';
import type { Part } from '../parts.js';
import { renderHeader, renderLegalFooter, renderTitle } from '../sections.js';
import { assemble } from '../shell.js';
import * as t from '../text.js';

/**
 * Confirmation that an account was deleted (spec sections 4.4 and 18).
 *
 * The last email the user will get, so it says plainly what was removed and
 * what is kept for accounting and consent-documentation reasons, with a link
 * to the privacy policy for the retention periods. No promotion, no win-back
 * campaign: spec section 3 makes leaving as unencumbered as joining.
 */
export function renderAccountDeleted(
  context: AccountDeletedContext,
): RenderedEmail<'account-delete-confirmation-v1'> {
  const links = buildLinks(context.links);

  const body: Part = {
    html: [
      h.paragraph(`${ACCOUNT_DELETE_NB.intro} (${formatDateTime(context.deletedAt)})`),
      h.heading(ACCOUNT_DELETE_NB.deletedHeading, 3),
      h.bulletList(ACCOUNT_DELETE_NB.deletedItems),
      h.heading(ACCOUNT_DELETE_NB.retainedHeading, 3),
      h.paragraph(ACCOUNT_DELETE_NB.retainedBody),
      h.paragraph(ACCOUNT_DELETE_NB.noMoreEmails),
      h.paragraph(ACCOUNT_DELETE_NB.comeBack, { muted: true }),
    ].join('\n'),
    text: [
      t.wrap(`${ACCOUNT_DELETE_NB.intro} (${formatDateTime(context.deletedAt)})`),
      '',
      ACCOUNT_DELETE_NB.deletedHeading,
      ...ACCOUNT_DELETE_NB.deletedItems.map((item) => t.bullet(item)),
      '',
      ACCOUNT_DELETE_NB.retainedHeading,
      t.wrap(ACCOUNT_DELETE_NB.retainedBody),
      '',
      t.wrap(ACCOUNT_DELETE_NB.noMoreEmails),
      t.wrap(ACCOUNT_DELETE_NB.comeBack),
    ].join('\n'),
  };

  return assemble({
    template: 'account-delete-confirmation-v1',
    subject: ACCOUNT_DELETE_NB.subject,
    preheader: ACCOUNT_DELETE_NB.intro,
    sections: [
      renderHeader(),
      renderTitle(ACCOUNT_DELETE_NB.heading, formatDateTime(context.deletedAt)),
      body,
      renderLegalFooter({ links, sender: context.sender, why: FOOTER_NB.whyTransactional }),
    ],
  });
}
