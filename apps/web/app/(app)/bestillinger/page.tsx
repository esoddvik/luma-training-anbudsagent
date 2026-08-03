import type { Metadata } from 'next';
import { Card, Stack } from '@luma/ui';
import { PageHeader } from '../_components/page-header';

export const metadata: Metadata = {
  title: 'Bestillinger',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <PageHeader
        title="Bestillinger"
        lede={
          <p className="m-0">
            Bestillinger du har sendt på kursplass, Påfyll eller andre betalte tilbud fra Luma
            Training, med status og kontaktpunkt.
          </p>
        }
      />
      <Card as="section" tone="secondary" className="prose-measure">
        <p className="m-0">Bestillingsflyten behandles manuelt i MVP-et og kobles på her.</p>
      </Card>
    </Stack>
  );
}
