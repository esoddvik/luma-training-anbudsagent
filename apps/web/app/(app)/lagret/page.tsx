import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Lagrede anbud',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Lagrede anbud</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Anbud du har lagret for å følge opp senere. Fristen vises tydelig, og du får beskjed hvis
          kunngjøringen endres.
        </p>
        <p className="m-0">Lagringsfunksjonen kobles på sammen med anbudsdetaljsiden.</p>
      </Stack>
    </Stack>
  );
}
