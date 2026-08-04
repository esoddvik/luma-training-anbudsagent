import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Anbudsvarsler i AI-verktøyet ditt',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Anbudsvarsler i AI-verktøyet ditt</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Du kan koble varslingsprofilen din til ChatGPT, Claude eller et annet MCP-kompatibelt
          AI-verktøy. Da kan du søke etter relevante anbud, undersøke hvorfor de matcher og følge
          endringer uten å forlate samtalen.
        </p>
        <p className="m-0">
          <strong>Selve tilkoblingen skjer inne i tjenesten.</strong> Den bruker et tilgangstoken
          som er knyttet til varslingsprofilen din, og tokenet oppretter du under Integrasjoner
          etter at du har registrert deg. Denne siden forklarer hva koblingen gjør, ikke hvordan du
          setter den opp.
        </p>
        <p className="m-0">
          Selve oppsettsveiledningen — adressen til MCP-serveren og eksempelkonfigurasjon for
          ChatGPT og Claude — kommer her.
        </p>
      </Stack>
    </Stack>
  );
}
