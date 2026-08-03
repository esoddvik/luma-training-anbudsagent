import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, Button, Card, Cluster, Stack } from '@luma/ui';
import { ActionMessage } from '@/components/action-message';
import { revokeShareAction } from '@/server/actions/tender-actions';
import { getWebDb } from '@/server/db';
import { formatDateTime, isoDate } from '@/server/format';
import { requireUser } from '@/server/session';
import { listOwnShares } from '@/server/shares';
import { PageHeader } from '../_components/page-header';

export const metadata: Metadata = {
  title: 'Delinger',
  description:
    'Delingslenkene du har laget, med utløpstid, antall visninger og mulighet til å oppheve.',
};

/**
 * The user's own share links (spec sections 4.4 and 17).
 *
 * Revocation has to be here and has to be immediate, because the shared view is
 * public: a link the user regrets is only stoppable from this page. The public
 * page reads `revoked_at` on every request, so pressing the button takes effect
 * at once rather than when a cache expires.
 *
 * The full token is deliberately **not** printed on screen. It is in the copied
 * URL the user already has, and rendering it here would put a live secret into
 * screenshots, screen shares and support tickets.
 */

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await requireUser();
  const shares = await listOwnShares(getWebDb(), user.id);
  const now = new Date();

  const active = shares.filter((share) => !share.revokedAt && share.expiresAt > now);
  const inactive = shares.filter((share) => share.revokedAt || share.expiresAt <= now);

  return (
    <Stack gap="lg">
      <PageHeader
        title="Delinger"
        lede={
          <p className="m-0">
            Delingslenker lar en kollega åpne et anbud uten å logge inn. Lenken viser aldri hvem som
            delte den, hvilken varslingsprofil den kom fra eller hvilke kriterier profilen bruker.
          </p>
        }
      />

      <ActionMessage code={params['melding']} />

      <section aria-labelledby="aktive-overskrift">
        <Stack gap="md">
          <h2 id="aktive-overskrift" className="section-heading">
            Aktive delingslenker
          </h2>

          {active.length === 0 ? (
            <Alert tone="neutral">
              <p className="m-0">
                Du har ingen aktive delingslenker. Bruk «Del internt» på en anbudsdetaljside for å
                lage en. Se <Link href="/oversikt">Oversikt</Link>.
              </p>
            </Alert>
          ) : (
            <Stack as="ul" gap="md" className="m-0 list-none p-0">
              {active.map((share) => (
                <Card as="li" key={share.id} tone="raised">
                  <Stack gap="sm">
                    <h3 className="m-0 text-lg font-semibold leading-snug">
                      <Link href={`/anbud/${share.tenderId}`}>{share.tenderTitle}</Link>
                    </h3>
                    <p className="m-0 text-sm text-text-muted">{share.buyerName}</p>
                    <p className="m-0 text-sm">
                      Utløper{' '}
                      <time dateTime={isoDate(share.expiresAt)}>
                        {formatDateTime(share.expiresAt)}
                      </time>{' '}
                      · {share.viewCount} visninger (omtrentlig)
                    </p>
                    <form action={revokeShareAction}>
                      <input type="hidden" name="shareId" value={share.id} />
                      <Button type="submit" variant="danger" size="sm">
                        Opphev lenken
                      </Button>
                    </form>
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </Stack>
      </section>

      {inactive.length === 0 ? null : (
        <section aria-labelledby="tidligere-overskrift">
          <Stack gap="md">
            <h2 id="tidligere-overskrift" className="section-heading">
              Tidligere delingslenker
            </h2>
            <Stack as="ul" gap="sm" className="m-0 list-none p-0">
              {inactive.map((share) => (
                <Card as="li" key={share.id} tone="secondary">
                  <Cluster gap="sm" justify="between">
                    <span>
                      <Link href={`/anbud/${share.tenderId}`}>{share.tenderTitle}</Link>
                    </span>
                    <Badge variant="neutral">{share.revokedAt ? 'Opphevet' : 'Utløpt'}</Badge>
                  </Cluster>
                </Card>
              ))}
            </Stack>
          </Stack>
        </section>
      )}
    </Stack>
  );
}
