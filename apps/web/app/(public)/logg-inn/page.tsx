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
    <Stack gap="lg">
      <h1 className="page-heading">Logg inn</h1>

      <ActionMessage code={params['melding']} />

      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Du logger inn med en engangslenke på e-post. Skriv inn adressen du registrerte deg med, så
          sender vi deg en lenke som er gyldig i {MAGIC_LINK_TTL_MINUTES} minutter og kan brukes én
          gang.
        </p>
      </Stack>

      <Card as="section" heading="Få innloggingslenke" titleLevel={2} className="prose-measure">
        <form action={requestLoginLinkAction}>
          <Stack gap="md">
            {/*
              The destination travels with the form rather than being read from
              the URL by the action, so a submission is self-contained. It is
              validated on the way in, again on the redirect, and a third time
              before it is written into the emailed link.
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
                  placeholder="navn@virksomhet.no"
                />
              )}
            </Field>
            <div>
              <Button type="submit" variant="primary">
                Send meg innloggingslenke
              </Button>
            </div>
          </Stack>
        </form>
      </Card>

      <Stack gap="md" className="prose-measure">
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
    </Stack>
  );
}
