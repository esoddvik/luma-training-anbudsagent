import type { Metadata } from 'next';
import { PlaceholderPage } from '../../_components/placeholder-page';

export const metadata: Metadata = {
  title: 'Matching',
};

export default function Page() {
  return (
    <PlaceholderPage
      title="Matching"
      lede="Gjennomstrømning i matchingmotoren, andel treff som brukerne vurderer som relevante, og mulighet for å kjøre matching på nytt."
      note="Kobles til matchingmotoren."
    />
  );
}
