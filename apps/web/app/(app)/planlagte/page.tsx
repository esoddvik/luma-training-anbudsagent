import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, Card, Cluster, Stack } from '@luma/ui';
import { ActionMessage } from '@/components/action-message';
import { EmptyStatePromotion } from '@/components/luma-promotion';
import { MatchCard } from '@/components/tender-card';
import { TenderActions } from '@/components/tender-actions';
import { getWebDb } from '@/server/db';
import { requireUser } from '@/server/session';
import { promotionAllowed } from '@/server/settings';
import { listMatches } from '@/server/tenders';
import { PageHeader } from '../_components/page-header';

export const metadata: Metadata = {
  title: 'Planlagte anskaffelser',
  description:
    'Anskaffelser oppdragsgiver har varslet, men ikke kunngjort ennå. De har ingen tilbudsfrist.',
};

/**
 * Planned procurements as a category of their own (spec section 16, launch
 * blocker 51.10).
 *
 * The page exists so that a planned procurement can never be mistaken for an
 * open competition. The explanation of what "planlagt" means is at the top,
 * before the list, and each card repeats the missing deadline in words rather
 * than leaving the field blank.
 *
 * The explanation sits on the supporting-information surface rather than
 * running as loose prose under the title. That is a visual restatement of the
 * same rule: what these notices are, and are not, is grouped and set apart
 * instead of blending into the page — and it is the neutral tint, never the
 * promotion cream, so it cannot read as a message from Luma.
 */

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await requireUser();
  const db = getWebDb();
  const now = new Date();

  const [matches, promotion] = await Promise.all([
    listMatches(db, { userId: user.id, filters: { category: 'planned' } }),
    promotionAllowed(db, user.id),
  ]);

  return (
    <Stack gap="lg">
      <PageHeader
        title="Planlagte anskaffelser"
        status={
          <Cluster gap="xs">
            <Badge variant="planlagt">Ikke kunngjort ennå</Badge>
          </Cluster>
        }
      />

      <Card as="section" tone="secondary" className="prose-measure">
        <Stack gap="sm">
          <p className="m-0">
            En planlagt anskaffelse er en veiledende kunngjøring eller en intensjonskunngjøring.
            Oppdragsgiver har varslet at anskaffelsen kommer, men{' '}
            <strong>konkurransen er ikke publisert ennå</strong>. Derfor finnes det ingen
            tilbudsfrist og ingen konkurransedokumenter å levere på.
          </p>
          <p className="m-0">
            Verdien ligger i tiden du får: du kan ta kontakt med oppdragsgiver, sette av kapasitet
            og forberede tilbudsarbeidet før konkurransen kommer. Du får varsel hvis den blir en
            kunngjort konkurranse.
          </p>
        </Stack>
      </Card>

      <ActionMessage code={params['melding']} />

      {matches.length === 0 ? (
        <Stack gap="md">
          <Alert tone="neutral" heading="Ingen planlagte anskaffelser å vise" titleLevel={2}>
            <Stack gap="sm">
              <p className="m-0">
                Ingen planlagte anskaffelser passer varslingsprofilene dine akkurat nå. Planlagte
                anskaffelser kunngjøres langt sjeldnere enn konkurranser, så det er normalt at
                listen er tom i perioder.
              </p>
              <p className="m-0">
                Sjekk at profilen din har slått på planlagte anskaffelser under{' '}
                <Link href="/varsler">Varsler</Link>. Innstillingen står på som standard.
              </p>
            </Stack>
          </Alert>
          <EmptyStatePromotion allowed={promotion} />
        </Stack>
      ) : (
        <Stack as="ul" gap="md" className="m-0 list-none p-0">
          {matches.map((match) => (
            <MatchCard key={match.matchId} match={match} now={now} headingLevel={2}>
              <TenderActions tenderId={match.tender.id} state={match.state} returnTo="/planlagte" />
            </MatchCard>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
