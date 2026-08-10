import type { Metadata } from 'next';
import { Alert, Button, Card, Stack } from '@luma/ui';
import { PageHeader } from '../../../(app)/_components/page-header';
import { resolveActionMessage } from '@/server/actions/messages';
import { syncServiceTemplatesAction } from '@/server/actions/admin-service-template-actions';
import {
  loadServiceTemplateDrift,
  SEED_FIELD_LABELS_NB,
  type TemplateDrift,
} from '@/server/admin-service-templates';

export const metadata: Metadata = {
  title: 'Tjenestemaler',
};

/**
 * Tjenestemaler (spec section 11.2).
 *
 * The page exists because of a specific hole: `listServiceTemplateChoices`
 * prefers the `service_templates` table and falls back to the editorial seeds
 * only when it is empty, so editing a seed changes nothing in any environment
 * whose table is populated — every deployed one. The reconciliation cannot run
 * from a laptop either, because production marks its environment variables
 * sensitive and `DATABASE_URL` comes back as `[SENSITIVE]`. So it runs here.
 *
 * **The diff comes before the button, always.** A button labelled "synchronise"
 * with nothing to look at first asks an operator to authorise a write they
 * cannot see, on editorial content, in a table that has no undo. Every column
 * that would change is printed with its current and its new value, and when
 * nothing would change there is no button at all.
 */

function DriftTable({ drift }: { drift: TemplateDrift }) {
  return (
    <Card as="section" heading={`${drift.name} (${drift.slug})`} titleLevel={3}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th scope="col" className="w-1/5">
                Felt
              </th>
              <th scope="col">Verdi i databasen nå</th>
              <th scope="col">Verdi som blir skrevet</th>
            </tr>
          </thead>
          <tbody>
            {drift.fields.map((field) => (
              <tr key={field.field}>
                <th scope="row" className="py-sm text-left align-top font-medium">
                  {SEED_FIELD_LABELS_NB[field.field]}
                </th>
                <td className="py-sm align-top break-words text-text-muted">{field.before}</td>
                <td className="py-sm align-top break-words">
                  <strong>{field.after}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, report] = await Promise.all([searchParams, loadServiceTemplateDrift()]);
  const message = resolveActionMessage(params['melding']);

  return (
    <Stack gap="xl">
      <PageHeader
        eyebrow="Administrasjon"
        title="Tjenestemaler"
        lede={
          <p className="m-0">
            Tjenestemalene som nye brukere velger mellom under registrering, ligger både i databasen
            og som redaksjonelt innhold i kildekoden. Registreringen leser databasen. Denne siden
            viser hvor de to er ulike, og lar deg skrive det redaksjonelle innholdet inn i
            databasen.
          </p>
        }
      />

      {message ? (
        <Alert tone={message.tone} role="status">
          <p className="m-0">{message.text}</p>
        </Alert>
      ) : null}

      <div className="grid gap-md md:grid-cols-3">
        <Card heading="Maler i databasen" titleLevel={2}>
          <p className="m-0 text-lg">{report.rowCount}</p>
          <p className="m-0 text-sm text-text-muted">
            Dette er malene registreringen faktisk viser.
          </p>
        </Card>
        <Card heading="Maler i redaksjonelt innhold" titleLevel={2}>
          <p className="m-0 text-lg">{report.seedCount}</p>
          <p className="m-0 text-sm text-text-muted">
            Fasiten i kildekoden, gjennomgått i kodegjennomgang.
          </p>
        </Card>
        <Card heading="Maler med avvik" titleLevel={2}>
          <p className="m-0 text-lg">{report.drifted.length}</p>
          <p className="m-0 text-sm text-text-muted">
            Null betyr at databasen er lik det redaksjonelle innholdet.
          </p>
        </Card>
      </div>

      {report.missingSlugs.length > 0 ? (
        <Alert tone="warning" heading="Maler som mangler rad i databasen">
          <p className="m-0">
            {report.missingSlugs.join(', ')}. Disse blir ikke opprettet herfra. Raden sin id er det
            varslingsprofiler peker på, så en rad som opprettes automatisk ville knyttet
            eksisterende profiler til en mal ingen har gått gjennom. Legg dem inn med en migrasjon.
          </p>
        </Alert>
      ) : null}

      {report.unseededSlugs.length > 0 ? (
        <Alert tone="info" heading="Maler som bare finnes i databasen">
          <p className="m-0">
            {report.unseededSlugs.join(', ')}. Disse blir hverken endret eller slettet herfra. En
            mal som er lagt inn i databasen er ikke et avvik.
          </p>
        </Alert>
      ) : null}

      <section aria-labelledby="avvik">
        <Stack gap="md">
          <h2 id="avvik" className="section-heading">
            Avvik
          </h2>

          {report.drifted.length === 0 ? (
            <p className="m-0">
              Ingen avvik. Hver mal i databasen er lik det redaksjonelle innholdet, felt for felt.
              Det er ingenting å synkronisere, og derfor ingen knapp.
            </p>
          ) : (
            <>
              <p className="m-0 prose-measure">
                Under står hvert felt som blir endret, med verdien som ligger i databasen nå og
                verdien som blir skrevet. Les gjennom før du synkroniserer — dette er alt
                synkroniseringen gjør.
              </p>

              {report.drifted.map((drift) => (
                <DriftTable key={drift.slug} drift={drift} />
              ))}

              {/* The caveat is here, immediately above the button, and not in
                  the lede. An operator who has scrolled through a diff is about
                  to press something; that is the moment the warning has to be
                  on screen. */}
              <Alert
                tone="warning"
                heading="Synkroniseringen kan ikke se forskjell på en redigering og et avvik"
              >
                <p className="m-0">
                  Den skriver det redaksjonelle innholdet over feltene i tabellen uansett hvorfor de
                  er ulike. I dag er det trygt: ingenting i løsningen skriver til denne tabellen, og
                  denne siden kan bare lese og synkronisere. Så snart redigering av maler i admin
                  kommer på plass, vil en synkronisering forkaste det en redaktør har endret — da må
                  dette løses på nytt før knappen brukes igjen.
                </p>
              </Alert>

              <form action={syncServiceTemplatesAction}>
                <Stack gap="xs">
                  <div className="flex">
                    <Button type="submit" variant="secondary">
                      Synkroniser {report.drifted.length}{' '}
                      {report.drifted.length === 1 ? 'mal' : 'maler'}
                    </Button>
                  </div>
                  <p className="m-0 text-sm text-text-muted">
                    Skriver bare feltene over. Ingen maler blir opprettet eller slettet, og hverken
                    status, sletting eller opprettelsestidspunkt blir rørt.
                  </p>
                </Stack>
              </form>
            </>
          )}
        </Stack>
      </section>
    </Stack>
  );
}
