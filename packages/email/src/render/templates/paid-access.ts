import { FOOTER_NB, PAID_ACCESS_NB, paidAccessIntro } from '../../copy.js';
import { formatDate } from '../../format.js';
import { buildLinks, lumaLink } from '../../links.js';
import type { PaidAccessActivatedContext, RenderedEmail } from '../../types.js';
import * as h from '../html.js';
import type { Part } from '../parts.js';
import { renderHeader, renderLegalFooter, renderTitle } from '../sections.js';
import { assemble } from '../shell.js';
import * as t from '../text.js';

/** Access to a paid product has been activated (spec section 28.2, step 5). */
export function renderPaidAccessActivated(
  context: PaidAccessActivatedContext,
): RenderedEmail<'paid-access-activated-v1'> {
  const links = buildLinks(context.links);
  const accessUrl = lumaLink(context.accessUrl, context.links.medium);

  const body: Part = {
    html: [
      h.paragraph(paidAccessIntro(context.productName)),
      h.rawParagraph(`<strong>${h.link(accessUrl, PAID_ACCESS_NB.action)}</strong>`),
      h.paragraph(PAID_ACCESS_NB.invoiceNote, { muted: true }),
    ].join('\n'),
    text: [
      t.wrap(paidAccessIntro(context.productName)),
      '',
      t.labelledLink(PAID_ACCESS_NB.action, accessUrl),
      '',
      t.wrap(PAID_ACCESS_NB.invoiceNote),
    ].join('\n'),
  };

  return assemble({
    template: 'paid-access-activated-v1',
    subject: PAID_ACCESS_NB.subject,
    preheader: paidAccessIntro(context.productName),
    sections: [
      renderHeader(),
      renderTitle(PAID_ACCESS_NB.heading, formatDate(context.now)),
      body,
      renderLegalFooter({ links, sender: context.sender, why: FOOTER_NB.whyTransactional }),
    ],
  });
}
