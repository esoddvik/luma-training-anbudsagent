import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert, buttonClassName, Stack } from '@luma/ui';
import { confirmSignup } from '@/server/registration';
import { withMessage } from '@/server/actions/messages';

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
 * On success the person lands on their new profile with the message the
 * profile page already shows for a freshly created one, because that is
 * exactly what has happened: `confirmSignup` creates it paused, and the
 * preview on that page is what they are meant to look at before activating.
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
    // `redirect` throws, so nothing below runs on the success path. The stored
    // return path wins when there is one; otherwise the new profile, which is
    // the thing they came here to get.
    redirect(result.returnPath ?? withMessage(`/varsler/${result.profileId}`, 'profil-opprettet'));
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
