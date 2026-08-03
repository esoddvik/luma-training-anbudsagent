import { createHash } from 'node:crypto';
import type { UtmMedium } from '@luma/domain';
import type { BaseEmailContext, SenderIdentity } from '@luma/email';
import type { ApiContext } from './context.js';

/**
 * The bits of email context the API supplies on every transactional send.
 *
 * `@luma/email` renders and nothing else, so the sender identity, the legal
 * links and the clock all have to come from the caller. Collecting them here
 * means a new transactional email cannot accidentally ship without a privacy
 * link in its footer (spec §18).
 */

/**
 * Luma Training's sender identity.
 *
 * A constant rather than configuration, because spec §48 defines no
 * environment variable for the postal address and inventing one would put a
 * legally required footer field outside the review that changes it. If Luma
 * moves, this line changes in a pull request that a person reads.
 */
export const LUMA_SENDER: SenderIdentity = {
  name: 'Luma Training',
  postalAddress: 'Luma Training AS, Oslo',
  contactEmail: 'post@luma-training.com',
};

export function baseEmailContext(
  ctx: ApiContext,
  recipientEmail: string,
  medium: UtmMedium = 'landing',
): BaseEmailContext {
  return {
    recipientEmail,
    sender: { ...LUMA_SENDER, contactEmail: ctx.config.authEmailFrom },
    links: {
      appUrl: ctx.config.appUrl,
      privacyUrl: ctx.config.privacyUrl,
      termsUrl: ctx.config.termsUrl,
      medium,
    },
    now: ctx.now(),
  };
}

/**
 * A stable, non-reversible identifier for a client address.
 *
 * Spec §40 requires data minimisation and the schema stores `ip_address_hash`
 * rather than an address. The pepper is the auth secret, so the same address
 * hashes differently in every environment and a database dump cannot be joined
 * back to a visitor log.
 */
export function hashIpAddress(ip: string | undefined, pepper: string): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`${pepper}:${ip}`, 'utf8').digest('hex');
}
