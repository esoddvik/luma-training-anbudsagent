import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Planlagte anskaffelser',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Planlagte anskaffelser</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Planlagte anskaffelser er varslet, men ikke kunngjort ennå. De vises som egen kategori med
          tydelig merking, slik at du aldri forveksler dem med en åpen konkurranse.
        </p>
        <p className="m-0">Listen fylles ut når ingest av veiledende kunngjøringer er på plass.</p>
      </Stack>
    </Stack>
  );
}
