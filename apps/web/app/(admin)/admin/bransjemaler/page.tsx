import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Bransjemaler',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Bransjemaler</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Rediger bransjemalene som nye brukere velger mellom under registrering, og se hvordan de
          fordeler seg.
        </p>
        <p className="m-0">Kobles til malbiblioteket.</p>
      </Stack>
    </Stack>
  );
}
