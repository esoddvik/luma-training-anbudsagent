import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Redaksjonelle anbefalinger',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Redaksjonelle anbefalinger</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Administrer hvilke faglige anbefalinger fra Luma Training som er aktive, hvilken plass i
          promoteringstrappen de har, og hvilke regioner de rutes til.
        </p>
        <p className="m-0">Kobles til redaksjonsmodellen.</p>
      </Stack>
    </Stack>
  );
}
