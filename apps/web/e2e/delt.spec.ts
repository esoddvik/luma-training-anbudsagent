import { expect, profileKeyword, profileName, shareToken, sharerEmail, test } from './support';

/**
 * The public shared view (spec section 17, launch blocker 51.11).
 *
 * The neutral page for an unknown token needs no seeding and no session, so
 * those assertions run anywhere. The rest needs `E2E_SHARE_TOKEN` from a seeded
 * environment, along with the values the seed used for the sharer's e-mail and
 * the profile's keyword, so the page can be searched for them.
 *
 * Those three come from `./support` rather than from `process.env` here, so
 * that the CI guard which insists they are set has one list to check. Reading
 * them directly would put them outside it.
 */

const SHARER_EMAIL = sharerEmail;
const PROFILE_KEYWORD = profileKeyword;
const PROFILE_NAME = profileName;

test.describe('delt-visning uten gyldig lenke', () => {
  test('viser en nøytral norsk side for et ukjent token', async ({ page }) => {
    await page.goto(`/delt/${'z'.repeat(43)}`);

    await expect(
      page.getByRole('heading', { name: 'Denne delingslenken er ikke lenger aktiv' }),
    ).toBeVisible();
    // Nøytral: siden sier ikke om lenken har utløpt, er opphevet eller aldri
    // har eksistert. Å skille dem ville bekreftet at et gjettet token var ekte.
    const tekst = await page.locator('main').innerText();
    expect(tekst).toContain('Lenken kan ha utløpt eller blitt opphevet');
    expect(tekst).not.toContain('finnes ikke');
  });

  test('krever ikke innlogging', async ({ page }) => {
    const response = await page.goto(`/delt/${'z'.repeat(43)}`);
    expect(response?.status()).toBe(200);
    await expect(page).not.toHaveURL(/logg-inn/);
  });
});

test.describe('delt-visning', () => {
  test.skip(!shareToken, 'krever E2E_SHARE_TOKEN fra et seedet miljø');

  test.beforeEach(async ({ page }) => {
    await page.goto(`/delt/${shareToken}`);
  });

  test('åpnes uten innlogging og viser anbudet', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Åpne kunngjøringen på Doffin' })).toBeVisible();
  });

  test('er merket med kategori og viser frist', async ({ page }) => {
    const tekst = await page.locator('main').innerText();
    expect(tekst).toMatch(/Konkurranse|Planlagt anskaffelse|Tildeling|Annen kunngjøring/);
    expect(tekst).toContain('Frist');
  });

  test('er ikke indekserbar', async ({ page }) => {
    // Spec 17: delingslenker skal ikke indekseres.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('viser en forenklet matchforklaring med typer, ikke verdier', async ({ page }) => {
    const forklaring = page.locator('section', {
      has: page.getByRole('heading', { name: 'Hvorfor anbudet ble plukket ut' }),
    });
    await expect(forklaring).toBeVisible();
    await expect(
      forklaring.getByText('Vi viser ikke hvilke kriterier eller verdier', { exact: false }),
    ).toBeVisible();
  });

  test('lekker ingen persondata', async ({ page }) => {
    // Lanseringsblokkering 51.11. Hele sidekilden søkes, ikke bare den synlige
    // teksten: en lekkasje i et skjult felt eller et data-attributt teller like
    // fullt.
    const html = await page.content();

    for (const forbudt of [
      'createdByUserId',
      'created_by_user_id',
      'alertProfileId',
      'alert_profile_id',
      'profileName',
      'keywordsInclude',
      'sharedBy',
      'score',
    ]) {
      expect(html, `«${forbudt}» skal ikke forekomme i delt-visningen`).not.toContain(forbudt);
    }

    // Selve tokenet skal ikke stå i sidekilden, bare i adressefeltet.
    expect(html).not.toContain(shareToken!);

    if (SHARER_EMAIL) expect(html).not.toContain(SHARER_EMAIL);
    if (PROFILE_KEYWORD) expect(html.toLowerCase()).not.toContain(PROFILE_KEYWORD.toLowerCase());
    if (PROFILE_NAME) expect(html).not.toContain(PROFILE_NAME);
  });

  test('har nøyaktig én invitasjonsblokk og ingen annen promotering', async ({ page }) => {
    // Spec 17: én rolig invitasjon nederst, ingen annen promotering.
    await expect(page.getByRole('heading', { name: 'Få dine egne anbudsvarsler' })).toHaveCount(1);
    await expect(page.locator('.luma-promotion')).toHaveCount(0);
  });

  test('invitasjonen kommer etter anbudsinnholdet', async ({ page }) => {
    const invitasjon = page.getByRole('heading', { name: 'Få dine egne anbudsvarsler' });
    const kilde = page.getByRole('heading', { name: 'Kilde' });
    const invitasjonBoks = await invitasjon.boundingBox();
    const kildeBoks = await kilde.first().boundingBox();
    expect(invitasjonBoks!.y).toBeGreaterThan(kildeBoks!.y);
  });

  test('invitasjonslenken bærer attribusjonsparametere', async ({ page }) => {
    // Spec 44.2 og lanseringsblokkering 51.13: share_to_signup må kunne måles.
    const lenke = page.getByRole('link', { name: 'Opprett din egen varslingsprofil' });
    await expect(lenke).toHaveAttribute('href', /utm_source=anbudsvarsling/);
    await expect(lenke).toHaveAttribute('href', /utm_medium=delt-visning/);
  });
});
