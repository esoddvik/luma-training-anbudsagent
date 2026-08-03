import type { Metadata } from 'next';
import { PlaceholderPage } from '../../_components/placeholder-page';

export const metadata: Metadata = {
  title: 'Redaksjonelle anbefalinger',
};

export default function Page() {
  return (
    <PlaceholderPage
      title="Redaksjonelle anbefalinger"
      lede="Administrer hvilke faglige anbefalinger fra Luma Training som er aktive, hvilken plass i promoteringstrappen de har, og hvilke regioner de rutes til."
      note="Kobles til redaksjonsmodellen."
    />
  );
}
