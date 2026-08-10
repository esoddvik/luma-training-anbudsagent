import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, Card, Field, Input, Stack } from '@luma/ui';
import { MAGIC_LINK_TTL_MINUTES } from '@luma/auth';
import { ActionMessage } from '@/components/action-message';
import { requestLoginLinkAction } from '@/server/actions/login-actions';
import { safeReturnPath } from '@/lib/return-path';

export const metadata: Metadata = {
  title: 'Logg inn',
  description:
    'Logg inn på Luma Anbudsvarsling med en engangslenke på e-post. Ingen passord å huske.',
};

/**
 * Requesting a magic login link (spec section 10, journey 9.1 step 4).
 *
 * A real form with a real action, no client JavaScript, and the confirmation
 * announced through `ActionMessage`'s live region rather than a toast. The page
 * is rendered per request because the `melding` code lives in the query string.
 *
 * Two pieces of copy are doing specific work and should not be softened:
 *
 * - The confirmation never says whether the address is registered. That is
 *   `MAGIC_LINK_GENERIC_RESPONSE_NB`, and it is what stops the form being used
 *   to find out which businesses are Luma customers (section 10).
 * - Because the confirmation cannot say "you have no profile yet", the page
 *   says it in advance, to everyone, before they type. Otherwise a person
 *   without an account would get a cheerful confirmation, wait for an email
 *   that is never coming, and have no way to find out why.
 */

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawReturn = params['retur'];
  const returnPath = safeReturnPath(typeof rawReturn === 'string' ? rawReturn : undefined);

  return (
    <div className="bleed">
      <div className="luma-panel mx-auto flex max-w-5xl flex-col items-center gap-lg py-2xl">
        {/*
          B7 in the funnel design is one centred card on the cream panel, and
          the h1 lives inside it rather than above it. The heading is still an
          h1 and still reads «Logg inn» — the e2e suite asserts both, and the
          page would be wrong without them either way.
        */}
        <Card as="section" tone="raised" className="w-full max-w-lg">
          <Stack gap="md">
            <h1 className="page-heading m-0">Logg inn</h1>

            <ActionMessage code={params['melding']} />

            <p className="m-0">
              Skriv e-posten din, så sender vi en lenke. Ingen passord å huske. Lenken er gyldig i{' '}
              {MAGIC_LINK_TTL_MINUTES} minutter og kan brukes én gang.
            </p>

            <form action={requestLoginLinkAction}>
              <Stack gap="md">
                {/*
                  The destination travels with the form rather than being read
                  from the URL by the action, so a submission is self-contained.
                  It is validated on the way in, again on the redirect, and a
                  third time before it is written into the emailed link.
                */}
                {returnPath === undefined ? null : (
                  <input type="hidden" name="retur" value={returnPath} />
                )}
                <Field
                  id="epost"
                  label="E-postadresse"
                  hint="Adressen du bruker på varslingsprofilen din."
                  required
                >
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      name="epost"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      placeholder="navn@firma.no"
                    />
                  )}
                </Field>
                <Button type="submit" variant="primary" fullWidth>
                  Send meg innloggingslenke
                </Button>
              </Stack>
            </form>

            <p className="m-0 text-sm">
              <Link href="/personvern">Personvern</Link>
            </p>
          </Stack>
        </Card>

        {/*
          Below the card, not inside it. The confirmation cannot say "you have
          no profile yet" without turning the form into a customer-list oracle
          (spec 10), so the page says it in advance, to everyone, before they
          type — otherwise someone without an account waits for an email that
          is never coming and has no way to find out why.
        */}
        <Stack gap="sm" className="prose-measure w-full max-w-lg">
          <h2 className="section-heading m-0">Har du ikke varslingsprofil ennå?</h2>
          <p className="m-0">
            Vi sender innloggingslenke bare til adresser som allerede har en varslingsprofil, og av
            hensyn til personvernet sier bekreftelsen ovenfor det samme uansett hvilken adresse du
            skriver inn. Kommer det ingen e-post, er det mest sannsynlig fordi adressen ikke er
            registrert hos oss. <Link href="/#registrering">Opprett varslingsprofil</Link> — det er
            gratis og tar noen minutter.
          </p>
          <p className="m-0 text-sm text-text-muted">
            Sjekk også søppelposten. Har du bedt om flere lenker, er det den nyeste som virker.
          </p>
        </Stack>
      </div>
    </div>
  );
}
