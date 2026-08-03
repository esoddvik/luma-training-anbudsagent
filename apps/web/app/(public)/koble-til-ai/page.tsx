import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Koble til AI-verktøyet ditt',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Koble til AI-verktøyet ditt</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Du kan koble varslingsprofilen din til ChatGPT, Claude eller et annet MCP-kompatibelt
          AI-verktøy. Da kan du søke etter relevante anbud, undersøke hvorfor de matcher og følge
          endringer uten å forlate samtalen.
        </p>
        <p className="m-0">
          Oppsettsveiledningen med adresse til MCP-serveren og opprettelse av tilgangstoken kommer
          her.
        </p>
      </Stack>
    </Stack>
  );
}
