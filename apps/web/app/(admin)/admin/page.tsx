import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Administrasjon',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Administrasjon</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Driftsoversikt for Luma Anbudsvarsling: siste vellykkede Doffin-synkronisering,
          matchgjennomstrømning, køstatus, e-poststatus og aktive brukere.
        </p>
        <p className="m-0">Dashbordet kobles til driftsmålingene.</p>
      </Stack>
    </Stack>
  );
}
