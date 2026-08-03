import type { Metadata } from 'next';
import Link from 'next/link';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Fant ikke siden',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <Stack gap="md" className="prose-measure">
      <h1 className="page-heading">Fant ikke siden</h1>
      <p className="m-0">
        Adressen finnes ikke, eller innholdet er flyttet. Hvis du kom hit fra en delingslenke, kan
        lenken ha utløpt eller blitt opphevet.
      </p>
      <p className="m-0">
        <Link href="/">Gå til forsiden</Link>
      </p>
    </Stack>
  );
}
