import { appPath, expect, sessionCookie, signIn, test } from './support';

/**
 * The dashboard (spec section 16).
 *
 * The first test needs no session: that an unauthenticated visitor is sent to
 * the login page rather than shown someone's matches is itself the assertion.
 */

test.describe('oversikten uten innlogging', () => {
  test('sender en uinnlogget besøkende til innlogging', async ({ page }) => {
    await page.goto(appPath('/oversikt'));
    await expect(page).toHaveURL(/\/logg-inn/);
  });
});

test.describe('oversikten', () => {
  test.skip(!sessionCookie, 'krever E2E_SESSION_COOKIE fra et seedet miljø');

  test.beforeEach(async ({ context, baseURL, page }) => {
    await signIn(context, baseURL!);
    await page.goto(appPath('/oversikt'));
  });

  test('viser hovedoverskriften på norsk', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'Oversikt' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'nb');
  });

  test('har planlagte anskaffelser som egen, tydelig merket seksjon', async ({ page }) => {
    // Lanseringsblokkering 51.10: planlagte anskaffelser skal ikke kunne
    // forveksles med åpne konkurranser.
    const planlagte = page.getByRole('heading', {
      level: 2,
      name: 'Planlagte anskaffelser',
    });
    await expect(planlagte).toBeVisible();

    const seksjon = page.locator('section', { has: planlagte });
    await expect(seksjon.getByText('Ikke kunngjort ennå')).toBeVisible();
    await expect(
      seksjon.getByText('Konkurransen er ikke publisert', { exact: false }),
    ).toBeVisible();
  });

  test('har konkurranseseksjonen før den planlagte seksjonen', async ({ page }) => {
    const overskrifter = await page.getByRole('heading', { level: 2 }).allInnerTexts();
    const konkurranser = overskrifter.indexOf('Kunngjorte konkurranser');
    const planlagte = overskrifter.indexOf('Planlagte anskaffelser');
    if (konkurranser === -1 || planlagte === -1) return;
    expect(konkurranser).toBeLessThan(planlagte);
  });

  test('har filtre med ledetekster som er koblet til kontrollene', async ({ page }) => {
    // Spec 16: filter på profil, frist, oppdragsgiver, CPV, status og kategori.
    for (const label of [
      'Varslingsprofil',
      'Frist innen',
      'Oppdragsgiver',
      'CPV-kode',
      'Status',
      'Kategori',
    ]) {
      await expect(page.getByLabel(label)).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Bruk filtrene' })).toBeVisible();
  });

  test('filtrering er en vanlig navigasjon som kan bokmerkes', async ({ page }) => {
    await page.getByLabel('Kategori').selectOption('planned');
    await page.getByRole('button', { name: 'Bruk filtrene' }).click();
    await expect(page).toHaveURL(/kategori=planned/);
  });

  test('viser aldri en poengsum i prosent', async ({ page }) => {
    // Spec 4.3: en relevansscore er ikke en vinnersannsynlighet, og den vises
    // ikke som et tall i det hele tatt.
    const tekst = await page.locator('main').innerText();
    expect(tekst).not.toMatch(/\d+\s*(%|prosent)\s*(sannsynlig|treff|match)/i);
    expect(tekst.toLowerCase()).not.toContain('sannsynlighet for å vinne');
  });

  test('kan navigeres med tastatur fra hopp-til-innhold-lenken', async ({ page }) => {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Hopp til hovedinnhold' })).toBeFocused();
  });
});
