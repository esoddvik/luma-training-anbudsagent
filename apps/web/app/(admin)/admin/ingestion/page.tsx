import type { Metadata } from 'next';
import { PlaceholderPage } from '../../_components/placeholder-page';

export const metadata: Metadata = {
  title: 'Doffin-innhenting',
};

export default function Page() {
  return (
    <PlaceholderPage
      title="Doffin-innhenting"
      lede="Status for innhenting fra Doffin: antall hentet, opprettet, oppdatert og feilet per kjøring, med mulighet for å kjøre innhenting på nytt."
      note="Kobles til ingest-jobbene."
    />
  );
}
