import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Stack } from '@luma/ui';
import { FunnelBeacon } from '@/components/funnel-beacon';
import { PublicResults } from '@/components/public-results';
import { loadTemplateChoice } from '@/server/profiles';
import { searchPublicTenders } from '@/server/public-search';
import { landsdelerFor, nationalPageParams } from '@/server/qualifying-pages';

/**
 * A trade's national page (IDE Agent Spec v3, section 3.2).
 *
 * Every template has one, including the two that earned no regional pages at
 * all — those are precisely the trades whose demand is too thin to cut by
 * geography, so the national page is the only honest view of them.
 *
 * **A `cross_sector` template shows the region selector above the results.**
 * That is the spec's rule and it follows from ADR-17: when the buyer can be
 * anyone, geography is the load-bearing second axis, so national is the correct
 * default and narrowing is the reader's own choice rather than a guess made
 * for them.
 */
export const revalidate = 3600;

export async function generateStaticParams() {
  return nationalPageParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ bransje: string }>;
}): Promise<Metadata> {
  const { bransje } = await params;
  const template = await loadTemplateChoice(bransje);
  if (!template) return { title: 'Ukjent bransje' };
  return {
    title: `Anbud for ${template.name}`,
    description: `Offentlige anbud og planlagte anskaffelser for ${template.name.toLowerCase()}, kunngjort på Doffin.`,
  };
}

export default async function NationalPage({ params }: { params: Promise<{ bransje: string }> }) {
  const { bransje } = await params;
  const template = await loadTemplateChoice(bransje);
  if (!template) notFound();

  const result = await searchPublicTenders({
    cpvInclude: template.cpvInclude,
    now: new Date(),
  });

  const regions = landsdelerFor(template.slug);
  const showsRegionPicker = template.supplierForm === 'cross_sector' && regions.length > 0;

  return (
    <Stack gap="xl">
      {/* Beacons, not calls from this function: the page is prerendered, so
          this function runs once an hour rather than once per reader. */}
      <FunnelBeacon type="trade_selected" bransje={template.slug} />
      <FunnelBeacon type="results_viewed" bransje={template.slug} />
      <Stack gap="md" className="prose-measure">
        <h1 className="page-heading">Anbud for {template.name}</h1>
        <p className="m-0">{template.description}</p>
      </Stack>

      {regions.length > 0 ? (
        <nav
          aria-label="Velg landsdel"
          // Above the results for a cross-sector trade, below the heading for
          // a sector-bound one. Same links either way; the difference is how
          // prominently the narrowing is offered.
          className={showsRegionPicker ? 'order-first' : undefined}
        >
          <Stack gap="sm">
            <p className="m-0 font-medium">
              {showsRegionPicker
                ? 'Virksomheter som leverer dette selger over hele landet. Vil du se én landsdel?'
                : 'Se én landsdel:'}
            </p>
            <ul className="m-0 flex list-none flex-wrap gap-sm p-0">
              {regions.map((region) => (
                <li key={region.code}>
                  <Link href={`/anbud-for/${template.slug}/${region.slug}`}>{region.name}</Link>
                </li>
              ))}
            </ul>
          </Stack>
        </nav>
      ) : null}

      <PublicResults result={result} />

      <p className="m-0">
        <Link href={`/?bransje=${template.slug}#registrering`}>
          Få disse på e-post — sett opp gratis varsling
        </Link>
      </p>
    </Stack>
  );
}
