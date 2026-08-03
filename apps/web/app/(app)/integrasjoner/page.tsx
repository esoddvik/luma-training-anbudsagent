import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonClassName, Card, Stack } from '@luma/ui';
import { PageHeader } from '../_components/page-header';

export const metadata: Metadata = {
  title: 'Integrasjoner',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <PageHeader
        title="Integrasjoner"
        lede={
          <p className="m-0">
            Koble Luma Anbudsvarsling til verktøyene du allerede bruker. I dag er MCP den
            tilgjengelige integrasjonen.
          </p>
        }
        /* MCP-siden står ikke i tjenestemenyen, så uten denne lenken er den
           bare tilgjengelig for den som kjenner adressen. */
        actions={
          <Link href="/integrasjoner/mcp" className={buttonClassName({ variant: 'secondary' })}>
            Sett opp MCP-tilkoblingen
          </Link>
        }
      />
      <Card as="section" tone="secondary" className="prose-measure">
        <p className="m-0">Flere integrasjoner vurderes etter lansering.</p>
      </Card>
    </Stack>
  );
}
