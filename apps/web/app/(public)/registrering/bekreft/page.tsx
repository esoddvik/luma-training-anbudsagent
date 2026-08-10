import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert, buttonClassName, Stack } from '@luma/ui';
import { recordFunnelEvent } from '@/server/funnel';
import { confirmSignup } from '@/server/registration';

/**
 * Where a confirmed signup goes: the review step, with the profile that was
 * just created and — when there is one — the return path it should end at.
 */
function reviewPath(profileId: string, returnPath: string | undefined): string {
  const query = new URLSearchParams({ profil: profileId });
  if (returnPath) query.set('retur', returnPath);
  return `/registrering/profil?${query.toString()}`;
}

export const metadata: Metadata = {
  // The URL carries a live credential. Keeping it out of any index is the
  // least we can do; the link is also single use and short-lived.
  title: 'Bekrefter e-postadressen',
  robots: { index: false, follow: false },
};

/**
 * The page the confirmation link lands on (IDE Agent Spec v3, section 3.1).
 *
 * The account is created here, during the render, for the same reasons
 * `logg-inn/bekreft` redeems here: the session cookie has to be set by the web
 * app rather than by the API on another host, and the user arrives by clicking
 * a link in an email client, which can only issue a `GET`. A `POST` would be
 * the tidier verb for something this consequential, and the mitigation is the
 * same — the token is single use and short-lived, so a mail scanner's prefetch
 * burns the link rather than handing anyone an account.
 *
 * On success the person lands on the review step, `(app)/registrering/profil`.
 * `confirmSignup` creates the profile paused, and that page is where they see
 * what was built from their choices, take out what does not fit, and switch it
 * on — the last step of the funnel (design B5, IDE Agent Spec v3, section 3.2).
 *
 * ## What happened to `returnPath`
 *
 * The stored return path exists so somebody who signed up from a trade page
 * lands back on it. It is **not dropped and it does not win here** — it is
 * carried into the review step as `retur` and honoured by the activation, which
 * redirects there instead of `/oversikt`.
 *
 * Letting it win at this point was the obvious alternative and it is the wrong
 * one: it would send the person back to a public results page holding a paused
 * profile that nobody has told them to activate, and a profile that is never
 * activated sends nothing to anyone. Preempting costs one screen; skipping
 * costs the whole reason they gave us an address. Carrying it costs neither.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawToken = params['token'];
  const token = typeof rawToken === 'string' ? rawToken : undefined;

  const result = await confirmSignup(token);

  if (result.ok) {
    // Recorded before the redirect: `redirect` throws, so anything after it
    // never runs. Under the same template slug the earlier funnel events used,
    // which is what makes the funnel a single chain rather than two lists.
    await recordFunnelEvent({
      type: 'signup_completed',
      ...(result.serviceTemplateSlug ? { serviceTemplateSlug: result.serviceTemplateSlug } : {}),
    });
    redirect(reviewPath(result.profileId, result.returnPath));
  }

  return (
    <Stack gap="lg">
      <h1 className="page-heading">Vi kunne ikke bekrefte adressen</h1>
      <Stack gap="md" className="prose-measure">
        <Alert tone="warning" heading="Lenken virket ikke">
          <p className="m-0">{result.message}</p>
        </Alert>
        <p className="m-0">
          Bekreftelseslenker er gyldige i én time og kan bare brukes én gang. Det er også vanlig at
          en e-postleser åpner lenken automatisk før du rekker å klikke på den. Sett opp varslingen
          på nytt, så sender vi en ny lenke.
        </p>
        <div>
          <Link href="/#registrering" className={buttonClassName({ variant: 'primary' })}>
            Sett opp varsling på nytt
          </Link>
        </div>
      </Stack>
    </Stack>
  );
}
