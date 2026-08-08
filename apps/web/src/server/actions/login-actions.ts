'use server';

import { redirect } from 'next/navigation';
import { clientIdentity } from '../client-identity';
import { requestLoginLink } from '../login';
import { loginPath } from '@/lib/return-path';
import { withMessage, type ActionMessageCode } from './messages';

/**
 * The login form's server action (spec section 10).
 *
 * A plain `<form action={...}>` with no client JavaScript, like every other
 * form in this app: the result comes back as a redirect carrying a `melding`
 * code, which `/logg-inn` renders into its live region. That is not only an
 * accessibility choice. This is the one form a person has to be able to submit
 * when everything else has gone wrong — an old browser, a blocked script, a
 * corporate proxy stripping bundles — because failing it means they cannot
 * reach their own account at all.
 *
 * The action itself makes no decisions. It reads the form, hands the work to
 * `requestLoginLink`, and turns the two possible outcomes into two codes.
 * Deliberately no third branch: `emailSent` is not consulted here, and adding
 * a code for it is how spec section 10's enumeration defence would be undone
 * by someone trying to be helpful.
 */

export async function requestLoginLinkAction(formData: FormData): Promise<void> {
  const rawEmail = formData.get('epost');
  const rawReturn = formData.get('retur');

  const { ip, userAgent } = await clientIdentity();

  const result = await requestLoginLink({
    // An absent or non-string field is passed through as an empty address
    // rather than short-circuited, so a malformed submission takes the same
    // path — and the same time — as a well-formed one.
    email: typeof rawEmail === 'string' ? rawEmail : '',
    returnPath: typeof rawReturn === 'string' ? rawReturn : undefined,
    ipAddress: ip,
    userAgent,
  });

  const code: ActionMessageCode = result.ok ? 'lenke-sendt' : 'for-mange-lenker';
  // `loginPath` re-validates `retur`, so the redirect target cannot be widened
  // by whatever was posted, and the next attempt still carries the destination.
  redirect(withMessage(loginPath(typeof rawReturn === 'string' ? rawReturn : undefined), code));
}
