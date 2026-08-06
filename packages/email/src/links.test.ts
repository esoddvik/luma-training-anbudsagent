import { describe, expect, it } from 'vitest';
import { appUrlFor, buildLinks } from './links.js';

/**
 * The base path survives every generated link.
 *
 * This is the guard on the deployment decision recorded in
 * `docs/spec-deviations.md`: the service is served at
 * `luma-training.com/anbudsvarsling` (spec §16), and the prefix lives in one
 * place only — the `APP_URL` value each runtime is handed. `apps/core` mints
 * magic links, share links and every footer link without knowing that
 * `apps/web` has a Next `basePath`, so if `APP_URL`'s path is dropped during
 * URL construction the link points at the marketing site instead.
 *
 * That failure is silent in every direction: the URL parses, the host is right,
 * the email sends, and the person clicking it gets Luma Training's own 404.
 * Nothing logs. So the assertion is made here, on the join itself, rather than
 * left to an integration test that needs a database to run.
 *
 * Proved able to fail before it was trusted: restoring the original
 * `new URL(path, appUrl)` — which is what both magic-link builders did — turns
 * every `prefix` case in this file red, and reverting `path.replace(/^\/+/, '')`
 * turns the leading-slash cases red on their own.
 */

const BASE_PATH = '/anbudsvarsling';
const APP_URL = `https://luma-training.com${BASE_PATH}`;

describe('appUrlFor', () => {
  it('keeps the base path when the in-app path has a leading slash', () => {
    // The exact shape both magic-link builders pass: `'/logg-inn/bekreft'`.
    expect(appUrlFor(APP_URL, '/logg-inn/bekreft')).toBe(
      'https://luma-training.com/anbudsvarsling/logg-inn/bekreft',
    );
  });

  it('keeps the base path when the in-app path is relative', () => {
    expect(appUrlFor(APP_URL, 'varsler')).toBe('https://luma-training.com/anbudsvarsling/varsler');
  });

  it('treats a leading slash and no leading slash as the same path', () => {
    expect(appUrlFor(APP_URL, '/delt/abc')).toBe(appUrlFor(APP_URL, 'delt/abc'));
  });

  it('keeps the base path when APP_URL already ends in a slash', () => {
    expect(appUrlFor(`${APP_URL}/`, '/oversikt')).toBe(
      'https://luma-training.com/anbudsvarsling/oversikt',
    );
  });

  it('keeps the base path in front of the query string', () => {
    expect(appUrlFor(APP_URL, '/innstillinger', { handling: 'pause-varsler', t: 'tok' })).toBe(
      'https://luma-training.com/anbudsvarsling/innstillinger?handling=pause-varsler&t=tok',
    );
  });

  it('still works for an APP_URL with no path, which is what a root deploy has', () => {
    expect(appUrlFor('https://example.test', '/oversikt')).toBe('https://example.test/oversikt');
  });
});

describe('buildLinks under a base path', () => {
  const links = buildLinks({
    appUrl: APP_URL,
    privacyUrl: 'https://luma-training.com/personvern',
    termsUrl: `${APP_URL}/vilkar`,
    medium: 'epost',
    actionToken: 'handlingstoken',
  });

  /**
   * Every app link, checked as a set rather than one by one.
   *
   * A link added to `EmailLinks` later is covered by this without anybody
   * remembering to extend the list, which is the whole point: the next footer
   * link is exactly the one that would ship without the prefix.
   */
  const appLinks: readonly string[] = [
    links.tenderDetail('11111111-1111-4111-8111-111111111111'),
    links.saveTender('11111111-1111-4111-8111-111111111111'),
    links.dismissTender('11111111-1111-4111-8111-111111111111'),
    links.plannedProcurements,
    links.manageAlertProfile,
    links.pauseAlerts,
    links.unsubscribeTenderAlerts,
    links.disablePromotion,
    links.notificationSettings,
    links.accountSettings,
    links.terms,
  ];

  it('puts every in-app link under the base path', () => {
    for (const url of appLinks) {
      expect(new URL(url).pathname.startsWith(`${BASE_PATH}/`)).toBe(true);
    }
  });

  it('does not double the prefix', () => {
    for (const url of appLinks) {
      expect(new URL(url).pathname.indexOf(BASE_PATH)).toBe(
        new URL(url).pathname.lastIndexOf(BASE_PATH),
      );
    }
  });

  /**
   * The privacy link is Luma Training's own, at the root of the same domain
   * (`LUMA_PRIVACY_POLICY_URL`). It must **not** acquire the prefix — that
   * would be this test's own mistake wearing the costume of a fix.
   */
  it('leaves a link to the marketing site at the root of the domain', () => {
    expect(new URL(links.privacy).pathname).toBe('/personvern');
  });
});
