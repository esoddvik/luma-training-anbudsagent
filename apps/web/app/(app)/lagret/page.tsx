import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Stack } from '@luma/ui';
import { ActionMessage } from '@/components/action-message';
import { TenderCard } from '@/components/tender-card';
import { TenderActions } from '@/components/tender-actions';
import { getWebDb } from '@/server/db';
import { requireUser } from '@/server/session';
import { listSavedTenders } from '@/server/tenders';

export const metadata: Metadata = {
  title: 'Lagrede anbud',
  description: 'Anbud du har lagret for å følge opp senere, med frist og kildelenke.',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await requireUser();
  const db = getWebDb();
  const now = new Date();

  const saved = await listSavedTenders(db, user.id);

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <h1 className="page-heading">Lagrede anbud</h1>
        <p className="prose-measure m-0 text-text-muted">
          Anbud du har lagret for å følge opp senere. Endres kunngjøringen — for eksempel fristen —
          får du beskjed.
        </p>
      </Stack>

      <ActionMessage code={params['melding']} />

      {saved.length === 0 ? (
        <Alert tone="neutral" heading="Du har ingen lagrede anbud" titleLevel={2}>
          <p className="m-0">
            Bruk «Lagre anbudet» på et treff i <Link href="/oversikt">Oversikt</Link> eller på
            anbudsdetaljsiden, så samler du dem her.
          </p>
        </Alert>
      ) : (
        <Stack as="ul" gap="md" className="m-0 list-none p-0">
          {saved.map((tender) => (
            <TenderCard key={tender.id} tender={tender} state="saved" now={now}>
              <TenderActions tenderId={tender.id} state="saved" returnTo="/lagret" />
            </TenderCard>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
