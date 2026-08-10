import type { Metadata } from 'next';
import { Alert, Badge, Button, Card, Field, Input, Stack } from '@luma/ui';
import { PageHeader } from '../../../(app)/_components/page-header';
import { resolveActionMessage } from '@/server/actions/messages';
import { rerunIngestAction, runBackfillAction } from '@/server/actions/admin-ingestion-actions';
import { loadIngestOverview, type IngestRunSummary } from '@/server/admin-ingestion';
import { formatDate, formatDateTime } from '@/server/format';

export const metadata: Metadata = {
  title: 'Doffin-innhenting',
};

/**
 * Doffin-innhenting (spec §45).
 *
 * The page is built around the failure this system actually had rather than
 * around the happy path. On 2026-08-07 the hourly ingest stalled: seventy
 * consecutive runs reported `partial`, each one fetching 300 notices and
 * looking like it had done something, while the checkpoint stayed frozen and
 * the corpus silently stopped growing. Nothing on any screen would have said
 * so.
 *
 * So the two things nearest the top are the two that were wrong and invisible:
 * **how long the checkpoint has been stuck**, and **how many runs in a row have
 * been unhealthy**. The run table below is the detail; those two are the
 * diagnosis.
 */

/** `BadgeVariant` has no `info`, so a run in flight is neutral rather than blue. */
const STATUS_TONE = {
  succeeded: 'success',
  running: 'neutral',
  partial: 'warning',
  failed: 'danger',
} as const;

const TRIGGER_LABEL = {
  schedule: 'Planlagt',
  manual: 'Manuell',
  backfill: 'Etterfylling',
} as const;

function RunRow({ run }: { run: IngestRunSummary }) {
  return (
    <tr>
      <td className="py-sm">{formatDateTime(run.startedAt)}</td>
      <td>
        <Badge variant={STATUS_TONE[run.status]}>{run.status}</Badge>
      </td>
      <td>{TRIGGER_LABEL[run.trigger]}</td>
      <td className="text-right">{run.fetched}</td>
      <td className="text-right">{run.created}</td>
      <td className="text-right">{run.updated}</td>
      <td className="text-right">{run.unchanged}</td>
      {/* The column that mattered. A non-zero here is what makes a run
          `partial`, and a `partial` run does not advance the checkpoint. */}
      <td className="text-right">
        {run.failed > 0 ? <strong className="text-danger">{run.failed}</strong> : run.failed}
      </td>
    </tr>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, overview] = await Promise.all([searchParams, loadIngestOverview()]);
  const message = resolveActionMessage(params['melding']);

  const checkpointAge = overview.checkpoint
    ? Math.floor(
        (Date.now() - new Date(`${overview.checkpoint.lastPublicationDate}`).getTime()) /
          86_400_000,
      )
    : null;

  // Three days is not a threshold anyone measured; it is "longer than a
  // weekend", which is the point at which a frozen checkpoint stops being
  // explicable by Doffin simply not publishing.
  const checkpointStale = checkpointAge !== null && checkpointAge > 3;

  return (
    <Stack gap="xl">
      <PageHeader
        eyebrow="Administrasjon"
        title="Doffin-innhenting"
        lede={
          <p className="m-0">
            Status for innhentingen fra Doffin, og de to knappene som kan gripe inn i den.
          </p>
        }
      />

      {message ? (
        <Alert tone={message.tone} role="status">
          <p className="m-0">{message.text}</p>
        </Alert>
      ) : null}

      {/* The stall detector. Both conditions were true for two days in August
          2026 and nothing anywhere said so. */}
      {overview.consecutiveUnhealthyRuns >= 3 ? (
        <Alert tone="danger" heading="Innhentingen står fast">
          <p className="m-0">
            {overview.consecutiveUnhealthyRuns} kjøringer på rad har feilet helt eller delvis. En
            kjøring som feiler delvis flytter ikke sjekkpunktet, så innhentingen leser det samme
            tidsvinduet om igjen og nye kunngjøringer utenfor vinduet kommer aldri inn.
          </p>
        </Alert>
      ) : null}

      {checkpointStale ? (
        <Alert tone="warning" heading="Sjekkpunktet har ikke flyttet seg">
          <p className="m-0">
            Siste publiseringsdato som er ferdig behandlet er{' '}
            {overview.checkpoint?.lastPublicationDate}, for {checkpointAge} dager siden.
          </p>
        </Alert>
      ) : null}

      <div className="grid gap-md md:grid-cols-3">
        <Card heading="Sjekkpunkt" titleLevel={2}>
          <p className="m-0 text-lg">{overview.checkpoint?.lastPublicationDate ?? 'Ikke satt'}</p>
          <p className="m-0 text-sm text-text-muted">
            {overview.checkpoint
              ? `Overlapp ${overview.checkpoint.overlapDays} dager`
              : 'Ingen kjøring har gått helt gjennom ennå'}
          </p>
        </Card>
        <Card heading="Korpus" titleLevel={2}>
          <p className="m-0 text-lg">{overview.corpus.tenders} kunngjøringer</p>
          <p className="m-0 text-sm text-text-muted">
            {overview.corpus.oldest && overview.corpus.newest
              ? `${formatDate(overview.corpus.oldest)} – ${formatDate(overview.corpus.newest)} (${overview.corpus.spanDays} dager)`
              : 'Tomt'}
          </p>
        </Card>
        <Card heading="Kjøringer på rad uten full suksess" titleLevel={2}>
          <p className="m-0 text-lg">{overview.consecutiveUnhealthyRuns}</p>
          <p className="m-0 text-sm text-text-muted">
            Null er det normale. Et tall som vokser betyr at sjekkpunktet står stille.
          </p>
        </Card>
      </div>

      <section aria-labelledby="handlinger" className="prose-measure">
        <Stack gap="md">
          <h2 id="handlinger" className="section-heading">
            Kjør innhenting
          </h2>

          <form action={rerunIngestAction}>
            <Stack gap="xs">
              <div className="flex">
                <Button type="submit" variant="secondary">
                  Kjør innhenting nå
                </Button>
              </div>
              <p className="m-0 text-sm text-text-muted">
                Samme jobb som den timesplanlagte. Henter fra sjekkpunktet og framover.
              </p>
            </Stack>
          </form>

          <form action={runBackfillAction}>
            <Stack gap="sm">
              <Field
                id="dager"
                label="Etterfyll historikk (dager bakover)"
                hint="Den timesplanlagte innhentingen kan ikke nå lenger tilbake enn omtrent fem uker, fordi Doffin serverer maksimalt 1000 treff per spørring. Etterfyllingen deler perioden i toukersvinduer og henter dem hver for seg."
              >
                {(control) => (
                  <Input
                    {...control}
                    name="dager"
                    type="number"
                    min={1}
                    max={365}
                    defaultValue={90}
                  />
                )}
              </Field>
              <div className="flex">
                <Button type="submit" variant="secondary">
                  Etterfyll
                </Button>
              </div>
              <p className="m-0 text-sm text-text-muted">
                Kjøringen tar flere minutter og svarer først når den er ferdig. Den flytter ikke
                sjekkpunktet og setter ikke i gang matching — etterfylte kunngjøringer er historikk,
                ikke nye treff.
              </p>
            </Stack>
          </form>
        </Stack>
      </section>

      <section aria-labelledby="kjoringer">
        <Stack gap="sm">
          <h2 id="kjoringer" className="section-heading">
            Siste kjøringer
          </h2>
          {overview.runs.length === 0 ? (
            <p className="m-0">Ingen kjøringer registrert ennå.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th scope="col">Startet</th>
                    <th scope="col">Status</th>
                    <th scope="col">Utløst av</th>
                    <th scope="col" className="text-right">
                      Hentet
                    </th>
                    <th scope="col" className="text-right">
                      Nye
                    </th>
                    <th scope="col" className="text-right">
                      Endret
                    </th>
                    <th scope="col" className="text-right">
                      Uendret
                    </th>
                    <th scope="col" className="text-right">
                      Feilet
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {overview.runs.map((run) => (
                    <RunRow key={run.id} run={run} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Stack>
      </section>
    </Stack>
  );
}
