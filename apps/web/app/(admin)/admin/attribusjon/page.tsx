import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Attribusjon',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Attribusjon</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Attribusjonsrapport med UTM-konsistens: bestillinger, webinarregistreringer, kursplasser
          og registreringer via delingslenker.
        </p>
        <p className="m-0">
          Attribusjonsdata rapporteres og skal aldri påvirke matching eller rangering.
        </p>
      </Stack>
    </Stack>
  );
}
