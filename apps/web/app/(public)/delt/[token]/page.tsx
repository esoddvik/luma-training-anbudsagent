import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, Chip, Stack, buttonClassName } from '@luma/ui';
import { cpvLabel, SHARE_INVITATION_NB, SHARE_UNAVAILABLE_NB } from '@luma/domain';
import { getWebDb, shareTtlDays } from '@/server/db';
import {
  describeDeadline,
  describeRegions,
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
 *
 * ## Why there are no strength bars here
 *
 * The funnel design draws a `StrengthBar` per reason in the explanation card.
 * It cannot be drawn honestly. `simplifyForSharing` returns reason *types* and
 * nothing else — by construction, so that widening the full explanation cannot
 * widen this page — and per-reason strength lives on the match rows the shared
 * payload deliberately never reads. A bar here would therefore be a width
 * invented at render time and presented as a measurement of someone else's
 * match. The reasons are chips instead, which is the same information the data
 * actually carries.
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
    <Stack gap="md" className="min-w-0">
      {/* The design reads «lenken virker til {dato}». The share's own
          `expiresAt` is not part of `SharedTenderView` and must not be added to
          it just for a line of copy, so this states the policy — the configured
          lifetime — rather than a date it does not have. */}
      <p className="m-0 text-sm font-semibold text-text-muted">
        Delt med deg · delte lenker virker i {shareTtlDays()} dager
      </p>

      <h1 className="page-heading m-0">{view.title}</h1>

      <div>
        <Badge variant={planned ? 'planlagt' : 'treff'}>
          {NOTICE_CATEGORY_LABEL_NB[view.noticeCategory]}
        </Badge>
      </div>

      <dl className="m-0 flex flex-wrap gap-x-xl gap-y-md border-y border-line py-md">
        <Fact term="Oppdragsgiver">{view.buyerName}</Fact>
        <Fact term="Frist">
          {deadline.kind === 'date' ? (
            <time dateTime={deadline.iso}>{deadline.text}</time>
          ) : (
            deadline.text
          )}
        </Fact>
        <Fact term="Område">{describeRegions(view.regions)}</Fact>
        <Fact term="Publisert">
          <time dateTime={isoDate(view.publishedAt)}>{formatDate(view.publishedAt)}</time>
        </Fact>
      </dl>

      {view.cpvCodes.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-xs p-0">
          {view.cpvCodes.map((code) => (
            <li key={code}>
              <Chip tone="outline">
                <span className="font-mono text-xs">{code}</span>
                <span>{cpvLabel(code)}</span>
              </Chip>
            </li>
          ))}
        </ul>
      ) : null}

      {view.description ? (
        <p className="prose-measure m-0 whitespace-pre-line">{view.description}</p>
      ) : null}

      {/* Spec 17: forenklet matchforklaring — bare typene, aldri profilverdiene,
          og ingen poengsum. */}
      <Card as="section" heading="Hvorfor anbudet ble plukket ut" titleLevel={2}>
        {explanation.labels.length === 0 ? (
          <p className="m-0">{SHARED_EXPLANATION_EMPTY_NB}</p>
        ) : (
          <Stack gap="sm">
            <p className="m-0">{SHARED_EXPLANATION_INTRO_NB}</p>
            <ul className="m-0 flex list-none flex-wrap gap-xs p-0">
              {explanation.labels.map((label) => (
                <li key={label}>
                  <Chip tone="soft">{label}</Chip>
                </li>
              ))}
            </ul>
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
      <Attribution />
    </Stack>
  );
}

/**
 * The single invitation block (spec sections 17 and 43).
 *
 * Section 17 permits exactly one, and no other promotion in this view — which
 * is why the design's cream band is built here rather than with `Promotion`:
 * `Promotion` is the Luma course surface, and a course offer on a page built
 * from someone else's data is the second promotion section 17 forbids.
 *
 * It is the last thing before the attribution, after the tender content, and
 * the link carries the parameters that make `share_to_signup` measurable
 * (section 44.2).
 */
function ShareInvitation() {
  return (
    <section
      aria-labelledby="invitasjon-tittel"
      className="flex flex-wrap items-center justify-between gap-md rounded-lg bg-primary-soft p-lg"
    >
      <Stack gap="xs" className="min-w-0">
        <h2 id="invitasjon-tittel" className="m-0 text-lg font-bold">
          {SHARE_INVITATION_NB.heading}
        </h2>
        <p className="m-0 text-sm text-primary-soft-text">{SHARE_INVITATION_NB.body}</p>
      </Stack>
      <Link
        className={buttonClassName({ variant: 'primary' })}
        href="/finn-anbud?utm_source=anbudsvarsling&utm_medium=delt-visning&utm_campaign=deling"
      >
        Opprett din egen varslingsprofil
      </Link>
    </section>
  );
}

/**
 * Expired, revoked and unknown all land here, and all read the same.
 *
 * The design's heading is «Lenken er utløpt». That wording is not available:
 * it would tell whoever guessed a token that the token was once real, which is
 * exactly the distinction `getSharedTenderView` refuses to make. The neutral
 * heading and body from `@luma/domain` stay; the design's illustration slot,
 * its explanation of the lifetime and its CTA are what carry over.
 */
function ShareUnavailable() {
  return (
    <Stack gap="md" className="prose-measure">
      {/* Decorative slot. A rounded soft square, no image asset — the design's
          «robot-figur» placeholder is a drawing that does not exist yet, and an
          empty box is more honest than a stock illustration. */}
      <span aria-hidden="true" className="block size-24 rounded-lg bg-primary-soft" />

      <h1 className="page-heading m-0">{SHARE_UNAVAILABLE_NB.heading}</h1>

      <p className="m-0">{SHARE_UNAVAILABLE_NB.body}</p>

      <p className="m-0 text-text-muted">
        Delte lenker virker i {shareTtlDays()} dager. Be den som delte om en ny, eller finn anbudet
        selv — det er offentlig.
      </p>

      <p className="m-0">
        <Link
          className={buttonClassName({ variant: 'primary' })}
          href="/finn-anbud?utm_source=anbudsvarsling&utm_medium=delt-visning&utm_campaign=utlopt-lenke"
        >
          Finn anbud for din bransje
        </Link>
      </p>
    </Stack>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2xs">
      <dt className="m-0 text-sm text-text-muted">{term}</dt>
      <dd className="m-0 font-semibold">{children}</dd>
    </div>
  );
}

/* Required by CC BY 4.0 wherever announcement data is republished to someone
   who did not fetch it themselves (ADR-0018). Reads exactly
   `Data: Doffin/DFØ (CC BY 4.0)` as text, with the licence carrying the link. */
function Attribution() {
  return (
    <p className="m-0 text-xs text-text-muted">
      Data: Doffin/DFØ (
      <Link href="https://creativecommons.org/licenses/by/4.0/deed.no">CC BY 4.0</Link>)
    </p>
  );
}
