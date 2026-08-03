import { withUtm, type UtmMedium } from '@luma/domain';
import type { LinkContext } from './types.js';

/**
 * Every URL an email can contain.
 *
 * Two rules are enforced here rather than at the call sites:
 *
 * 1. Spec section 44.2: every outgoing Luma link carries `utm_source`,
 *    `utm_medium` for the surface and, for a recommendation, `utm_campaign`.
 *    `withUtm` comes from `@luma/domain`; this module never re-implements it.
 * 2. Links to somebody else's site - Doffin above all - carry no UTM at all.
 *    Tagging a public source with our analytics parameters would be both
 *    rude and misleading, and spec section 4.5 wants the source link to be
 *    the source link.
 *
 * Paths match the web routes in spec section 16.
 */

function join(baseUrl: string, path: string, query?: Readonly<Record<string, string>>): string {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/** A Luma link with the surface's UTM parameters applied. */
export function lumaLink(
  url: string,
  medium: UtmMedium,
  extra?: { campaign?: string; content?: string },
): string {
  return withUtm(url, {
    medium,
    ...(extra?.campaign ? { campaign: extra.campaign } : {}),
    ...(extra?.content ? { content: extra.content } : {}),
  });
}

/**
 * A link to a source system. Returned unchanged.
 *
 * Exists as a named function so that "why does this one have no UTM?" has an
 * answer in the code rather than in a reviewer's memory.
 */
export function externalSourceLink(url: string): string {
  return url;
}

export interface EmailLinks {
  readonly tenderDetail: (tenderId: string) => string;
  readonly saveTender: (tenderId: string) => string;
  readonly dismissTender: (tenderId: string) => string;
  readonly plannedProcurements: string;
  readonly manageAlertProfile: string;
  readonly pauseAlerts: string;
  readonly unsubscribeTenderAlerts: string;
  readonly disablePromotion: string;
  readonly notificationSettings: string;
  readonly accountSettings: string;
  readonly privacy: string;
  readonly terms: string;
}

/** Builds the full link set for one email. */
export function buildLinks(context: LinkContext): EmailLinks {
  const { appUrl, medium, actionToken } = context;
  const token = actionToken ? { t: actionToken } : undefined;
  const app = (path: string, query?: Readonly<Record<string, string>>): string =>
    lumaLink(join(appUrl, path, query), medium);

  return {
    tenderDetail: (tenderId) => app(`anbud/${encodeURIComponent(tenderId)}`),
    saveTender: (tenderId) =>
      app(`anbud/${encodeURIComponent(tenderId)}`, { handling: 'lagre', ...token }),
    dismissTender: (tenderId) =>
      app(`anbud/${encodeURIComponent(tenderId)}`, { handling: 'avvis', ...token }),
    plannedProcurements: app('planlagte'),
    manageAlertProfile: app('varsler'),
    pauseAlerts: app('innstillinger', { handling: 'pause-varsler', ...token }),
    unsubscribeTenderAlerts: app('innstillinger', {
      handling: 'avslutt-anbudsvarsling',
      ...token,
    }),
    disablePromotion: app('innstillinger', { handling: 'slaa-av-promotering', ...token }),
    notificationSettings: app('innstillinger'),
    accountSettings: app('innstillinger'),
    privacy: lumaLink(context.privacyUrl, medium),
    terms: lumaLink(context.termsUrl, medium),
  };
}

/**
 * Extracts every URL from a rendered part.
 *
 * Used by the link-parity test. HTML entities are decoded first, because an
 * `&` inside a UTM query string is `&amp;` in an attribute value.
 */
const URL_PATTERN = /https?:\/\/[^\s"'<>)\]]+/g;

export function extractUrls(part: string): string[] {
  const decoded = part
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  const found = decoded.match(URL_PATTERN) ?? [];
  // A trailing sentence period is not part of the URL.
  return found.map((url) => url.replace(/[.,;:]+$/, ''));
}
