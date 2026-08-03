/**
 * Outbound links to Luma Training.
 *
 * Spec section 44.2: every outbound Luma link from the service must carry
 * consistent UTM parameters — `utm_source=anbudsvarsling` always,
 * `utm_medium` by surface, `utm_campaign` by recommendation. Attribution is a
 * launch blocker (section 51, point 13), so tagging happens here and nowhere
 * else; no component builds a Luma URL by hand.
 */

/** Constant across every surface. Section 44.2. */
export const UTM_SOURCE = 'anbudsvarsling';

/** Root of Luma Training's public website. */
export const LUMA_BASE_URL = 'https://luma-training.com';

/**
 * `utm_medium` values, one per surface the link can appear on. Keeping this a
 * closed union is what makes the attribution report groupable.
 */
export type LumaLinkMedium =
  'landingsside' | 'nettsted' | 'epost' | 'delt-visning' | 'mcp' | 'admin';

export interface LumaUtmOptions {
  readonly medium: LumaLinkMedium;
  /** Recommendation or campaign key, e.g. `vinn-flere-anbud-med-ai`. */
  readonly campaign?: string;
  /** Optional placement detail, e.g. `footer` or `promoteringsblokk`. */
  readonly content?: string;
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;

/**
 * Adds (or replaces) the UTM parameters on an absolute http(s) URL.
 *
 * Existing non-UTM query parameters and the fragment are preserved. Existing
 * UTM parameters are overwritten rather than duplicated, so calling this twice
 * produces the same URL as calling it once.
 */
export function withLumaUtm(url: string, options: LumaUtmOptions): string {
  const parsed = parseAbsoluteUrl(url);

  // Delete first: `URLSearchParams.set` only replaces the first occurrence, so
  // a URL that already carries `?utm_source=a&utm_source=b` would keep the
  // duplicate.
  for (const key of UTM_KEYS) {
    parsed.searchParams.delete(key);
  }

  parsed.searchParams.set('utm_source', UTM_SOURCE);
  parsed.searchParams.set('utm_medium', options.medium);
  if (options.campaign !== undefined && options.campaign.length > 0) {
    parsed.searchParams.set('utm_campaign', options.campaign);
  }
  if (options.content !== undefined && options.content.length > 0) {
    parsed.searchParams.set('utm_content', options.content);
  }

  return parsed.toString();
}

/** Builds a tagged link to a path on Luma Training's website. */
export function lumaUrl(path: string, options: LumaUtmOptions): string {
  const normalised = path.length === 0 || path === '/' ? '/' : `/${path.replace(/^\/+/, '')}`;
  return withLumaUtm(`${LUMA_BASE_URL}${normalised}`, options);
}

const LUMA_ROOT_DOMAIN = 'luma-training.com';

/** True for luma-training.com and any of its subdomains. */
export function isLumaUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = parseAbsoluteUrl(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return host === LUMA_ROOT_DOMAIN || host.endsWith(`.${LUMA_ROOT_DOMAIN}`);
}

function parseAbsoluteUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Utgående Luma-lenke må være en absolutt URL: ${url}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Utgående Luma-lenke må bruke http eller https: ${url}`);
  }
  return parsed;
}
