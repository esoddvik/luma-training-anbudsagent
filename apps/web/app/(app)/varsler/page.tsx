import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Varsler',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Varsler</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Her ser du sammendragene og de umiddelbare varslene som er sendt til deg, med tidspunkt og
          hvilke treff de inneholdt.
        </p>
        <p className="m-0">Varselhistorikken kobles til e-postloggen.</p>
      </Stack>
    </Stack>
  );
}
