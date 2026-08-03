import type { CoreEnv } from '@luma/config';
import type { SenderIdentity } from './types.js';

/**
 * The footer's sender identity, from configuration.
 *
 * Spec section 25 requires "avsenderinformasjon og kontaktinformasjon" in every
 * footer, and Norwegian marketing law expects a physical address there. Until
 * `SENDER_POSTAL_ADDRESS` existed, the only place to put one was a constant in
 * a service module — which works, and is invisible: an operator moving the
 * company has no way to discover that the address is theirs to change, because
 * nothing in the environment says so.
 *
 * The mapping lives here rather than at the call site for the same reason
 * `streamIdsFromEnv` does: it is the one place the environment vocabulary and
 * the package vocabulary meet, so a renamed variable breaks in one file.
 *
 * `SENDER_CONTACT_EMAIL` is deliberately not `AUTH_EMAIL_FROM`. The from-address
 * is a verified Postmark sender signature and is usually a no-reply; the
 * contact address is the one a recipient can actually write to. Passing the
 * former as the latter prints "Kontakt: ikke-svar@…" in the footer, which is
 * worse than printing nothing.
 */
type SenderEnv = Pick<CoreEnv, 'SENDER_NAME' | 'SENDER_POSTAL_ADDRESS' | 'SENDER_CONTACT_EMAIL'>;

export function senderIdentityFromEnv(env: SenderEnv): SenderIdentity {
  return {
    name: env.SENDER_NAME,
    postalAddress: env.SENDER_POSTAL_ADDRESS,
    contactEmail: env.SENDER_CONTACT_EMAIL,
  };
}
