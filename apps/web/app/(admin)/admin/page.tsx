import type { Metadata } from 'next';
import { Card, Stack } from '@luma/ui';
import { PageHeader } from '../../(app)/_components/page-header';

export const metadata: Metadata = {
  title: 'Administrasjon',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <PageHeader
        title="Administrasjon"
        lede={
          <p className="m-0">
            Driftsoversikt for Luma Anbudsvarsling: siste vellykkede Doffin-synkronisering,
            matchgjennomstrømning, køstatus, e-poststatus og aktive brukere.
          </p>
        }
      />
      <Card as="section" tone="secondary" className="prose-measure">
        <p className="m-0">Dashbordet kobles til driftsmålingene.</p>
      </Card>
    </Stack>
  );
}
