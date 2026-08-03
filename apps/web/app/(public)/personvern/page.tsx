import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Personvern',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Personvern</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Luma Anbudsvarsling behandler personopplysninger etter Luma Trainings personvernerklæring.
          Her beskriver vi hvilke opplysninger tjenesten lagrer, hvorfor de lagres, hvor lenge de
          beholdes og hvordan du sletter kontoen din.
        </p>
        <p className="m-0">
          Teksten er ikke ferdigstilt. Endelig personvernomtale gjennomgås og publiseres før
          tjenesten åpnes for publikum.
        </p>
      </Stack>
    </Stack>
  );
}
