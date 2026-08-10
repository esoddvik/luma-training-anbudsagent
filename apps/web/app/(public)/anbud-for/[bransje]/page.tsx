import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Stack } from '@luma/ui';
import { COUNTY_NAMES } from '@luma/domain';
import { FunnelBeacon } from '@/components/funnel-beacon';
import { InlineSignup } from '@/components/inline-signup';
import { ResultsExplorer, type RegionLink } from '@/components/results-explorer';
import type { ExplorerTender } from '@/components/results-filter';
import { loadTemplateChoice } from '@/server/profiles';
import type { ServiceTemplateChoice } from '@/server/profiles';
import { buildPublicReasons } from '@/server/public-match-reasons';
import { searchPublicTenders, type PublicTenderSummary } from '@/server/public-search';
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
 *
 * ## Still a server component, and still static
 *
 * The results are filtered in the browser by `ResultsExplorer`, but nothing
 * about that reaches this function: it reads no `searchParams` — which is the
 * one rule these routes exist under, since a page that reads them cannot be
 * prerendered — and hands the client component a plain serialisable array. The
 * whole result set is therefore in the HTML before any script runs.
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

/**
 * `PublicTenderSummary` → the wire format the client component reads.
 *
 * Dates become ISO strings and county codes become names here, on the server:
 * a `Date` does not survive the boundary, and `COUNTY_NAMES` has no business
 * being shipped to the browser to look up six strings.
 */
function toExplorerTender(
  tender: PublicTenderSummary,
  template: ServiceTemplateChoice,
): ExplorerTender {
  return {
    id: tender.id,
    title: tender.title,
    buyerName: tender.buyerName,
    counties: tender.regionCodes
      .map((code) => COUNTY_NAMES[code])
      .filter((name): name is string => Boolean(name)),
    planned: tender.noticeCategory === 'planned',
    deadlineAt: tender.deadlineAt ? tender.deadlineAt.toISOString() : null,
    estimatedValueMinNok: tender.estimatedValueMinNok,
    cpvCodes: tender.cpvCodes,
    matchedKeywords: tender.matchedKeywords,
    reasons: buildPublicReasons({ template, tender }).map((reason) => ({
      label: reason.label,
      strength: reason.strength,
      evidence: reason.evidence,
    })),
  };
}

export default async function NationalPage({ params }: { params: Promise<{ bransje: string }> }) {
  const { bransje } = await params;
  const template = await loadTemplateChoice(bransje);
  if (!template) notFound();

  const now = new Date();
  const result = await searchPublicTenders({
    cpvInclude: template.cpvInclude,
    keywordsInclude: template.keywordsInclude,
    now,
  });

  const regions: RegionLink[] = [
    { name: 'Hele landet', href: `/anbud-for/${template.slug}`, current: true },
    ...landsdelerFor(template.slug).map((region) => ({
      name: region.name,
      href: `/anbud-for/${template.slug}/${region.slug}`,
      current: false,
    })),
  ];

  return (
    // The design floats each screen on a rounded cream panel rather than
    // letting content sit straight on the page background. `.bleed` is what
    // lets the panel run the full width and carry its own surface; the shell
    // width is restored inside it.
    <div className="bleed">
      <Stack gap="xl" className="luma-panel app-shell">
        {/* Beacons, not calls from this function: the page is prerendered, so
          this function runs once an hour rather than once per reader. */}
        <FunnelBeacon type="trade_selected" bransje={template.slug} />
        <FunnelBeacon type="results_viewed" bransje={template.slug} />
        <Stack gap="md" className="prose-measure">
          <h1 className="page-heading">Anbud for {template.name}</h1>
          <p className="m-0">{template.description}</p>
          {template.supplierForm === 'cross_sector' && regions.length > 1 ? (
            <p className="m-0 text-sm text-text-muted">
              Virksomheter som leverer dette selger over hele landet. Vil du se én landsdel?
            </p>
          ) : null}
        </Stack>

        <ResultsExplorer
          templateName={template.name}
          regional={result.regional.map((tender) => toExplorerTender(tender, template))}
          nationwide={result.nationwide.map((tender) => toExplorerTender(tender, template))}
          templateCpv={template.cpvInclude}
          templateKeywords={template.keywordsInclude}
          regions={regions.length > 1 ? regions : []}
          nowIso={now.toISOString()}
          rail={<InlineSignup templateSlug={template.slug} templateName={template.name} />}
        />
      </Stack>
    </div>
  );
}
