import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Stack } from '@luma/ui';
import { FunnelBeacon } from '@/components/funnel-beacon';
import { PublicResults } from '@/components/public-results';
import { loadTemplateChoice } from '@/server/profiles';
import { searchPublicTenders } from '@/server/public-search';
import { landsdelFromParam, qualifies, qualifyingRegionalParams } from '@/server/qualifying-pages';

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

  const result = await searchPublicTenders({
    cpvInclude: template.cpvInclude,
    landsdel: region,
    now: new Date(),
  });

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

      <PublicResults result={result} landsdelName={region.name} />

      <p className="m-0">
        <Link href={`/?bransje=${template.slug}&landsdel=${region.slug}#registrering`}>
          Få disse på e-post — sett opp gratis varsling
        </Link>
      </p>
    </Stack>
  );
}
