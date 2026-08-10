import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Stack } from '@luma/ui';
import { COUNTY_NAMES, type Landsdel } from '@luma/domain';
import { FunnelBeacon } from '@/components/funnel-beacon';
import { InlineSignup } from '@/components/inline-signup';
import { ResultsExplorer, type RegionLink } from '@/components/results-explorer';
import type { ExplorerTender } from '@/components/results-filter';
import { loadTemplateChoice, type ServiceTemplateChoice } from '@/server/profiles';
import { buildPublicReasons } from '@/server/public-match-reasons';
import { searchPublicTenders, type PublicTenderSummary } from '@/server/public-search';
import {
  landsdelFromParam,
  landsdelerFor,
  qualifies,
  qualifyingRegionalParams,
} from '@/server/qualifying-pages';

/**
 * A trade in one landsdel (IDE Agent Spec v3, section 3.2).
 *
 * Only pairs that cleared the density threshold get a page. A pair that did
 * not is **redirected to the national page** rather than rendered thin or
 * 404'd: the notices are still there, they are simply too few to justify a
 * page of their own in a search index, and a reader who followed such a link
 * should land somewhere useful. `docs/search-surface-density.md` holds the
 * measurement and `qualifying-pages.ts` the resulting list.
 *
 * `dynamicParams` stays on precisely because that list is provisional — it was
 * measured over 37 days rather than 90, so it undercounts. A pair that starts
 * qualifying after a fuller re-run renders on demand instead of 404ing until
 * someone remembers to redeploy.
 *
 * Like the national page it reads no `searchParams`: the filtering happens in
 * the browser, over a result set that is already in the prerendered HTML.
 */
export const revalidate = 3600;

export async function generateStaticParams() {
  return qualifyingRegionalParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ bransje: string; landsdel: string }>;
}): Promise<Metadata> {
  const { bransje, landsdel } = await params;
  const [template, region] = [await loadTemplateChoice(bransje), landsdelFromParam(landsdel)];
  if (!template || !region) return { title: 'Ukjent side' };
  return {
    title: `Anbud for ${template.name} i ${region.name}`,
    description: `Offentlige anbud og planlagte anskaffelser for ${template.name.toLowerCase()} i ${region.name}, kunngjort på Doffin.`,
  };
}

/** See the twin in the national page: dates and county codes resolve here. */
function toExplorerTender(
  tender: PublicTenderSummary,
  template: ServiceTemplateChoice,
  landsdel: Landsdel,
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
    reasons: buildPublicReasons({ template, tender, landsdel }).map((reason) => ({
      label: reason.label,
      strength: reason.strength,
      evidence: reason.evidence,
    })),
  };
}

export default async function RegionalPage({
  params,
}: {
  params: Promise<{ bransje: string; landsdel: string }>;
}) {
  const { bransje, landsdel } = await params;
  const template = await loadTemplateChoice(bransje);
  const region = landsdelFromParam(landsdel);

  if (!template) notFound();
  // An unrecognised landsdel slug is a broken URL, not a thin page.
  if (!region) notFound();

  if (!qualifies(template.slug, region)) {
    redirect(`/anbud-for/${template.slug}`);
  }

  const now = new Date();
  const result = await searchPublicTenders({
    cpvInclude: template.cpvInclude,
    keywordsInclude: template.keywordsInclude,
    landsdel: region,
    now,
  });

  const regions: RegionLink[] = [
    { name: 'Hele landet', href: `/anbud-for/${template.slug}`, current: false },
    ...landsdelerFor(template.slug).map((entry) => ({
      name: entry.name,
      href: `/anbud-for/${template.slug}/${entry.slug}`,
      current: entry.code === region.code,
    })),
  ];

  return (
    <Stack gap="xl">
      {/* Beacons, not calls from this function: the page is prerendered, so
          this function runs once an hour rather than once per reader. */}
      <FunnelBeacon type="region_selected" bransje={template.slug} landsdel={region.slug} />
      <FunnelBeacon type="results_viewed" bransje={template.slug} landsdel={region.slug} />
      <Stack gap="md" className="prose-measure">
        <h1 className="page-heading">
          Anbud for {template.name} i {region.name}
        </h1>
        <p className="m-0">{template.description}</p>
        <p className="m-0 text-sm text-text-muted">
          <Link href={`/anbud-for/${template.slug}`}>Se hele landet i stedet</Link>
        </p>
      </Stack>

      <ResultsExplorer
        templateName={template.name}
        landsdelName={region.name}
        regional={result.regional.map((tender) => toExplorerTender(tender, template, region))}
        nationwide={result.nationwide.map((tender) => toExplorerTender(tender, template, region))}
        templateCpv={template.cpvInclude}
        templateKeywords={template.keywordsInclude}
        regions={regions}
        nowIso={now.toISOString()}
        rail={
          <InlineSignup
            templateSlug={template.slug}
            templateName={template.name}
            landsdelSlug={region.slug}
            landsdelName={region.name}
          />
        }
      />
    </Stack>
  );
}
