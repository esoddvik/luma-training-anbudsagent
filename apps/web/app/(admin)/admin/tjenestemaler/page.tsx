import type { Metadata } from 'next';
import { PlaceholderPage } from '../../_components/placeholder-page';

export const metadata: Metadata = {
  title: 'Tjenestemaler',
};

export default function Page() {
  return (
    <PlaceholderPage
      title="Tjenestemaler"
      lede="Rediger tjenestemalene som nye brukere velger mellom under registrering, og se hvordan de fordeler seg."
      note="Kobles til malbiblioteket."
    />
  );
}
