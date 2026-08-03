import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'MCP',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">MCP</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Bruk av MCP-serveren: aktive tokener, verktøykall og mulighet for å tilbakekalle tilgang.
        </p>
        <p className="m-0">Kobles til MCP-serverens logg.</p>
      </Stack>
    </Stack>
  );
}
