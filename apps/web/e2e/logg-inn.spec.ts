import { expect, test } from './support';

/**
 * Innlogging (spec seksjon 10).
 *
 * Hele denne filen kjører uten seedet data, og det er med hensikt: å be om en
 * innloggingslenke er det ene stedet der en person som ikke har noe fra før
 * skal komme videre. Testene sender derfor inn en adresse som garantert ikke
 * finnes, og sjekker at svaret ikke røper det.
 */

/** En adresse ingen seed kan ha opprettet. */
const UKJENT_ADRESSE = `ingen-konto-${Date.now()}@ukjent-virksomhet.example`;

test.describe('innloggingsskjemaet', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/logg-inn');
  });

  test('viser et skjema med ledetekst, e-postfelt og send-knapp', async ({ page }) => {
    const epost = page.getByLabel('E-postadresse');
    await expect(epost).toBeVisible();
    await expect(epost).toHaveAttribute('type', 'email');
    await expect(page.getByRole('button', { name: 'Send meg innloggingslenke' })).toBeVisible();
  });

  test('er på norsk bokmål', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('lang', 'nb');
    await expect(page.getByRole('heading', { level: 1, name: 'Logg inn' })).toBeVisible();
  });

  test('kan fylles ut og sendes med tastatur alene', async ({ page }) => {
    // Ingen mus. Skjemaet er den ene siden en bruker må komme gjennom uansett
    // hvordan de betjener maskinen sin.
    await page.getByLabel('E-postadresse').focus();
    await page.keyboard.type(UKJENT_ADRESSE);
    await page.keyboard.press('Enter');

    await expect(page.getByRole('status')).toBeVisible();
  });

  test('svarer generisk på en adresse uten konto', async ({ page }) => {
    // Spec 10: svaret skal ikke kunne brukes til å kartlegge hvem som er kunde.
    await page.getByLabel('E-postadresse').fill(UKJENT_ADRESSE);
    await page.getByRole('button', { name: 'Send meg innloggingslenke' }).click();

    const kvittering = page.getByRole('status');
    await expect(kvittering).toContainText('Hvis adressen er registrert hos oss');

    const tekst = await page.locator('main').innerText();
    expect(tekst).not.toContain('finnes ikke');
    expect(tekst).not.toContain('ukjent adresse');
  });

  test('kvitteringen leses opp av skjermleser uten å stjele fokus', async ({ page }) => {
    await page.getByLabel('E-postadresse').fill(UKJENT_ADRESSE);
    await page.getByRole('button', { name: 'Send meg innloggingslenke' }).click();

    // role="status" innebærer aria-live="polite": meldingen annonseres, men
    // fokus flyttes ikke. Uten dette ville bekreftelsen vært usynlig for en
    // som ikke ser skjermen.
    const kvittering = page.getByRole('status');
    await expect(kvittering).toHaveAttribute('aria-live', 'polite');
  });

  test('sender ikke adressen i adressefeltet', async ({ page }) => {
    // En POST, ikke en GET. En e-postadresse i en URL havner i serverlogger,
    // i nettleserhistorikk og i Referer-headeren til alt siden lenker til.
    await page.getByLabel('E-postadresse').fill(UKJENT_ADRESSE);
    await page.getByRole('button', { name: 'Send meg innloggingslenke' }).click();
    await expect(page.getByRole('status')).toBeVisible();

    expect(page.url()).not.toContain(UKJENT_ADRESSE);
    expect(page.url()).not.toContain('%40');
  });

  test('forteller hvor man registrerer seg, siden kvitteringen ikke kan si det', async ({
    page,
  }) => {
    await expect(page.getByRole('link', { name: 'Opprett varslingsprofil' })).toBeVisible();
  });
});

test.describe('bekreftelsessiden uten gyldig lenke', () => {
  test('viser en nøytral norsk feilmelding for et ugyldig token', async ({ page }) => {
    await page.goto(`/logg-inn/bekreft?token=${'z'.repeat(43)}`);

    await expect(
      page.getByRole('heading', { name: 'Innloggingen kunne ikke fullføres' }),
    ).toBeVisible();

    const tekst = await page.locator('main').innerText();
    expect(tekst).toContain('Be om en ny lenke');
    // Nøytral: siden sier ikke om tokenet aldri fantes, er brukt opp eller har
    // utløpt på en måte som kan bekrefte at en gjetning traff.
    expect(tekst).not.toContain('finnes ikke');
    await expect(page).not.toHaveURL(/\/oversikt/);
  });

  test('viser samme side når tokenet mangler helt', async ({ page }) => {
    await page.goto('/logg-inn/bekreft');

    await expect(
      page.getByRole('heading', { name: 'Innloggingen kunne ikke fullføres' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Be om ny innloggingslenke' })).toBeVisible();
  });

  test('er ikke indekserbar', async ({ page }) => {
    // URL-en bærer en levende legitimasjon. Den skal ikke havne i et søkeindeks.
    await page.goto(`/logg-inn/bekreft?token=${'z'.repeat(43)}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
});
