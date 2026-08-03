import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Delinger',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Delinger</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Oversikt over delingslenker du har laget, hvor mange ganger de er åpnet og når de utløper.
          Du kan oppheve en lenke når som helst.
        </p>
        <p className="m-0">Delingsadministrasjonen kobles til delingstjenesten.</p>
      </Stack>
    </Stack>
  );
}
