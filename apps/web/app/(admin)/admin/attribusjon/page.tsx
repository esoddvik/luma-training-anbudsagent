import type { Metadata } from 'next';
import { PlaceholderPage } from '../../_components/placeholder-page';

export const metadata: Metadata = {
  title: 'Attribusjon',
};

export default function Page() {
  return (
    <PlaceholderPage
      title="Attribusjon"
      lede="Attribusjonsrapport med UTM-konsistens: bestillinger, webinarregistreringer, kursplasser og registreringer via delingslenker."
      note="Attribusjonsdata rapporteres og skal aldri påvirke matching eller rangering."
    />
  );
}
