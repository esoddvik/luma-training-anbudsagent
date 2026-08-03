import { FOOTER_NB, MAGIC_LINK_NB, magicLinkValiditySentence } from '../../copy.js';
import { buildLinks } from '../../links.js';
import type { MagicLinkContext, RenderedEmail } from '../../types.js';
import * as h from '../html.js';
import type { Part } from '../parts.js';
import { renderHeader, renderLegalFooter, renderTitle } from '../sections.js';
import { assemble } from '../shell.js';
import * as t from '../text.js';
import { formatDate } from '../../format.js';

/**
 * The magic login link (spec section 10).
 *
 * Account-critical mail, so it carries no promotion, no unsubscribe and no
 * tracking-friendly indirection: the URL the user sees is the URL they get.
 * The link is printed in full in both parts, because a button that does not
 * render leaves the user with nothing.
 */
export function renderMagicLink(context: MagicLinkContext): RenderedEmail<'auth-magic-link-v1'> {
  const links = buildLinks(context.links);

  const body: Part = {
    html: [
      h.paragraph(MAGIC_LINK_NB.intro),
      h.rawParagraph(`<strong>${h.link(context.magicLinkUrl, MAGIC_LINK_NB.action)}</strong>`),
      h.paragraph(
        `${magicLinkValiditySentence(context.validForMinutes)} ${MAGIC_LINK_NB.singleUse}`,
      ),
      h.paragraph(MAGIC_LINK_NB.fallbackIntro, { muted: true }),
      h.rawParagraph(h.link(context.magicLinkUrl, context.magicLinkUrl), { muted: true }),
      h.paragraph(MAGIC_LINK_NB.notRequested, { muted: true }),
    ].join('\n'),
    text: [
      t.wrap(MAGIC_LINK_NB.intro),
      '',
      t.labelledLink(MAGIC_LINK_NB.action, context.magicLinkUrl),
      '',
      t.wrap(`${magicLinkValiditySentence(context.validForMinutes)} ${MAGIC_LINK_NB.singleUse}`),
      '',
      t.wrap(MAGIC_LINK_NB.notRequested),
    ].join('\n'),
  };

  return assemble({
    template: 'auth-magic-link-v1',
    subject: MAGIC_LINK_NB.subject,
    preheader: magicLinkValiditySentence(context.validForMinutes),
    sections: [
      renderHeader(),
      renderTitle(MAGIC_LINK_NB.heading, formatDate(context.now)),
      body,
      renderLegalFooter({ links, sender: context.sender, why: FOOTER_NB.whyTransactional }),
    ],
  });
}
