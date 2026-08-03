import { describe, expect, it } from 'vitest';
import { renderLegalFooter } from './render/sections.js';
import { buildLinks } from './links.js';
import { senderIdentityFromEnv } from './sender.js';
import * as f from './testing/fixtures.js';

/**
 * The footer's sender block comes from configuration (spec section 25).
 *
 * The assertion that matters is the last one: the configured postal address
 * reaches the rendered footer. A mapping that compiled but dropped the address
 * would leave every email legally short of a physical sender, and nothing else
 * in the suite looks at where the address came from.
 */
describe('senderIdentityFromEnv', () => {
  const env = {
    SENDER_NAME: 'Luma Training AS',
    SENDER_POSTAL_ADDRESS: 'Storgata 1, 0155 Oslo',
    SENDER_CONTACT_EMAIL: 'post@luma-training.com',
  };

  it('maps the three environment keys onto the sender identity', () => {
    expect(senderIdentityFromEnv(env)).toEqual({
      name: 'Luma Training AS',
      postalAddress: 'Storgata 1, 0155 Oslo',
      contactEmail: 'post@luma-training.com',
    });
  });

  it('puts the configured postal address and contact address in the footer', () => {
    const footer = renderLegalFooter({
      links: buildLinks(f.LINK_CONTEXT),
      sender: senderIdentityFromEnv(env),
      why: 'Testtekst.',
    });

    expect(footer.text).toContain('Storgata 1, 0155 Oslo');
    expect(footer.text).toContain('post@luma-training.com');
    expect(footer.html).toContain('Storgata 1, 0155 Oslo');
    expect(footer.html).toContain('mailto:post@luma-training.com');
  });
});
