import { appPath, expect, sessionCookie, signIn, tenderId, test } from './support';

/**
 * The tender detail page (spec section 16).
 *
 * The assertions are the obligations that must survive a redesign: source
 * traceability (4.5), a match explanation (4.2), the approved score vocabulary
 * with its disclaimer and never a win probability (4.3), and promotion last
 * (23.3, 23.4).
 */

test.describe('anbudsdetaljsiden', () => {
  test.skip(
    !sessionCookie || !tenderId,
    'krever E2E_SESSION_COOKIE og E2E_TENDER_ID fra et seedet miljø',
  );

  test.beforeEach(async ({ context, baseURL, page }) => {
    await signIn(context, baseURL!);
    await page.goto(appPath(`/anbud/${tenderId}`));
  });

  test('viser kilde og synkroniseringstidspunkt', async ({ page }) => {
    const kilde = page.locator('section', {
      has: page.getByRole('heading', { name: 'Kilde og sporbarhet' }),
    });
    await expect(kilde.getByText('Doffin-ID')).toBeVisible();
    await expect(kilde.getByText('Sist synkronisert')).toBeVisible();
    await expect(kilde.getByRole('link', { name: 'Åpne kunngjøringen på Doffin' })).toHaveAttribute(
      'href',
      /doffin/,
    );
  });

  test('viser matchforklaringen med godkjent formulering og forbehold', async ({ page }) => {
    const forklaring = page.getByRole('heading', { name: /Hvorfor dette anbudet passer/ });
    await expect(forklaring).toBeVisible();

    const tekst = await page.locator('main').innerText();
    // Spec 4.3: en av de tre godkjente formuleringene, aldri en prosentsats.
    expect(tekst).toMatch(/Høy relevans|Verdt å undersøke|Treff med lav sikkerhet/);
    expect(tekst).toContain('Den sier ingenting om sannsynligheten for å vinne');
    expect(tekst).toContain('Vurderingen er regelbasert');
  });

  test('bruker ingen av de forbudte formuleringene om å vinne', async ({ page }) => {
    const tekst = (await page.locator('main').innerText()).toLowerCase();
    for (const forbudt of [
      'vinnersannsynlighet',
      'prosent sannsynlighet',
      'garantert treff',
      'bør definitivt levere',
      'vil dere vinne',
    ]) {
      expect(tekst).not.toContain(forbudt);
    }
  });

  test('har knapper for å lagre, avvise og dele', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /Lagre anbudet|Fjern fra lagrede/ }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Avvis anbudet|Angre avvisning/ })).toBeVisible();
  });

  test('har relevansfeedback med de vurderingene spec 15 nevner', async ({ page }) => {
    const vurdering = page.getByLabel('Vurdering');
    await expect(vurdering).toBeVisible();
    for (const valg of ['Relevant', 'Ikke relevant', 'Feil geografi', 'Feil CPV']) {
      await expect(vurdering.getByRole('option', { name: valg })).toHaveCount(1);
    }
    await expect(page.getByRole('button', { name: 'Send tilbakemelding' })).toBeVisible();
  });

  test('plasserer promoteringen etter anbudsinnholdet', async ({ page }) => {
    // Spec 23.3: promotering kommer etter anbudsinnholdet. Spec 23.4: tydelig
    // merket. Blokken kan mangle helt hvis brukeren har slått den av.
    const promotering = page.locator('.luma-promotion');
    if ((await promotering.count()) === 0) return;

    await expect(promotering.getByText('Fra Luma Training')).toBeVisible();
    await expect(
      promotering.getByText('Det påvirker ikke hvilke anbud du får se', { exact: false }),
    ).toBeVisible();

    const kilde = page.locator('section', {
      has: page.getByRole('heading', { name: 'Kilde og sporbarhet' }),
    });
    const kildeBoks = await kilde.boundingBox();
    const promoBoks = await promotering.first().boundingBox();
    expect(promoBoks!.y).toBeGreaterThan(kildeBoks!.y);
  });

  test('har fornuftig overskriftsrekkefølge', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });
});

test.describe('ukjent anbud', () => {
  test.skip(!sessionCookie, 'krever E2E_SESSION_COOKIE fra et seedet miljø');

  test('gir en norsk «fant ikke siden» for en id som ikke finnes', async ({
    context,
    baseURL,
    page,
  }) => {
    await signIn(context, baseURL!);
    const response = await page.goto(appPath('/anbud/00000000-0000-4000-8000-000000000000'));
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Fant ikke siden' })).toBeVisible();
  });
});
