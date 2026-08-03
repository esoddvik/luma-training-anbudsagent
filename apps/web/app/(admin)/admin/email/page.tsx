import type { Metadata } from 'next';
import { PlaceholderPage } from '../../_components/placeholder-page';

export const metadata: Metadata = {
  title: 'E-post',
};

export default function Page() {
  return (
    <PlaceholderPage
      title="E-post"
      lede="Leveringsstatus per Postmark-strøm, med bounce, spamklager og avmeldinger."
      note="Kobles til Postmark-webhookene."
    />
  );
}
