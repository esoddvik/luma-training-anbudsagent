import Link from 'next/link';
import { Alert, Badge, Card, Cluster, Stack } from '@luma/ui';
import { confidenceLabel, SCORE_DISCLAIMER_NB } from '@luma/domain';
import type { PreviewResult } from '@/server/profiles';
import { describeDeadline, formatDate, isoDate, NOTICE_CATEGORY_LABEL_NB } from '@/server/format';

/**
 * The live preview of what a profile matches (spec section 9.1 step 11).
 *
 * The preview runs the real matching engine over recently published notices, so
 * what is shown here is what the digest would contain. That is the whole point:
 * a preview computed a different way would be a promise the service breaks the
 * next morning.
 *
 * The relevance band uses the approved wording and carries the disclaimer. The
 * numeric score is not rendered — section 4.3 forbids presenting it as a
 * probability of winning, and a bare number next to a tender invites exactly
 * that reading.
 */

export function MatchPreview({
  preview,
  now,
}: {
  readonly preview: PreviewResult;
  readonly now: Date;
}) {
  return (
    <Card as="section" heading="Forhåndsvisning av treff" titleLevel={2}>
      <Stack gap="md">
        <p className="prose-measure m-0 text-sm text-text-muted">
          Vi har kjørt profilen mot {preview.candidatesConsidered} kunngjøringer publisert de siste{' '}
          {preview.windowDays} dagene. Dette er de samme reglene som brukes når varslene sendes.
        </p>

        {preview.items.length === 0 ? (
          <Alert tone="warning" heading="Ingen treff i forhåndsvisningen" titleLevel={3}>
            <Stack gap="sm">
              <p className="m-0">
                Profilen traff ingen av de nyeste kunngjøringene. Det kan bety at den er for smal.
              </p>
              <p className="m-0">Prøv å:</p>
              <ul className="m-0 list-disc pl-lg">
                <li>
                  bruke en mer overordnet CPV-kode, for eksempel 45000000 i stedet for en dyp kode
                </li>
                <li>legge til flere søkeord, eller fjerne noen fra eksklusjonslisten</li>
                <li>utvide geografien, eller la den stå tom</li>
                <li>senke minste treffscore</li>
              </ul>
              <p className="m-0 text-sm text-text-muted">
                Det kan også rett og slett ikke ha vært publisert noe relevant på Doffin i denne
                perioden. Anskaffelser under terskelverdiene kunngjøres ikke alltid der.
              </p>
            </Stack>
          </Alert>
        ) : (
          <Stack as="ul" gap="sm" className="m-0 list-none p-0">
            {preview.items.map((item) => {
              const planned = item.noticeCategory === 'planned';
              const deadline = describeDeadline({
                deadlineAt: item.deadlineAt,
                isPlanned: planned,
                now,
              });
              return (
                <Card as="li" key={item.tenderId} tone="flat">
                  <Stack gap="xs">
                    <Cluster gap="xs">
                      <Badge variant={planned ? 'planlagt' : 'treff'}>
                        {NOTICE_CATEGORY_LABEL_NB[item.noticeCategory]}
                      </Badge>
                      <Badge variant="neutral">{confidenceLabel(item.result.confidence)}</Badge>
                    </Cluster>
                    <p className="m-0 font-medium">
                      <Link href={`/anbud/${item.tenderId}`}>{item.title}</Link>
                    </p>
                    <p className="m-0 text-sm text-text-muted">{item.buyerName}</p>
                    <p className="m-0 text-sm">
                      Publisert{' '}
                      <time dateTime={isoDate(item.publishedAt)}>
                        {formatDate(item.publishedAt)}
                      </time>{' '}
                      · Frist: {deadline.kind === 'date' ? deadline.text : deadline.text}
                    </p>
                    {item.result.reasons.length === 0 ? null : (
                      <p className="m-0 text-sm">
                        Traff på:{' '}
                        {item.result.reasons
                          .slice(0, 3)
                          .map((reason) => reason.label)
                          .join(' · ')}
                      </p>
                    )}
                  </Stack>
                </Card>
              );
            })}
          </Stack>
        )}

        <p className="m-0 text-xs text-text-muted">{SCORE_DISCLAIMER_NB}</p>
      </Stack>
    </Card>
  );
}
