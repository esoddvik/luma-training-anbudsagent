import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Varsel',
  description: 'Innholdet i et enkelt varsel, med treffene som ble sendt.',
};

interface AlertPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function AlertPage({ params }: AlertPageProps) {
  const { id } = await params;

  return (
    <Stack gap="lg">
      <h1 className="page-heading">Varsel</h1>
      <p className="m-0 text-sm text-text-muted">Referanse: {id}</p>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Her ser du hvilke treff varselet inneholdt, når det ble sendt, og hvilken varslingsprofil
          det kom fra.
        </p>
        <p className="m-0">Varselinnholdet kobles til e-postloggen.</p>
      </Stack>
    </Stack>
  );
}
