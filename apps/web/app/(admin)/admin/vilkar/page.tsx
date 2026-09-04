import type { Metadata } from 'next';
import { Alert, Button, Card, Stack } from '@luma/ui';
import { PageHeader } from '../../../(app)/_components/page-header';
import { resolveActionMessage } from '@/server/actions/messages';
import { syncLegalDocumentsAction } from '@/server/actions/legal-actions';
import { loadLegalDocumentDrift } from '@/server/legal-documents';

export const metadata: Metadata = {
  title: 'Vilkår',
};

/**
 * Vilkår (spec section 19, section 51 blocker 2).
 *
 * Publishing a terms version means inserting a row that users will be asked to
 * accept. So the diff comes before the button, always — the same rule as
 * `/admin/tjenestemaler`, and for a stronger reason: a service template can be
 * corrected afterwards, and a published legal version cannot. Acceptances
 * reference `(kind, version)`, so a version is permanent once anyone has
 * agreed to it.
 *
 * **What this page cannot do.** It never edits and never removes a version.
 * A published document whose text was changed directly in the database shows
 * up here as a conflict with no button beside it, because the fix is to
 * publish a new version rather than to overwrite the one people accepted.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, report] = await Promise.all([searchParams, loadLegalDocumentDrift()]);
  const message = resolveActionMessage(params['melding']);

  return (
    <Stack gap="xl">
      <PageHeader
        eyebrow="Administrasjon"
        title="Vilkår"
        lede={
          <p className="m-0">
            Vilkårstekstene ligger som innhold i kildekoden og publiseres herfra til databasen.
            Tjenesten leser databasen. Nye versjoner legges til; en versjon som allerede er
            publisert blir aldri endret eller slettet, fordi aksepter peker på den.
          </p>
        }
      />

      {message ? (
        <Alert tone={message.tone} role="status">
          <p className="m-0">{message.text}</p>
        </Alert>
      ) : null}

      {report.conflicts.length > 0 ? (
        <Alert tone="danger" heading="Publisert tekst er endret i databasen">
          <p className="m-0">
            {report.conflicts.map((ref) => `${ref.kind} ${ref.version}`).join(', ')}. Teksten i
            databasen er ikke lik teksten som er sjekket inn for samme versjon. Den blir ikke
            overskrevet herfra: brukere har akseptert versjonen slik den står, og aksepten viser til
            versjonsnummeret. Riktig rettelse er å publisere en ny versjon.
          </p>
        </Alert>
      ) : null}

      {report.unseeded.length > 0 ? (
        <Alert tone="info" heading="Versjoner som bare finnes i databasen">
          <p className="m-0">
            {report.unseeded.map((ref) => `${ref.kind} ${ref.version}`).join(', ')}. Disse blir
            hverken endret eller slettet herfra. En tidligere versjon som er tatt ut av innholdet
            har fortsatt aksepter som peker på seg.
          </p>
        </Alert>
      ) : null}

      {report.insertable.length === 0 ? (
        <Card heading="Ingenting å publisere" titleLevel={2}>
          <p className="m-0">Alle versjonene som er sjekket inn ligger allerede i databasen.</p>
        </Card>
      ) : (
        <Stack gap="md">
          {report.insertable.map((seed) => (
            <Card
              as="section"
              key={`${seed.kind}-${seed.version}`}
              heading={`${seed.kind === 'terms' ? 'Bruksvilkår' : 'Personvernerklæring'} ${seed.version}`}
              titleLevel={3}
            >
              <Stack gap="sm">
                <p className="m-0 text-sm text-text-muted">
                  Gjelder fra {seed.effectiveFrom.toLocaleDateString('nb-NO')}.
                  {seed.isPlaceholder
                    ? ' Merket som utkast, og blokkerer lansering så lenge den er det.'
                    : ' Ferdig gjennomgått tekst.'}
                </p>
                {/* The whole body, not an excerpt. An operator is about to ask
                    every user to accept this, and cannot authorise text they
                    have not been shown. */}
                <pre className="m-0 overflow-x-auto text-sm whitespace-pre-wrap">{seed.body}</pre>
              </Stack>
            </Card>
          ))}

          <form action={syncLegalDocumentsAction}>
            <Button type="submit">Publiser versjonene over</Button>
          </form>
        </Stack>
      )}
    </Stack>
  );
}
