import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Logg inn',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Logg inn</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Du logger inn med en engangslenke på e-post. Skriv inn adressen du registrerte deg med, så
          sender vi deg en lenke som er gyldig i kort tid.
        </p>
        <p className="m-0">
          Innloggingsskjemaet kobles til autentiseringstjenesten i et senere steg.
        </p>
      </Stack>
    </Stack>
  );
}
