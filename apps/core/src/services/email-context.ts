import { createHash } from 'node:crypto';
import type { UtmMedium } from '@luma/domain';
import type { BaseEmailContext } from '@luma/email';
import type { ApiContext } from './context.js';

/**
 * The bits of email context the API supplies on every transactional send.
 *
 * `@luma/email` renders and nothing else, so the sender identity, the legal
 * links and the clock all have to come from the caller. Collecting them here
 * means a new transactional email cannot accidentally ship without a privacy
 * link in its footer (spec §18).
 *
 * The sender identity used to be a constant in this file, with `contactEmail`
 * overridden to `AUTH_EMAIL_FROM`. Both are gone. It now comes from
 * configuration through `senderIdentityFromEnv`, and the contact address is
 * `SENDER_CONTACT_EMAIL` — a mailbox somebody reads, rather than the verified
 * no-reply sender signature a reply would have vanished into.
 */

export function baseEmailContext(
  ctx: ApiContext,
  recipientEmail: string,
  medium: UtmMedium = 'landing',
): BaseEmailContext {
  return {
    recipientEmail,
    sender: ctx.config.sender,
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
