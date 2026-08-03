import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Innstillinger',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Innstillinger</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Her styrer du varslingsprofilen, hvor ofte du vil ha varsler, om du vil se faglig innhold
          fra Luma Training, markedsføringssamtykke og sletting av konto.
        </p>
        <p className="m-0">Skjemaene kobles til kontotjenesten.</p>
      </Stack>
    </Stack>
  );
}
