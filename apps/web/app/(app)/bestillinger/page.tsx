import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'Bestillinger',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Bestillinger</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Bestillinger du har sendt på kursplass, Påfyll eller andre betalte tilbud fra Luma
          Training, med status og kontaktpunkt.
        </p>
        <p className="m-0">Bestillingsflyten behandles manuelt i MVP-et og kobles på her.</p>
      </Stack>
    </Stack>
  );
}
