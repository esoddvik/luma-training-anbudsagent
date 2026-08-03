import type { Metadata } from 'next';
import { PlaceholderPage } from '../../_components/placeholder-page';

export const metadata: Metadata = {
  title: 'Bestillinger',
};

export default function Page() {
  return (
    <PlaceholderPage
      title="Bestillinger"
      lede="Behandle innkomne bestillinger på kursplass, Påfyll og andre betalte tilbud, og aktivere tilgang manuelt."
      note="Kobles til bestillingsskjemaet."
    />
  );
}
