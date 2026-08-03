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
          Behandle innkomne bestillinger på kursplass, Påfyll og andre betalte tilbud, og aktivere
          tilgang manuelt.
        </p>
        <p className="m-0">Kobles til bestillingsskjemaet.</p>
      </Stack>
    </Stack>
  );
}
