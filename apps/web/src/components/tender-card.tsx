import type { ReactNode } from 'react';
import Link from 'next/link';
import { Badge, Card, Cluster, Stack } from '@luma/ui';
import { confidenceLabel, SCORE_DISCLAIMER_NB, type MatchConfidence } from '@luma/domain';
import type { MatchListItem, TenderSummary, UserTenderState } from '@/server/tenders';
import {
  describeDeadline,
  deadlineUrgency,
  excerpt,
  formatDate,
  formatEstimatedValue,
  describeRegions,
  isoDate,
  NOTICE_CATEGORY_LABEL_NB,
  NOT_PROVIDED_NB,
  USER_STATE_LABEL_NB,
} from '@/server/format';

/**
 * The card that represents one tender in a list.
 *
 * Two rules are carried by this component rather than by the pages that use it,
 * so no list can get them wrong:
 *
 * - A planned procurement is labelled as such and its missing deadline is
 *   explained rather than left blank (spec section 16, launch blocker 51.10).
 * - The relevance band uses the approved vocabulary and is never a percentage
 *   (spec section 4.3). The score itself is not on the card at all; the detail
 *   page shows the band together with the disclaimer.
 */

export interface TenderCardProps {
  readonly tender: TenderSummary;
  readonly confidence?: MatchConfidence;
  readonly profileName?: string;
  readonly reasonLabels?: readonly string[];
  readonly regionCodes?: readonly string[];
  readonly cpvCodes?: readonly string[];
  readonly state?: UserTenderState;
  readonly now: Date;
  /** Rendered under the card body; the pages pass their save/dismiss forms. */
  readonly children?: ReactNode;
}

export function TenderCard({
  tender,
  confidence,
  profileName,
  reasonLabels = [],
  regionCodes = [],
  cpvCodes = [],
  state,
  now,
  children,
}: TenderCardProps) {
  const planned = tender.noticeCategory === 'planned';
  const deadline = describeDeadline({
    deadlineAt: tender.deadlineAt,
    isPlanned: planned,
    now,
  });
  const summary = excerpt(tender.description);

  return (
    <Card as="li" tone="default">
      <Stack gap="sm">
        <Cluster gap="xs">
          <Badge variant={planned ? 'planlagt' : 'treff'}>
            {NOTICE_CATEGORY_LABEL_NB[tender.noticeCategory]}
          </Badge>
          {confidence === undefined ? null : (
            <Badge variant="neutral">{confidenceLabel(confidence)}</Badge>
          )}
          {state === undefined || state === 'new' || state === 'opened' ? null : (
            <Badge variant={state === 'saved' ? 'success' : 'neutral'}>
              {USER_STATE_LABEL_NB[state]}
            </Badge>
          )}
        </Cluster>

        <h3 className="m-0 text-lg font-semibold">
          <Link href={`/anbud/${tender.id}`}>{tender.title}</Link>
        </h3>

        <p className="m-0 text-sm text-text-muted">{tender.buyerName}</p>

        {summary === undefined ? null : <p className="m-0">{summary}</p>}

        <dl className="m-0 grid grid-cols-1 gap-xs sm:grid-cols-2">
          <DataPair label="Frist">
            {deadline.kind === 'date' ? (
              <>
                <time dateTime={deadline.iso}>{deadline.text}</time>{' '}
                <span className="text-text-muted">({deadlineUrgency(deadline.daysLeft)})</span>
              </>
            ) : (
              deadline.text
            )}
          </DataPair>
          <DataPair label="Publisert">
            <time dateTime={isoDate(tender.publishedAt)}>{formatDate(tender.publishedAt)}</time>
          </DataPair>
          <DataPair label="Anslått verdi">
            {formatEstimatedValue({
              min: tender.estimatedValueMinNok,
              max: tender.estimatedValueMaxNok,
              currency: tender.currency,
            })}
          </DataPair>
          <DataPair label="Geografi">{describeRegions(regionCodes)}</DataPair>
          {cpvCodes.length === 0 ? null : (
            <DataPair label="CPV">{cpvCodes.slice(0, 6).join(', ')}</DataPair>
          )}
          {profileName === undefined ? null : (
            <DataPair label="Varslingsprofil">{profileName}</DataPair>
          )}
        </dl>

        {reasonLabels.length === 0 ? null : (
          <div>
            <p className="m-0 text-sm font-semibold">Derfor passer anbudet</p>
            <ul className="m-0 mt-xs list-disc pl-lg text-sm">
              {reasonLabels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </div>
        )}

        {confidence === undefined ? null : (
          <p className="m-0 text-xs text-text-muted">{SCORE_DISCLAIMER_NB}</p>
        )}

        {children}
      </Stack>
    </Card>
  );
}

/** Card built straight from a `MatchListItem`, for the dashboard lists. */
export function MatchCard({
  match,
  now,
  children,
}: {
  readonly match: MatchListItem;
  readonly now: Date;
  readonly children?: ReactNode;
}) {
  return (
    <TenderCard
      tender={match.tender}
      confidence={match.confidence}
      profileName={match.profileName}
      reasonLabels={match.reasonLabels}
      regionCodes={match.regionCodes}
      cpvCodes={match.cpvCodes}
      state={match.state}
      now={now}
    >
      {children}
    </TenderCard>
  );
}

function DataPair({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div>
      <dt className="m-0 text-xs uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="m-0">{children ?? NOT_PROVIDED_NB}</dd>
    </div>
  );
}
