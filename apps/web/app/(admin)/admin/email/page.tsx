import type { Metadata } from 'next';
import { Stack } from '@luma/ui';

export const metadata: Metadata = {
  title: 'E-post',
};

export default function Page() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">E-post</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Leveringsstatus per Postmark-strøm, med bounce, spamklager og avmeldinger.
        </p>
        <p className="m-0">Kobles til Postmark-webhookene.</p>
      </Stack>
    </Stack>
  );
}
