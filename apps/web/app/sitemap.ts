import type { MetadataRoute } from 'next';
import { LANDSDELER } from '@luma/domain';
import { PRODUCTION_URL } from '@/lib/site';
import { listServiceTemplateChoices } from '@/server/profiles';
import { listIndexableNotices } from '@/server/public-tenders';
import { qualifyingRegionalParams } from '@/server/qualifying-pages';

/**
 * The sitemap (IDE Agent Spec v3, section 3.3).
 *
 * Lists exactly the pages that are meant to be found: the landing page, the
 * picker, every trade page, the 27 qualifying regional pages, and the notices
 * that are still open or planned.
 *
 * ## What is deliberately absent
 *
 * **Closed, cancelled and awarded notices.** They are no longer opportunities,
 * and pointing a crawler at them spends the site's crawl budget re-reading
 * competitions nobody can enter. Note this is only half the mechanism: the
 * notice page emits `noindex` itself once its status flips, because a sitemap
 * controls what a crawler *finds* and by then Google has already found it.
 * Removing a URL here does not remove it from the index.
 *
 * **Everything behind a login, and every document.** The dashboard carries
 * `X-Robots-Tag: noindex` from `next.config.ts`, and no document or
 * document-derived URL appears here at all — ADR-0018's verification list says
 * so explicitly, because the competition documents carry no open licence.
 *
 * **`/delt/[token]` share links.** They are unauthenticated but they are not
 * public: a share link in a sitemap would publish every shared tender to
 * anyone, which is the opposite of what a share is.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: PRODUCTION_URL, lastModified: now, changeFrequency: 'daily', priority: 1 },
    {
      url: `${PRODUCTION_URL}/finn-anbud`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${PRODUCTION_URL}/vilkar`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.2,
    },
    {
      url: `${PRODUCTION_URL}/personvern`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.2,
    },
    {
      url: `${PRODUCTION_URL}/ai-verktoy`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.4,
    },
  ];

  const templates = await listServiceTemplateChoices();
  const tradeEntries: MetadataRoute.Sitemap = templates.map((template) => ({
    url: `${PRODUCTION_URL}/anbud-for/${template.slug}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 0.8,
  }));

  // Only the pairs that earned a page. A below-threshold pair redirects to the
  // national page, and listing a redirect in a sitemap asks a crawler to index
  // a hop.
  const regionalEntries: MetadataRoute.Sitemap = qualifyingRegionalParams().map((params) => ({
    url: `${PRODUCTION_URL}/anbud-for/${params.bransje}/${params.landsdel}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  const notices = await listIndexableNotices();
  const noticeEntries: MetadataRoute.Sitemap = notices.map((notice) => ({
    url: `${PRODUCTION_URL}/kunngjoring/${notice.id}`,
    lastModified: notice.publishedAt,
    changeFrequency: 'weekly',
    priority: 0.6,
  }));

  // Referenced so an added landsdel without a page is a visible inconsistency
  // rather than a silent one: every slug in `regionalEntries` must be a real
  // landsdel slug.
  const known = new Set(LANDSDELER.map((entry) => entry.slug));
  const unknown = regionalEntries.filter((entry) => !known.has(entry.url.split('/').pop() ?? ''));
  if (unknown.length > 0) {
    console.warn(`sitemap: ${unknown.length} regional entries name an unknown landsdel`);
  }

  return [...staticEntries, ...tradeEntries, ...regionalEntries, ...noticeEntries];
}
