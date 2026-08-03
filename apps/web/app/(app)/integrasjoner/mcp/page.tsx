import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'MCP-tilkobling',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">MCP-tilkobling</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Opprett et tilgangstoken og koble varslingsprofilen din til et MCP-kompatibelt AI-verktøy.
          Tokenet kan tilbakekalles når som helst, og du ser når det sist ble brukt.
        </p>
        <p className="m-0">Tokenadministrasjonen kobles til MCP-serveren.</p>
      </Stack>
    </Stack>
  );
}
