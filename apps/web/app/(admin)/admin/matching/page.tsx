import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Matching',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Matching</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Gjennomstrømning i matchingmotoren, andel treff som brukerne vurderer som relevante, og
          mulighet for å kjøre matching på nytt.
        </p>
        <p className="m-0">Kobles til matchingmotoren.</p>
      </Stack>
    </Stack>
  );
}
