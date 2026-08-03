import type { Metadata } from 'next';
import { PlaceholderPage } from '../../_components/placeholder-page';

export const metadata: Metadata = {
  title: 'Bransjemaler',
};

export default function Page() {
  return (
    <PlaceholderPage
      title="Bransjemaler"
      lede="Rediger bransjemalene som nye brukere velger mellom under registrering, og se hvordan de fordeler seg."
      note="Kobles til malbiblioteket."
    />
  );
}
