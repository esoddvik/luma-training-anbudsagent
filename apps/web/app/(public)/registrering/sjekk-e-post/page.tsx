import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Stack } from '@luma/ui';
import { resolveActionMessage } from '@/server/actions/messages';

export const metadata: Metadata = {
  title: 'Sjekk e-posten din',
  // Nothing here is worth indexing, and the page only makes sense as the
  // destination of a submission.
  robots: { index: false, follow: false },
};

/**
 * Where a signup submission lands (IDE Agent Spec v3, section 10's route list).
 *
 * **This page is the redirect target for every non-rate-limited submission,
 * known address or not.** That is not incidental — the destination is as
 * observable as the message, so a second page for "you already have an
 * account" would reopen the enumeration channel that `registration.ts` closes.
 * The copy below is therefore written to be true in both cases and to promise
 * nothing that would only make sense in one of them.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const message = resolveActionMessage(params['melding']);

  return (
    <Stack gap="lg">
      <h1 className="page-heading">Sjekk e-posten din</h1>
      <Stack gap="md" className="prose-measure">
        {message ? (
          <Alert tone={message.tone} role="status">
            <p className="m-0">{message.text}</p>
          </Alert>
        ) : null}
        <p className="m-0">
          Lenken er gyldig i én time og kan bare brukes én gang. Når du har bekreftet adressen, er
          varslingsprofilen din klar — den starter på pause, så du rekker å se over kriteriene før
          det første varselet går ut.
        </p>
        <p className="m-0 text-sm text-text-muted">
          Finner du ikke e-posten, se i søppelposten. Har du allerede en konto, kan du{' '}
          <Link href="/logg-inn">logge inn</Link> som vanlig.
        </p>
      </Stack>
    </Stack>
  );
}
