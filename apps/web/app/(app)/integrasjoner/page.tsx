import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Integrasjoner',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Integrasjoner</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Koble Luma Anbudsvarsling til verktøyene du allerede bruker. I dag er MCP den
          tilgjengelige integrasjonen.
        </p>
        <p className="m-0">Flere integrasjoner vurderes etter lansering.</p>
      </Stack>
    </Stack>
  );
}
