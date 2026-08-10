import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Card, Stack } from '@luma/ui';
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
    <div className="bleed">
      <div className="luma-panel mx-auto flex max-w-5xl justify-center py-2xl">
        <Card tone="raised" className="w-full max-w-xl">
          <Stack gap="md">
            <h1 className="page-heading m-0">Sjekk innboksen</h1>
            {message ? (
              <Alert tone={message.tone} role="status">
                <p className="m-0">{message.text}</p>
              </Alert>
            ) : null}
            {/*
              The design shows the address here («Vi har sendt en lenke til
              navn@firma.no») and a «Send på nytt (60 s)» button beside it.
              Neither survives contact with this page's actual constraints, and
              both were dropped rather than faked:

              - The address is not available. Putting it in the query string to
                render it would write a personal identifier into browser
                history, server logs and the Referer of every outbound link, and
                it would hand an enumerator the address back as proof the
                submission was accepted.
              - Resending needs the address for the same reason, so the button
                would need the same query parameter. The route to a second
                attempt is the form itself, which is one back-navigation away
                and already rate-limited server-side.
            */}
            <p className="m-0">
              Lenken er gyldig i én time og kan bare brukes én gang. Når du har bekreftet adressen,
              er varslingsprofilen din klar — den starter på pause, så du rekker å se over
              kriteriene før det første varselet går ut.
            </p>
            <p className="m-0 text-sm text-text-muted">
              Finner du ikke e-posten, se i søppelposten. Har du allerede en konto, kan du{' '}
              <Link href="/logg-inn">logge inn</Link> som vanlig.
            </p>
          </Stack>
        </Card>
      </div>
    </div>
  );
}
