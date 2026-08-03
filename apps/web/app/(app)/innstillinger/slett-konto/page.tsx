import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Button, Card, Field, Input, Stack } from '@luma/ui';
import { deleteAccountAction } from '@/server/actions/settings-actions';
import { requireUser } from '@/server/session';
import { privacyPolicyUrl } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Slett kontoen',
  description: 'Slett kontoen din og alle dataene som hører til den.',
  robots: { index: false, follow: false },
};

/**
 * Account deletion (spec section 40, launch blocker 51.14).
 *
 * On its own page, behind a typed confirmation, because it is irreversible and
 * because a delete button next to a save button will eventually be pressed by
 * accident. The confirmation is the account's own e-mail address: it cannot be
 * satisfied by muscle memory, and it makes clear *which* account is going.
 */

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await requireUser();
  const failed = params['feil'] === 'bekreftelse';

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <h1 className="page-heading">Slett kontoen</h1>
        <p className="m-0 text-text-muted">
          <Link href="/innstillinger">Tilbake til innstillinger</Link>
        </p>
      </Stack>

      {failed ? (
        <Alert tone="danger" live="assertive" heading="Bekreftelsen stemte ikke" titleLevel={2}>
          <p className="m-0">
            Skriv inn e-postadressen kontoen er registrert på, nøyaktig slik den står. Ingenting er
            slettet.
          </p>
        </Alert>
      ) : null}

      <Alert tone="warning" heading="Dette skjer når du sletter" titleLevel={2}>
        <ul className="m-0 list-disc pl-lg">
          <li>Kontoen og innloggingen din fjernes.</li>
          <li>Varslingsprofilene, lagrede anbud og tilbakemeldingene dine fjernes.</li>
          <li>Aktive delingslenker slutter å virke umiddelbart.</li>
          <li>Du slutter å motta anbudsvarsler.</li>
          <li>
            Samtykkehistorikken beholdes uten kobling til deg, fordi Luma Training må kunne
            dokumentere hva som ble samtykket til og når.
          </li>
        </ul>
      </Alert>

      <p className="prose-measure m-0">
        Vil du bare slutte å få e-post, trenger du ikke slette kontoen. Du kan slå av anbudsvarslene
        under <Link href="/innstillinger">Innstillinger</Link> og beholde profilene dine.
      </p>

      <Card as="section" heading="Bekreft sletting" titleLevel={2}>
        <form action={deleteAccountAction}>
          <Stack gap="md">
            <Field
              id="bekreftelse"
              label={`Skriv inn ${user.email} for å bekrefte`}
              required
              hint="Handlingen kan ikke angres."
            >
              {(control) => (
                <Input
                  {...control}
                  name="bekreftelse"
                  type="email"
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </Field>
            <Button type="submit" variant="danger">
              Slett kontoen min permanent
            </Button>
          </Stack>
        </form>
      </Card>

      <p className="m-0 text-sm text-text-muted">
        <a href={privacyPolicyUrl()} rel="noreferrer noopener" target="_blank">
          Luma Trainings personvernerklæring
        </a>{' '}
        beskriver hvordan personopplysninger behandles og hvor lenge de lagres.
      </p>
    </Stack>
  );
}
