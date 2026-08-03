import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, Button, Card, Cluster, Field, Select, Stack, Textarea } from '@luma/ui';
import { FEEDBACK_LABEL_NB, feedbackVerdictSchema } from '@luma/domain';
import { ActionMessage } from '@/components/action-message';
import { LumaPromotion } from '@/components/luma-promotion';
import { MatchExplanationCard } from '@/components/match-explanation';
import { TenderActions } from '@/components/tender-actions';
import { submitFeedbackAction } from '@/server/actions/tender-actions';
import { getWebDb } from '@/server/db';
import {
  describeDeadline,
  deadlineUrgency,
  describeRegions,
  formatCodeList,
  formatDate,
  formatDateTime,
  formatEstimatedValue,
  isoDate,
  NOTICE_CATEGORY_LABEL_NB,
  NOT_PROVIDED_NB,
  TENDER_STATUS_LABEL_NB,
} from '@/server/format';
import { requireUser } from '@/server/session';
import { promotionAllowed } from '@/server/settings';
import { getTenderDetail, type TenderDetail } from '@/server/tenders';
import { PageHeader } from '../../_components/page-header';

/**
 * The tender detail page (spec section 16).
 *
 * The page carries four obligations that are easy to lose in a redesign, so
 * each one is anchored in the markup below:
 *
 * - **Source traceability** (section 4.5): Doffin id, notice id, source link,
 *   publication date, deadline, last synced and last changed, all visible.
 * - **Match explanation** (section 4.2), built from the stored reasons.
 * - **Never a win probability** (section 4.3): the approved confidence wording
 *   and the disclaimer, no percentage.
 * - **Promotion last** (section 23.3 and 23.4): after the tender content,
 *   visually separated, labelled, and absent when the user turned it off.
 */

export const dynamic = 'force-dynamic';

interface TenderPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: 'Anbud',
  description: 'Detaljer om et anbud, med matchforklaring, frist og kildelenke.',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TenderPage({ params, searchParams }: TenderPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const user = await requireUser();

  // An id that cannot be a uuid never reaches the database: `where id = $1`
  // with a malformed uuid is a driver error, not an empty result.
  if (!UUID_PATTERN.test(id)) notFound();

  const db = getWebDb();
  const [detail, promotion] = await Promise.all([
    getTenderDetail(db, { tenderId: id, userId: user.id }),
    promotionAllowed(db, user.id),
  ]);

  if (!detail) notFound();

  const now = new Date();
  const planned = detail.tender.noticeCategory === 'planned';
  const deadline = describeDeadline({
    deadlineAt: detail.tender.deadlineAt,
    isPlanned: planned,
    now,
  });

  return (
    <Stack gap="lg">
      <PageHeader
        status={
          <Cluster gap="xs">
            <Badge variant={planned ? 'planlagt' : 'treff'}>
              {NOTICE_CATEGORY_LABEL_NB[detail.tender.noticeCategory]}
            </Badge>
            <Badge variant="neutral">{TENDER_STATUS_LABEL_NB[detail.tender.status]}</Badge>
          </Cluster>
        }
        title={detail.tender.title}
        lede={<p className="m-0">{detail.tender.buyerName}</p>}
      />

      <ActionMessage code={query['melding']} />

      {planned ? (
        <Alert tone="info" heading="Dette er en planlagt anskaffelse" titleLevel={2}>
          <p className="m-0">
            Oppdragsgiver har varslet at anskaffelsen kommer, men konkurransen er ikke publisert
            ennå. Det finnes derfor ingen tilbudsfrist og ingen konkurransedokumenter å levere på.
            Du får beskjed hvis den blir en kunngjort konkurranse.
          </p>
        </Alert>
      ) : null}

      <TenderActions
        tenderId={detail.tender.id}
        state={detail.state}
        returnTo={`/anbud/${detail.tender.id}`}
        canShare={detail.activeShareCount === 0}
      />

      {detail.activeShareCount > 0 ? (
        <p className="m-0 text-sm text-text-muted">
          Du har en aktiv delingslenke for dette anbudet.{' '}
          <Link href="/delinger">Se og opphev delingslenker</Link>.
        </p>
      ) : null}

      <Card as="section" heading="Om anbudet" titleLevel={2}>
        <dl className="m-0 grid grid-cols-1 gap-lg sm:grid-cols-2">
          <Detail label="Oppdragsgiver">{detail.tender.buyerName}</Detail>
          <Detail label="Organisasjonsnummer">
            {detail.tender.buyerOrganizationNumber ?? NOT_PROVIDED_NB}
          </Detail>
          <Detail label="Frist">
            {deadline.kind === 'date' ? (
              <>
                <time dateTime={deadline.iso}>{deadline.text}</time>{' '}
                <span className="text-text-muted">({deadlineUrgency(deadline.daysLeft)})</span>
              </>
            ) : (
              deadline.text
            )}
          </Detail>
          <Detail label="Anslått verdi">
            {formatEstimatedValue({
              min: detail.tender.estimatedValueMinNok,
              max: detail.tender.estimatedValueMaxNok,
              currency: detail.tender.currency,
            })}
          </Detail>
          <Detail label="Geografi">{describeRegions(detail.regionCodes)}</Detail>
          <Detail label="CPV-koder">{formatCodeList(detail.cpvCodes)}</Detail>
          <Detail label="Kunngjøringstype">{detail.tender.noticeType ?? NOT_PROVIDED_NB}</Detail>
          <Detail label="Anskaffelsesprosedyre">
            {/* Spec 13 modellerer feltet, men det ligger bare i eForms-XML-en og
                hentes ikke i MVP (docs/spec-deviations.md). Vi sier det heller
                enn å la feltet stå tomt. */}
            {detail.tender.procedureType ?? NOT_PROVIDED_NB}
          </Detail>
        </dl>
      </Card>

      {detail.tender.description ? (
        <Card as="section" heading="Beskrivelse fra kunngjøringen" titleLevel={2}>
          <p className="prose-measure m-0 whitespace-pre-line">{detail.tender.description}</p>
        </Card>
      ) : null}

      {detail.matches.length === 0 ? (
        <Alert tone="neutral" heading="Ingen matchforklaring" titleLevel={2}>
          <p className="m-0">
            Dette anbudet er ikke matchet mot noen av varslingsprofilene dine, så vi har ingen
            begrunnelse å vise. Du kan fortsatt lagre det og følge med på endringer.
          </p>
        </Alert>
      ) : (
        detail.matches.map((match) => (
          <MatchExplanationCard
            key={match.matchId}
            explanation={match.explanation}
            profileName={match.profileName}
            included={match.included}
          />
        ))
      )}

      {detail.changeEvents.length > 0 ? (
        <Card as="section" heading="Endringer i kunngjøringen" titleLevel={2}>
          <Stack as="ul" gap="xs" className="m-0 list-none p-0">
            {detail.changeEvents.map((change) => (
              <li key={change.id}>
                <p className="m-0">{change.summary}</p>
                <p className="m-0 text-sm text-text-muted">
                  Oppdaget{' '}
                  <time dateTime={isoDate(change.detectedAt)}>
                    {formatDateTime(change.detectedAt)}
                  </time>
                </p>
              </li>
            ))}
          </Stack>
        </Card>
      ) : null}

      <SourceCard detail={detail} />

      <FeedbackForm detail={detail} />

      {/* Spec 23.3: promotering er tillatt på anbudsdetaljsiden, men først etter
          anbudsinnholdet. Spec 23.4: tydelig adskilt og merket. Spec 22: borte
          når brukeren har slått den av. */}
      <LumaPromotion allowed={promotion} placement="anbudsdetalj" />
    </Stack>
  );
}

/** Spec section 4.5: every tender must show where the data came from and when. */
function SourceCard({ detail }: { readonly detail: TenderDetail }) {
  return (
    <Card as="section" heading="Kilde og sporbarhet" titleLevel={2} tone="secondary">
      <Stack gap="sm">
        <dl className="m-0 grid grid-cols-1 gap-lg sm:grid-cols-2">
          <Detail label="Doffin-ID">{detail.tender.sourceId}</Detail>
          <Detail label="Kunngjørings-ID">{detail.tender.noticeId ?? NOT_PROVIDED_NB}</Detail>
          <Detail label="Publisert">
            <time dateTime={isoDate(detail.tender.publishedAt)}>
              {formatDate(detail.tender.publishedAt)}
            </time>
          </Detail>
          <Detail label="Sist synkronisert">
            <time dateTime={isoDate(detail.tender.lastSyncedAt)}>
              {formatDateTime(detail.tender.lastSyncedAt)}
            </time>
          </Detail>
          <Detail label="Sist endret hos oss">
            {detail.tender.modifiedAt ? (
              <time dateTime={isoDate(detail.tender.modifiedAt)}>
                {formatDateTime(detail.tender.modifiedAt)}
              </time>
            ) : (
              'Ingen endring registrert'
            )}
          </Detail>
          <Detail label="Kilderevisjon">{detail.tender.sourceRevision ?? NOT_PROVIDED_NB}</Detail>
        </dl>
        <p className="m-0">
          <a href={detail.tender.sourceUrl} rel="noreferrer noopener" target="_blank">
            Åpne kunngjøringen på Doffin
          </a>
        </p>
        <p className="prose-measure m-0 text-sm text-text-muted">
          Spørsmål og svar i konkurransen skjer i oppdragsgivers eget konkurranseverktøy og vises
          ikke her. Følg alltid konkurransens egne kanaler når du jobber med et anbud.
        </p>
      </Stack>
    </Card>
  );
}

/**
 * Relevance feedback (spec section 15).
 *
 * The list of verdicts is the one section 15 names. Feedback is stored and used
 * for quality measurement; it never changes the profile on its own.
 */
function FeedbackForm({ detail }: { readonly detail: TenderDetail }) {
  const profileId = detail.matches[0]?.profileId;

  return (
    <Card as="section" heading="Var dette treffet relevant?" titleLevel={2}>
      <form action={submitFeedbackAction}>
        <Stack gap="md">
          <input type="hidden" name="tenderId" value={detail.tender.id} />
          <input type="hidden" name="returnTo" value={`/anbud/${detail.tender.id}`} />
          {profileId === undefined ? null : (
            <input type="hidden" name="alertProfileId" value={profileId} />
          )}

          <p className="prose-measure m-0 text-sm text-text-muted">
            Tilbakemeldingen brukes til å måle kvaliteten på treffene. Vi endrer aldri
            varslingsprofilen din automatisk — foreslåtte endringer må du godkjenne selv.
          </p>

          <Field id="verdict" label="Vurdering" required>
            {(control) => (
              <Select {...control} name="verdict" defaultValue={detail.feedback ?? 'relevant'}>
                {feedbackVerdictSchema.options.map((verdict) => (
                  <option key={verdict} value={verdict}>
                    {FEEDBACK_LABEL_NB[verdict]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="comment" label="Utdyp gjerne" hint="Valgfritt. Maks 2000 tegn.">
            {(control) => <Textarea {...control} name="comment" maxLength={2000} />}
          </Field>

          <Cluster gap="xs">
            <Button type="submit" variant="secondary">
              Send tilbakemelding
            </Button>
            {detail.feedback ? (
              <span className="text-sm text-text-muted">
                Du har svart {FEEDBACK_LABEL_NB[detail.feedback].toLowerCase()} tidligere.
              </span>
            ) : null}
          </Cluster>
        </Stack>
      </form>
    </Card>
  );
}

function Detail({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2xs">
      <dt className="m-0 text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="m-0 font-medium">{children}</dd>
    </div>
  );
}
