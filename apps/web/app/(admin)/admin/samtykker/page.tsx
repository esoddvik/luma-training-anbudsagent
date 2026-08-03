import type { Metadata } from 'next';
import { PlaceholderPage } from '../../_components/placeholder-page';

export const metadata: Metadata = {
  title: 'Samtykker',
};

export default function Page() {
  return (
    <PlaceholderPage
      title="Samtykker"
      lede="Samtykkehistorikk med kilde, dato og tekstversjon, samt hvilke vilkårsversjoner som er akseptert."
      note="Kobles til samtykkeloggen."
    />
  );
}
