import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, Button, Card, Cluster, Stack } from '@luma/ui';
import { ActionMessage } from '@/components/action-message';
import { MatchPreview } from '@/components/match-preview';
import { ProfileForm } from '@/components/profile-form';
import {
  deleteProfileAction,
  toggleProfileActiveAction,
  updateProfileAction,
} from '@/server/actions/profile-actions';
import { getWebDb } from '@/server/db';
import { loadProfile, previewMatches } from '@/server/profiles';
import { requireUser } from '@/server/session';

export const metadata: Metadata = {
  title: 'Varslingsprofil',
  description: 'Rediger kriteriene i en varslingsprofil og se en forhåndsvisning av treffene.',
};

/**
 * The alert profile editor (spec sections 11 and 9.1).
 *
 * The preview sits directly under the form, because section 9.1 has the user
 * adjust the profile *after* seeing what it catches (steps 11 and 12). It is
 * computed on every render from the saved profile, so pressing Save and looking
 * down the page is the whole loop.
 *
 * Pause, resume and delete are separate small forms rather than buttons inside
 * the edit form: a destructive action must not be one stray Enter key away from
 * a text field.
 */

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const user = await requireUser();

  if (!UUID_PATTERN.test(id)) notFound();

  const db = getWebDb();
  const profile = await loadProfile(db, { profileId: id, userId: user.id });
  if (!profile) notFound();

  const now = new Date();
  const preview = await previewMatches(db, { profile, now });

  return (
    <Stack gap="lg">
      <Cluster gap="xs">
        <Badge variant={profile.active ? 'success' : 'warning'}>
          {profile.active ? 'Aktiv' : 'På pause'}
        </Badge>
        {profile.includePlannedProcurements ? (
          <Badge variant="planlagt">Planlagte anskaffelser er med</Badge>
        ) : null}
      </Cluster>

      <Stack gap="xs">
        <h1 className="page-heading">{profile.name}</h1>
        <p className="m-0 text-sm text-text-muted">
          <Link href="/varsler">Tilbake til varslingsprofilene</Link>
        </p>
      </Stack>

      <ActionMessage code={query['melding']} />

      {!profile.active ? (
        <Alert tone="warning" heading="Profilen er på pause" titleLevel={2}>
          <p className="m-0">
            Vi matcher fortsatt kunngjøringer mot kriteriene, men du får ingen varsler på e-post før
            du starter profilen igjen.
          </p>
        </Alert>
      ) : null}

      <ProfileForm profile={profile} action={updateProfileAction} submitLabel="Lagre endringene" />

      {/* Spec 9.1 steg 11 og 12: forhåndsvisning før brukeren justerer profilen. */}
      <MatchPreview preview={preview} now={now} />

      <Card as="section" heading="Styr varslingen" titleLevel={2} tone="flat">
        <Stack gap="md">
          <p className="prose-measure m-0 text-sm text-text-muted">
            Du kan sette profilen på pause uten å miste kriteriene, og du kan slette den helt.
            Sletting fjerner profilen fra tjenesten; historikken over hva som allerede er sendt
            beholdes.
          </p>
          <Cluster gap="sm">
            <form action={toggleProfileActiveAction}>
              <input type="hidden" name="profileId" value={profile.id} />
              <Button type="submit" variant="secondary">
                {profile.active ? 'Sett profilen på pause' : 'Start profilen igjen'}
              </Button>
            </form>

            <form action={deleteProfileAction}>
              <input type="hidden" name="profileId" value={profile.id} />
              <Button type="submit" variant="danger">
                Slett varslingsprofilen
              </Button>
            </form>
          </Cluster>
        </Stack>
      </Card>
    </Stack>
  );
}
