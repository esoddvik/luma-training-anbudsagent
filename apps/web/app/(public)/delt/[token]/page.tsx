import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, Cluster, Stack } from '@luma/ui';
import { SHARE_INVITATION_NB, SHARE_UNAVAILABLE_NB } from '@luma/domain';
import { getWebDb } from '@/server/db';
import {
  describeDeadline,
  describeRegions,
  formatCodeList,
  formatDate,
  formatDateTime,
  isoDate,
  NOTICE_CATEGORY_LABEL_NB,
} from '@/server/format';
import {
  SHARED_EXPLANATION_EMPTY_NB,
  SHARED_EXPLANATION_INTRO_NB,
  simplifyForSharing,
} from '@/server/match-explanation';
import { getSharedTenderView, recordShareView } from '@/server/shares';

/**
 * The public shared view (spec section 17).
 *
 * This is the one page in the service that anyone with a URL can open, and
 * launch blocker 51.11 makes "leaks no personal data" a release condition. Four
 * things follow from that, and all four are visible in this file:
 *
 * 1. Everything rendered comes from `SharedTenderView`, which is built and
 *    parsed in `src/server/shares.ts`. The page never touches the database
 *    itself, so there is no row in scope here that could be printed by mistake.
 * 2. The token is never rendered, not even in a hidden field or a link.
 * 3. The explanation is reduced to reason *types* — "Søkeord", not the
 *    keywords. `simplifyForSharing` takes only the types, so the values are not
 *    in scope either.
 * 4. Exactly one invitation block, and no other promotion (section 17).
 *
 * Expired and revoked links render the same neutral page as an unknown token.
 * Distinguishing them would confirm to whoever guessed a token that it was once
 * real.
 */

export const metadata: Metadata = {
  title: 'Delt anbud',
  description: 'Et anbud som er delt med deg via Luma Anbudsvarsling.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export const dynamic = 'force-dynamic';

interface SharedTenderPageProps {
  readonly params: Promise<{ token: string }>;
}

export default async function SharedTenderPage({ params }: SharedTenderPageProps) {
  const { token } = await params;
  const now = new Date();

  const result = await getSharedTenderView(getWebDb(), { token, now });

  if (result.kind !== 'ok') return <ShareUnavailable />;

  // Counted after the view resolves, so a probe for a non-existent token does
  // not write anything. Approximate by design (ADR-15): link previewers and
  // email scanners inflate it.
  await recordShareView(getWebDb(), token);

  const view = result.view;
  const planned = view.noticeCategory === 'planned';
  const deadline = describeDeadline({
    deadlineAt: view.deadlineAt ?? null,
    isPlanned: planned,
    now,
  });
  const explanation = simplifyForSharing(view.matchReasonTypes);

  return (
    <Stack gap="lg">
      <Cluster gap="xs">
        <Badge variant="neutral">Delt anbud</Badge>
        <Badge variant={planned ? 'planlagt' : 'treff'}>
          {NOTICE_CATEGORY_LABEL_NB[view.noticeCategory]}
        </Badge>
      </Cluster>

      <Stack gap="xs">
        <h1 className="page-heading">{view.title}</h1>
        <p className="m-0 text-text-muted">{view.buyerName}</p>
      </Stack>

      {planned ? (
        <p className="prose-measure m-0">
          Dette er en planlagt anskaffelse. Konkurransen er ikke publisert ennå, så den har ingen
          tilbudsfrist.
        </p>
      ) : null}

      <Card as="section" heading="Om anbudet" titleLevel={2}>
        <dl className="m-0 grid grid-cols-1 gap-md sm:grid-cols-2">
          <div>
            <dt className="m-0 text-xs uppercase tracking-wide text-text-muted">Frist</dt>
            <dd className="m-0">
              {deadline.kind === 'date' ? (
                <time dateTime={deadline.iso}>{deadline.text}</time>
              ) : (
                deadline.text
              )}
            </dd>
          </div>
          <div>
            <dt className="m-0 text-xs uppercase tracking-wide text-text-muted">Publisert</dt>
            <dd className="m-0">
              <time dateTime={isoDate(view.publishedAt)}>{formatDate(view.publishedAt)}</time>
            </dd>
          </div>
          <div>
            <dt className="m-0 text-xs uppercase tracking-wide text-text-muted">Geografi</dt>
            <dd className="m-0">{describeRegions(view.regions)}</dd>
          </div>
          <div>
            <dt className="m-0 text-xs uppercase tracking-wide text-text-muted">CPV-koder</dt>
            <dd className="m-0">{formatCodeList(view.cpvCodes)}</dd>
          </div>
        </dl>
      </Card>

      {view.description ? (
        <Card as="section" heading="Beskrivelse fra kunngjøringen" titleLevel={2}>
          <p className="prose-measure m-0 whitespace-pre-line">{view.description}</p>
        </Card>
      ) : null}

      {/* Spec 17: forenklet matchforklaring — bare typene, aldri profilverdiene,
          og ingen poengsum. */}
      <Card as="section" heading="Hvorfor anbudet ble plukket ut" titleLevel={2} tone="flat">
        {explanation.labels.length === 0 ? (
          <p className="m-0">{SHARED_EXPLANATION_EMPTY_NB}</p>
        ) : (
          <Stack gap="sm">
            <p className="m-0">{SHARED_EXPLANATION_INTRO_NB}</p>
            <Cluster as="ul" gap="xs" className="m-0 list-none p-0">
              {explanation.labels.map((label) => (
                <li key={label}>
                  <Badge variant="neutral">{label}</Badge>
                </li>
              ))}
            </Cluster>
            <p className="m-0 text-sm text-text-muted">
              Vi viser ikke hvilke kriterier eller verdier varslingsprofilen bruker.
            </p>
          </Stack>
        )}
      </Card>

      <Card as="section" heading="Kilde" titleLevel={2} tone="flat">
        <Stack gap="sm">
          <p className="m-0">
            <a href={view.sourceUrl} rel="noreferrer noopener" target="_blank">
              Åpne kunngjøringen på Doffin
            </a>
          </p>
          <p className="m-0 text-sm text-text-muted">
            Sist synkronisert{' '}
            <time dateTime={isoDate(view.lastSyncedAt)}>{formatDateTime(view.lastSyncedAt)}</time>.
          </p>
        </Stack>
      </Card>

      <ShareInvitation />
    </Stack>
  );
}

/**
 * The single invitation block (spec sections 17 and 43).
 *
 * Section 17 permits exactly one, and no other promotion in this view. It is
 * the last thing on the page, after the tender content, and the link carries
 * the attribution parameter that makes `share_to_signup` measurable
 * (section 44.2).
 */
function ShareInvitation() {
  return (
    <Card as="section" heading={SHARE_INVITATION_NB.heading} titleLevel={2} tone="flat">
      <Stack gap="sm">
        <p className="m-0">{SHARE_INVITATION_NB.body}</p>
        <p className="m-0">
          <Link href="/?utm_source=anbudsvarsling&utm_medium=delt-visning&utm_campaign=deling">
            Opprett din egen varslingsprofil
          </Link>
        </p>
      </Stack>
    </Card>
  );
}

/** Expired, revoked and unknown all land here, and all read the same. */
function ShareUnavailable() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">{SHARE_UNAVAILABLE_NB.heading}</h1>
      <Stack gap="md" className="prose-measure">
        <p className="m-0">{SHARE_UNAVAILABLE_NB.body}</p>
        <p className="m-0">
          <Link href="/?utm_source=anbudsvarsling&utm_medium=delt-visning&utm_campaign=utlopt-lenke">
            Se hva Luma Anbudsvarsling er
          </Link>
        </p>
      </Stack>
    </Stack>
  );
}
