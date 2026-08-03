import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Oversikt',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Oversikt</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Nye treff vises øverst. Hvert treff viser oppdragsgiver, frist, kategori og en forklaring
          på hvorfor anbudet passer varslingsprofilen din.
        </p>
        <p className="m-0">Treffene hentes fra matchingmotoren og kobles på her.</p>
      </Stack>
    </Stack>
  );
}
