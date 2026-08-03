import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, Card, Cluster, Stack } from '@luma/ui';
import { ActionMessage } from '@/components/action-message';
import { getWebDb } from '@/server/db';
import { ALERT_FREQUENCY_LABEL_NB, formatDate, isoDate } from '@/server/format';
import { listProfiles } from '@/server/profiles';
import { requireUser } from '@/server/session';

export const metadata: Metadata = {
  title: 'Varslingsprofiler',
  description:
    'Varslingsprofilene dine: hvilke oppdrag du vil høre om, hvor ofte, og om planlagte anskaffelser skal med.',
};

/**
 * The alert profile list (spec section 11).
 *
 * A user may have several profiles, and each can be paused independently
 * (section 4.4). The list therefore leads with the state — active or paused —
 * because a paused profile that looks active is the failure people notice
 * weeks later, when they wonder why the alerts stopped.
 */

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await requireUser();
  const profiles = await listProfiles(getWebDb(), user.id);

  return (
    <Stack gap="lg">
      <Cluster justify="between">
        <h1 className="page-heading">Varslingsprofiler</h1>
        <Link href="/varsler/ny" className="site-nav-link">
          Ny varslingsprofil
        </Link>
      </Cluster>

      <p className="prose-measure m-0 text-text-muted">
        En varslingsprofil beskriver hvilke oppdrag virksomheten din ser etter. Du kan ha flere
        profiler, sette dem på pause og slette dem. Eksklusjoner overstyrer alltid inklusjoner.
      </p>

      <ActionMessage code={params['melding']} />

      {profiles.length === 0 ? (
        <Alert tone="info" heading="Du har ingen varslingsprofil ennå" titleLevel={2}>
          <Stack gap="sm">
            <p className="m-0">
              Uten en profil har vi ingenting å matche kunngjøringene mot, så du får ingen varsler.
            </p>
            <p className="m-0">
              Start med en bransjemal. Da er CPV-koder og søkeord fylt ut på forhånd, og du kan
              endre alt etterpå.
            </p>
            <p className="m-0">
              <Link href="/varsler/ny">Opprett din første varslingsprofil</Link>
            </p>
          </Stack>
        </Alert>
      ) : (
        <Stack as="ul" gap="md" className="m-0 list-none p-0">
          {profiles.map((profile) => (
            <Card as="li" key={profile.id}>
              <Stack gap="sm">
                <Cluster gap="xs">
                  <Badge variant={profile.active ? 'success' : 'warning'}>
                    {profile.active ? 'Aktiv' : 'På pause'}
                  </Badge>
                  <Badge variant="neutral">{ALERT_FREQUENCY_LABEL_NB[profile.frequency]}</Badge>
                  {profile.includePlannedProcurements ? (
                    <Badge variant="planlagt">Planlagte anskaffelser er med</Badge>
                  ) : null}
                </Cluster>

                <h2 className="m-0 text-lg font-semibold">
                  <Link href={`/varsler/${profile.id}`}>{profile.name}</Link>
                </h2>

                {profile.description ? (
                  <p className="m-0 text-sm text-text-muted">{profile.description}</p>
                ) : null}

                <p className="m-0 text-sm">
                  {profile.matchCount === 0
                    ? 'Ingen treff registrert ennå'
                    : `${profile.matchCount} treff registrert`}{' '}
                  · opprettet{' '}
                  <time dateTime={isoDate(profile.createdAt)}>{formatDate(profile.createdAt)}</time>
                </p>

                {!profile.active ? (
                  <p className="m-0 text-sm text-text-muted">
                    Profilen er på pause. Du får ingen varsler fra den før du starter den igjen.
                  </p>
                ) : null}
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
