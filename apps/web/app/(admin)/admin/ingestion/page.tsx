import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Doffin-innhenting',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Doffin-innhenting</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Status for innhenting fra Doffin: antall hentet, opprettet, oppdatert og feilet per
          kjøring, med mulighet for å kjøre innhenting på nytt.
        </p>
        <p className="m-0">Kobles til ingest-jobbene.</p>
      </Stack>
    </Stack>
  );
}
