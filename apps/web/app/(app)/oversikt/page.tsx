import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Button,
  buttonClassName,
  Card,
  Cluster,
  Field,
  Input,
  Select,
  Stack,
} from '@luma/ui';
import { ActionMessage } from '@/components/action-message';
import { EmptyStatePromotion } from '@/components/luma-promotion';
import { MatchCard } from '@/components/tender-card';
import { TenderActions } from '@/components/tender-actions';
import {
  DEADLINE_FILTER_OPTIONS,
  hasActiveFilters,
  parseDashboardFilters,
} from '@/server/dashboard-filters';
import { getWebDb } from '@/server/db';
import { listProfiles } from '@/server/profiles';
import { requireUser } from '@/server/session';
import { promotionAllowed } from '@/server/settings';
import { listMatchedBuyers, listMatches, type DashboardFilters } from '@/server/tenders';
import { PageHeader } from '../_components/page-header';

export const metadata: Metadata = {
  title: 'Oversikt',
  description:
    'Nye treff fra varslingsprofilene dine, med matchforklaring, frist og kildelenke. Planlagte anskaffelser vises som egen seksjon.',
};

/**
 * The dashboard (spec section 16).
 *
 * What the page implements directly:
 *
 * - New matches first — the query orders by publication date.
 * - Planned procurements as a clearly marked section of their own. That is
 *   launch blocker 51.10, so the split is structural rather than a filter the
 *   user has to find.
 * - Filters on profile, deadline, buyer, CPV, status and category.
 * - Empty states that say what to do next, in Norwegian.
 *
 * The filter form is a plain `method="get"` form, so filtering is an ordinary
 * navigation: it works without JavaScript, the result is linkable, and the back
 * button behaves the way people expect.
 *
 * Two surfaces on this page carry a tint, and neither is a tender. The filter
 * panel and the note explaining what a planlagt anskaffelse is sit on the
 * neutral supporting surface; the promotion block sits on the brand cream and
 * says whose it is. Section 3's trust contract is why the tender cards stay
 * plain: a result must never be dressed up to look like a message from Luma.
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

  const filters = parseDashboardFilters(params);
  const [profiles, buyers, promotion] = await Promise.all([
    listProfiles(db, user.id),
    listMatchedBuyers(db, user.id),
    promotionAllowed(db, user.id),
  ]);

  // Two queries rather than one grouped in memory: the planned section has its
  // own limit and its own empty state, and a shared query would make the
  // competition list shorter whenever there happened to be many planned
  // notices.
  const [competitionMatches, plannedMatches] = await Promise.all([
    filters.category === 'planned'
      ? Promise.resolve([])
      : listMatches(db, {
          userId: user.id,
          filters: { ...filters, category: 'competition' },
        }),
    filters.category === 'competition'
      ? Promise.resolve([])
      : listMatches(db, {
          userId: user.id,
          filters: { ...filters, category: 'planned' },
          limit: 25,
        }),
  ]);

  const hasProfiles = profiles.length > 0;
  const hasAnyResult = competitionMatches.length > 0 || plannedMatches.length > 0;

  return (
    <Stack gap="xl">
      <PageHeader
        title="Oversikt"
        lede={
          <p className="m-0 text-sm">
            Nyeste kunngjøringer først. Hvert treff viser oppdragsgiver, frist, kategori og hvorfor
            anbudet passer varslingsprofilen din.
          </p>
        }
      />

      <ActionMessage code={params['melding']} />

      {!hasProfiles ? (
        <NoProfilesEmptyState promotion={promotion} />
      ) : (
        <>
          <FilterForm
            profiles={profiles.map((profile) => ({ id: profile.id, name: profile.name }))}
            buyers={buyers}
            filters={filters}
          />

          {filters.category === 'planned' ? null : (
            <section aria-labelledby="konkurranser-overskrift">
              <Stack gap="md">
                <Cluster justify="between">
                  <h2 id="konkurranser-overskrift" className="section-heading">
                    Kunngjorte konkurranser
                  </h2>
                  <Badge variant="neutral">{competitionMatches.length} treff vises</Badge>
                </Cluster>

                {competitionMatches.length === 0 ? (
                  <NoMatchesEmptyState hasFilters={hasActiveFilters(filters)} />
                ) : (
                  <Stack as="ul" gap="md" className="m-0 list-none p-0">
                    {competitionMatches.map((match) => (
                      <MatchCard key={match.matchId} match={match} now={now}>
                        <TenderActions
                          tenderId={match.tender.id}
                          state={match.state}
                          returnTo="/oversikt"
                        />
                      </MatchCard>
                    ))}
                  </Stack>
                )}
              </Stack>
            </section>
          )}

          {/* Spec 16 og lanseringsblokkering 51.10: planlagte anskaffelser er en
              egen, tydelig merket seksjon. Den står etter konkurransene fordi
              konkurransene er det brukeren kan levere tilbud på i dag. */}
          {filters.category === 'competition' ? null : (
            <section aria-labelledby="planlagte-overskrift">
              <Stack gap="md">
                <Cluster gap="xs">
                  <h2 id="planlagte-overskrift" className="section-heading">
                    Planlagte anskaffelser
                  </h2>
                  <Badge variant="planlagt">Ikke kunngjort ennå</Badge>
                </Cluster>
                <Card tone="secondary" className="prose-measure">
                  <p className="m-0 text-sm">
                    Dette er varslede anskaffelser. Konkurransen er ikke publisert, så de har ingen
                    tilbudsfrist ennå. Bruk tiden til å forberede deg.
                  </p>
                </Card>

                {plannedMatches.length === 0 ? (
                  <Alert tone="neutral">
                    <p className="m-0">
                      Ingen planlagte anskaffelser passer varslingsprofilene dine akkurat nå.
                      Planlagte anskaffelser kunngjøres sjeldnere enn konkurranser.
                    </p>
                  </Alert>
                ) : (
                  <>
                    <Stack as="ul" gap="md" className="m-0 list-none p-0">
                      {plannedMatches.slice(0, 5).map((match) => (
                        <MatchCard key={match.matchId} match={match} now={now}>
                          <TenderActions
                            tenderId={match.tender.id}
                            state={match.state}
                            returnTo="/oversikt"
                          />
                        </MatchCard>
                      ))}
                    </Stack>
                    <p className="m-0">
                      <Link
                        href="/planlagte"
                        className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                      >
                        Se alle planlagte anskaffelser
                      </Link>
                    </p>
                  </>
                )}
              </Stack>
            </section>
          )}

          {/* Spec 23.3 og 23.4: promotering er tillatt i tomme tilstander, men
              skal komme etter innholdet og være tydelig merket. */}
          {hasAnyResult ? null : <EmptyStatePromotion allowed={promotion} />}
        </>
      )}
    </Stack>
  );
}

function FilterForm({
  profiles,
  buyers,
  filters,
}: {
  readonly profiles: readonly { id: string; name: string }[];
  readonly buyers: readonly string[];
  readonly filters: DashboardFilters;
}) {
  return (
    <Card as="section" tone="secondary" heading="Filtrer treffene" titleLevel={2}>
      <form method="get" action="/oversikt">
        <Stack gap="md">
          <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
            <Field id="profil" label="Varslingsprofil">
              {(control) => (
                <Select {...control} name="profil" defaultValue={filters.profileId ?? ''}>
                  <option value="">Alle profiler</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field id="frist" label="Frist innen">
              {(control) => (
                <Select
                  {...control}
                  name="frist"
                  defaultValue={
                    filters.deadlineWithinDays === undefined
                      ? ''
                      : String(filters.deadlineWithinDays)
                  }
                >
                  <option value="">Uansett frist</option>
                  {DEADLINE_FILTER_OPTIONS.map((option) => (
                    <option key={option.days} value={String(option.days)}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field id="oppdragsgiver" label="Oppdragsgiver">
              {(control) => (
                <Select {...control} name="oppdragsgiver" defaultValue={filters.buyer ?? ''}>
                  <option value="">Alle oppdragsgivere</option>
                  {buyers.map((buyer) => (
                    <option key={buyer} value={buyer}>
                      {buyer}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              id="cpv"
              label="CPV-kode"
              hint="Åtte siffer. En overordnet kode tar med kodene under seg."
            >
              {(control) => (
                <Input
                  {...control}
                  name="cpv"
                  inputMode="numeric"
                  defaultValue={filters.cpv ?? ''}
                  placeholder="45000000"
                />
              )}
            </Field>

            <Field id="status" label="Status">
              {(control) => (
                <Select {...control} name="status" defaultValue={filters.state ?? ''}>
                  <option value="">Nye og åpnede</option>
                  <option value="saved">Lagret</option>
                  <option value="dismissed">Avvist</option>
                </Select>
              )}
            </Field>

            <Field id="kategori" label="Kategori">
              {(control) => (
                <Select {...control} name="kategori" defaultValue={filters.category ?? ''}>
                  <option value="">Konkurranser og planlagte</option>
                  <option value="competition">Bare konkurranser</option>
                  <option value="planned">Bare planlagte anskaffelser</option>
                </Select>
              )}
            </Field>
          </div>

          <Cluster gap="xs">
            <Button type="submit" variant="primary">
              Bruk filtrene
            </Button>
            <Link href="/oversikt" className={buttonClassName({ variant: 'ghost' })}>
              Nullstill filtrene
            </Link>
          </Cluster>
        </Stack>
      </form>
    </Card>
  );
}

function NoProfilesEmptyState({ promotion }: { readonly promotion: boolean }) {
  return (
    <Stack gap="md">
      <Alert tone="info" heading="Du har ingen varslingsprofil ennå" titleLevel={2}>
        <Stack gap="sm">
          <p className="m-0">
            En varslingsprofil forteller oss hvilke oppdrag virksomheten din ser etter: bransje,
            geografi, CPV-koder og søkeord. Uten en profil har vi ingenting å matche mot.
          </p>
          <p className="m-0">
            Velg en bransjemal, så er de fleste feltene fylt ut på forhånd. Du kan endre alt
            etterpå.
          </p>
          <p className="m-0">
            <Link href="/varsler/ny" className={buttonClassName({ variant: 'primary' })}>
              Opprett din første varslingsprofil
            </Link>
          </p>
        </Stack>
      </Alert>
      <EmptyStatePromotion allowed={promotion} />
    </Stack>
  );
}

function NoMatchesEmptyState({ hasFilters }: { readonly hasFilters: boolean }) {
  return (
    <Alert tone="neutral" heading="Ingen treff å vise" titleLevel={3}>
      <Stack gap="sm">
        {hasFilters ? (
          <p className="m-0">
            Ingen treff passer filtrene du har valgt. Prøv å fjerne ett av dem, eller{' '}
            <Link href="/oversikt">nullstill filtrene</Link>.
          </p>
        ) : (
          <p className="m-0">
            Vi har ikke funnet kunngjøringer som passer varslingsprofilene dine ennå. Nye
            kunngjøringer hentes fra Doffin hver dag.
          </p>
        )}
        <p className="m-0">
          Får du for få treff, kan profilen være for smal. Du kan utvide CPV-koder, søkeord eller
          geografi under <Link href="/varsler">Varsler</Link>.
        </p>
        <p className="m-0 text-sm text-text-muted">
          Husk at anskaffelser under terskelverdiene ikke alltid publiseres på Doffin. At du ikke
          får varsel, betyr ikke at det ikke finnes muligheter.
        </p>
      </Stack>
    </Alert>
  );
}
