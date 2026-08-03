import type { Metadata } from 'next';
import { Card, Stack } from '@luma/ui';
import { PageHeader } from '../../_components/page-header';

export const metadata: Metadata = {
  title: 'MCP-tilkobling',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <PageHeader
        eyebrow="Integrasjoner"
        title="MCP-tilkobling"
        lede={
          <p className="m-0">
            Opprett et tilgangstoken og koble varslingsprofilen din til et MCP-kompatibelt
            AI-verktøy. Tokenet kan tilbakekalles når som helst, og du ser når det sist ble brukt.
          </p>
        }
      />
      <Card as="section" tone="secondary" className="prose-measure">
        <p className="m-0">Tokenadministrasjonen kobles til MCP-serveren.</p>
      </Card>
    </Stack>
  );
}
