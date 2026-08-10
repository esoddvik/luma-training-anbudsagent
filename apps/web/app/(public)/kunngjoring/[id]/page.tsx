import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Chip, Promotion, Stack, buttonClassName } from '@luma/ui';
import { cpvEntry, cpvLabel } from '@luma/domain';
import {
  describeDeadline,
  formatDate,
  formatEstimatedValue,
  NOTICE_CATEGORY_LABEL_NB,
  isoDate,
} from '@/server/format';
import { lumaUrl } from '@/lib/luma-links';
import { shouldIndexNotice } from '@/server/notice-indexing';
import { loadPublicTender, type PublicTenderDetail } from '@/server/public-tenders';

/**
 * A single notice, publicly (IDE Agent Spec v3, section 3.3).
 *
 * ## Caching: on-demand, not a build-time enumeration
 *
 * There is deliberately no `generateStaticParams` here. The corpus runs to
 * thousands of notices and grows hourly; enumerating it at build would make
 * every deploy slower than the last and would still be stale within the hour.
 * Instead these pages are generated on first request and then regenerated when
 * the ingest worker says a specific notice changed — see
 * `app/(public)/revalider/route.ts`. `revalidate` below is the safety net for
 * a notice the worker never reports, not the primary mechanism.
 *
 * ## Indexing follows the competition, not the sitemap
 *
 * When a competition closes, the page emits `noindex` itself. Dropping it from
 * the sitemap is not enough and the difference matters: a sitemap tells a
 * crawler what to *find*, and by the time a deadline passes Google has already
 * found it. Only a directive on the page removes it from the index.
 *
 * ## Every row of the fact strip is a fact
 *
 * The design draws five facts under the title. Three of them are not always in
 * the data — value is absent from about half the corpus, geography can be
 * missing entirely, and the procedure type is not part of `PublicTenderDetail`
 * at all. Each row below is therefore conditional. A strip with four rows is
 * correct; a strip with five where the fifth reads «Ikke oppgitt» is a design
 * that has been prioritised over the reader.
 */
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const tender = await loadPublicTender(id);
  if (!tender) return { title: 'Kunngjøringen finnes ikke', robots: { index: false } };

  const indexable = shouldIndexNotice(tender);
  return {
    title: tender.title,
    description:
      tender.description?.slice(0, 160) ??
      `Offentlig anbud fra ${tender.buyerName}, kunngjort på Doffin.`,
    // The flip. A closed, cancelled or awarded competition is no longer an
    // opportunity, and an index full of them is what makes a tender site feel
    // like a graveyard.
    robots: indexable ? undefined : { index: false, follow: true },
  };
}

const STATUS_BANNER_NB: Record<string, string> = {
  closed: 'Denne konkurransen er avsluttet',
  cancelled: 'Denne konkurransen er avlyst',
  awarded: 'Denne konkurransen er tildelt',
};

export default async function NoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tender = await loadPublicTender(id);
  // Covers "no such notice", "suppressed" and "award" identically. A suppressed
  // notice must not be distinguishable from one that never existed.
  if (!tender) notFound();

  // The same predicate that decides `noindex`, reused rather than re-derived:
  // the reader is told the page is closed exactly when the crawler is.
  const open = shouldIndexNotice(tender);

  return open ? <OpenNotice tender={tender} /> : <ClosedNotice tender={tender} />;
}

function OpenNotice({ tender }: { tender: PublicTenderDetail }) {
  return (
    <div className="funnel-grid">
      <Stack gap="md" className="min-w-0">
        <Breadcrumb tender={tender} />

        <h1 className="page-heading m-0">{tender.title}</h1>

        <FactStrip tender={tender} />

        {tender.description ? (
          <p className="prose-measure m-0 whitespace-pre-line">{tender.description}</p>
        ) : null}

        <CpvChips codes={tender.cpvCodes} />

        <p className="m-0">
          <a href={tender.sourceUrl} rel="noreferrer noopener" target="_blank">
            Åpne på Doffin ↗
          </a>
        </p>

        <SourceNote />
        <Attribution />
      </Stack>

      <div className="sticky-rail">
        <Stack gap="md">
          <SignupCard />
          <CourseCard />
        </Stack>
      </div>
    </div>
  );
}

/**
 * The closed state (design A4, second panel).
 *
 * Single column: the signup rail is dropped, because inviting someone to
 * subscribe from a competition they can no longer enter is the wrong offer at
 * the wrong moment. The design replaces it with one CTA into the open ones.
 *
 * The fact strip stays, unlike the design's own closed panel, for the reason
 * the design's own body copy gives: the page is left standing because it is
 * useful to someone mapping the market, and a market map without the buyer or
 * the deadline is not one.
 */
function ClosedNotice({ tender }: { tender: PublicTenderDetail }) {
  const banner = STATUS_BANNER_NB[tender.status] ?? 'Denne konkurransen er ikke lenger åpen';
  // Named only when the vocabulary actually knows the code. `cpvLabel` falls
  // back to the bare digits, and «Se åpne anbud innen 90911200» is not a
  // sentence anyone wants to read.
  const trade = tender.cpvCodes.map((code) => cpvEntry(code)).find((entry) => entry !== undefined);

  return (
    <Stack gap="md" className="min-w-0">
      {/* Neutral, not a warning: nothing went wrong, the deadline simply
          passed. `surface-sunken` with a grey dot, per the design. */}
      <div className="flex items-center gap-sm rounded-lg bg-surface-sunken p-md">
        <span aria-hidden="true" className="block size-2.5 rounded-full bg-text-muted" />
        <span className="flex flex-col gap-2xs">
          <span className="font-semibold">{banner}</span>
          {tender.deadlineAt ? (
            <span className="text-sm text-text-muted">
              Fristen gikk ut{' '}
              <time dateTime={isoDate(tender.deadlineAt)}>{formatDate(tender.deadlineAt)}</time>.
            </span>
          ) : null}
          {/* No award row: `PublicTenderDetail` carries no supplier and no award
              date, and inventing one would be a fabrication about a contract. */}
        </span>
      </div>

      <h1 className="page-heading m-0 text-text-muted">{tender.title}</h1>

      <FactStrip tender={tender} />

      {tender.description ? (
        <p className="prose-measure m-0 whitespace-pre-line text-text-muted">
          {tender.description}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-md">
        <Link className={buttonClassName({ variant: 'primary' })} href="/finn-anbud">
          {trade ? `Se åpne anbud innen ${trade.name.toLowerCase()}` : 'Se åpne anbud'}
        </Link>
        <a href={tender.sourceUrl} rel="noreferrer noopener" target="_blank">
          Åpne på Doffin ↗
        </a>
      </div>

      <SourceNote />
      <Attribution />
    </Stack>
  );
}

function Breadcrumb({ tender }: { tender: PublicTenderDetail }) {
  const area = areaText(tender);
  return (
    <nav aria-label="Brødsmuler" className="text-sm font-semibold text-text-muted">
      <Link href="/finn-anbud">Finn anbud</Link>
      {area ? <span> / {area}</span> : null}
    </nav>
  );
}

/**
 * `Oppdragsgiver / Frist / Område / Anslått verdi / Type`, ruled above and
 * below. Rows that have no value are not rendered at all.
 */
function FactStrip({ tender }: { tender: PublicTenderDetail }) {
  const planned = tender.noticeCategory === 'planned';
  const deadline = describeDeadline({
    deadlineAt: tender.deadlineAt,
    isPlanned: planned,
    now: new Date(),
  });
  const area = areaText(tender);

  return (
    <Stack gap="sm">
      <dl className="m-0 flex flex-wrap gap-x-xl gap-y-md border-y border-line py-md">
        <Fact term="Oppdragsgiver">{tender.buyerName}</Fact>
        <Fact term="Frist">
          {deadline.kind === 'date' ? (
            <time dateTime={deadline.iso}>{deadline.text}</time>
          ) : deadline.kind === 'planned' ? (
            // Never a fabricated deadline: a planned procurement has none, and
            // saying so is the whole point of the category (ADR-13).
            'Ingen frist ennå'
          ) : (
            'Ikke oppgitt'
          )}
        </Fact>
        {area ? <Fact term="Område">{area}</Fact> : null}
        {tender.estimatedValueMinNok === null ? null : (
          <Fact term="Anslått verdi">
            {formatEstimatedValue({
              min: tender.estimatedValueMinNok,
              max: null,
              currency: tender.currency,
            })}
          </Fact>
        )}
        {/* The design's «Type» is the procurement procedure. `PublicTenderDetail`
            does not carry one, so this is the notice category — a fact the
            loader does return — rather than a guess at the procedure. */}
        <Fact term="Type">{NOTICE_CATEGORY_LABEL_NB[tender.noticeCategory]}</Fact>
      </dl>
      {deadline.kind === 'planned' ? (
        <p className="m-0 text-sm text-text-muted">{deadline.text}</p>
      ) : null}
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

/**
 * CPV codes, named. The code is kept beside the name rather than replaced by
 * it: the name is what makes the chip readable, the code is what makes it
 * checkable against Doffin.
 */
function CpvChips({ codes }: { codes: readonly string[] }) {
  if (codes.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-xs p-0">
      {codes.map((code) => (
        <li key={code}>
          <Chip tone="outline">
            <span className="font-mono text-xs">{code}</span>
            <span>{cpvLabel(code)}</span>
          </Chip>
        </li>
      ))}
    </ul>
  );
}

/**
 * The signup rail card.
 *
 * A link rather than the form. `InlineSignup` posts a `tjenestemal` slug, which
 * a notice page has no way to supply — a notice belongs to CPV codes, not to
 * one of the eight trade templates — and posting a signup with no template
 * would create a profile with no criteria. So the rail sends the reader one
 * step back into the funnel, where the trade is chosen and the form has what it
 * needs.
 */
function SignupCard() {
  return (
    <section aria-labelledby="varsling-tittel" className="luma-card">
      <Stack gap="sm">
        <h2 id="varsling-tittel" className="luma-card__title">
          Få slike anbud på e-post
        </h2>
        <p className="m-0 text-text-muted">
          Velg bransjen din, så følger vi med på nye kunngjøringer fra Doffin og sender deg
          treffene. Gratis, og profilen starter på pause.
        </p>
        <p className="m-0">
          <Link className={buttonClassName({ variant: 'primary' })} href="/finn-anbud">
            Start varsling
          </Link>
        </p>
      </Stack>
    </section>
  );
}

/**
 * Spec 23.4: promotion must be visually separated, labelled as Luma content and
 * carry its disclosure. `Promotion` supplies all three, which is why this is not
 * a hand-rolled cream box.
 */
function CourseCard() {
  return (
    <Promotion heading="Vinn flere anbud med AI">
      <p className="m-0">
        Én dag med konkrete oppskrifter på hvordan du bruker AI i anbudsarbeidet, med egne anbud som
        case.
      </p>
      <p className="m-0 mt-xs">
        <a
          href={lumaUrl('/kurs/vinn-flere-anbud-med-ai', {
            medium: 'nettsted',
            campaign: 'vinn-flere-anbud-med-ai',
            content: 'kunngjoring',
          })}
        >
          Se kursdatoer
        </a>
      </p>
    </Promotion>
  );
}

function SourceNote() {
  return (
    <p className="prose-measure m-0 text-sm text-text-muted">
      Denne siden gjengir en kunngjøring fra Doffin. Vi endrer ikke innholdet. Ved
      uoverensstemmelser gjelder oppdragsgiverens kunngjøring.
    </p>
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

/** «Hele landet», the named counties, or nothing at all. Never «Ikke oppgitt». */
function areaText(tender: PublicTenderDetail): string | null {
  if (tender.nationwide) return 'Hele landet';
  if (tender.countyNames.length > 0) return tender.countyNames.join(', ');
  return null;
}
