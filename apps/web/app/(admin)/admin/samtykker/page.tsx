import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Samtykker',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Samtykker</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Samtykkehistorikk med kilde, dato og tekstversjon, samt hvilke vilkårsversjoner som er
          akseptert.
        </p>
        <p className="m-0">Kobles til samtykkeloggen.</p>
      </Stack>
    </Stack>
  );
}
