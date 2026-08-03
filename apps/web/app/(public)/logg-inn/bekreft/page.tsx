import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert, buttonClassName, Stack } from '@luma/ui';
import { completeLogin } from '@/server/login';
import { safeReturnPath } from '@/lib/return-path';

export const metadata: Metadata = {
  title: 'Bekrefter innlogging',
  // The URL carries a live credential. Keeping it out of any index is the
  // least we can do; the link is also single use and short-lived.
  robots: { index: false, follow: false },
};

/**
 * The page the magic link lands on.
 *
 * Redemption happens here, on the server, during the render of this page —
 * see `src/server/login.ts` for why it is not a call to the API. A `POST`
 * would be the tidier HTTP verb for something that mutates, but the user
 * arrives by clicking a link in an email client, which can only issue a `GET`.
 * The token is single use and short-lived, which is what makes that acceptable:
 * a prefetch by a mail scanner burns the link rather than granting a session to
 * anyone, and the user is told to request a new one.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawToken = params['token'];
  const token = typeof rawToken === 'string' ? rawToken : undefined;

  const rawReturn = params['retur'];
  const returnPath = safeReturnPath(typeof rawReturn === 'string' ? rawReturn : undefined);

  const result = await completeLogin(token);

  if (result.ok) {
    // `redirect` throws, so nothing below runs on the success path.
    redirect(returnPath ?? '/oversikt');
  }

  return (
    <Stack gap="lg">
      <h1 className="page-heading">Innloggingen kunne ikke fullføres</h1>
      <Stack gap="md" className="prose-measure">
        <Alert tone="warning" heading="Lenken virket ikke">
          <p className="m-0">{result.message}</p>
        </Alert>
        <p className="m-0">
          Innloggingslenker er gyldige i kort tid og kan bare brukes én gang. Det er også vanlig at
          en e-postleser åpner lenken automatisk før du rekker å klikke på den. Be om en ny lenke,
          så er du i gang.
        </p>
        <div>
          <Link href="/logg-inn" className={buttonClassName({ variant: 'primary' })}>
            Be om ny innloggingslenke
          </Link>
        </div>
      </Stack>
    </Stack>
  );
}
