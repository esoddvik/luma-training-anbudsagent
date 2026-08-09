import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Stack } from '@luma/ui';
import { formatDate } from '@/server/format';
import { shouldIndexNotice } from '@/server/notice-indexing';
import { loadPublicTender } from '@/server/public-tenders';

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

const STATUS_LABEL: Record<string, string> = {
  open: 'Åpen',
  closed: 'Avsluttet',
  cancelled: 'Avlyst',
  awarded: 'Tildelt',
  unknown: 'Ukjent',
};

export default async function NoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tender = await loadPublicTender(id);
  // Covers "no such notice", "suppressed" and "award" identically. A suppressed
  // notice must not be distinguishable from one that never existed.
  if (!tender) notFound();

  return (
    <Stack gap="xl">
      <Stack gap="md" className="prose-measure">
        <p className="eyebrow">
          {tender.noticeCategory === 'planned' ? 'Planlagt anskaffelse' : 'Konkurranse'} ·{' '}
          {STATUS_LABEL[tender.status] ?? tender.status}
        </p>
        <h1 className="page-heading">{tender.title}</h1>
        <p className="m-0 text-lg text-text-muted">{tender.buyerName}</p>
      </Stack>

      <dl className="m-0 grid gap-md md:grid-cols-2">
        <div>
          <dt className="m-0 text-xs uppercase tracking-wide text-text-muted">Publisert</dt>
          <dd className="m-0">{formatDate(tender.publishedAt)}</dd>
        </div>
        <div>
          <dt className="m-0 text-xs uppercase tracking-wide text-text-muted">Frist</dt>
          <dd className="m-0">
            {tender.noticeCategory === 'planned'
              ? // Never a fabricated deadline: a planned procurement has none,
                // and saying so is the whole point of the category (ADR-13).
                'Konkurransen er ikke publisert ennå'
              : (tender.deadlineAt && formatDate(tender.deadlineAt)) || 'Ikke oppgitt'}
          </dd>
        </div>
        <div>
          <dt className="m-0 text-xs uppercase tracking-wide text-text-muted">Sted</dt>
          <dd className="m-0">
            {tender.nationwide
              ? 'Hele landet'
              : tender.countyNames.length > 0
                ? tender.countyNames.join(', ')
                : 'Ikke oppgitt'}
          </dd>
        </div>
        <div>
          <dt className="m-0 text-xs uppercase tracking-wide text-text-muted">Anslått verdi</dt>
          <dd className="m-0">
            {tender.estimatedValueMinNok === null
              ? 'Ikke oppgitt'
              : `${tender.estimatedValueMinNok.toLocaleString('nb-NO')} ${tender.currency ?? 'NOK'}`}
          </dd>
        </div>
      </dl>

      {tender.description ? (
        <section aria-labelledby="beskrivelse" className="prose-measure">
          <Stack gap="sm">
            <h2 id="beskrivelse" className="section-heading">
              Om oppdraget
            </h2>
            <p className="m-0 whitespace-pre-line">{tender.description}</p>
          </Stack>
        </section>
      ) : null}

      <Stack gap="sm" className="prose-measure">
        <p className="m-0">
          <Link href={tender.sourceUrl}>Åpne kunngjøringen på Doffin</Link>
        </p>
        <p className="m-0">
          <Link href="/#registrering">Få varsel om anbud som dette — gratis</Link>
        </p>
        {/* Required by CC BY 4.0 wherever announcement data is republished to
            someone who did not fetch it themselves (ADR-0018). Reads exactly
            `Data: Doffin/DFØ (CC BY 4.0)` as text. */}
        <p className="m-0 text-sm text-text-muted">
          Data: Doffin/DFØ (
          <Link href="https://creativecommons.org/licenses/by/4.0/deed.no">CC BY 4.0</Link>)
        </p>
      </Stack>
    </Stack>
  );
}
