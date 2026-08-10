import { appPath, expect, test } from './support';

/**
 * The A3 results pages (IDE Agent Spec v3, section 3.2).
 *
 * ## Why so much of this runs with JavaScript switched off
 *
 * The filtering on these pages is a client component, and the whole point of
 * the arrangement is that it is an *enhancement*: the page is statically
 * prerendered, so every notice, every region link and a working signup form are
 * in the HTML before a single script runs. A suite that only ever drove a
 * hydrated page would pass just as happily if that stopped being true, which is
 * why the first block below turns JavaScript off and asserts the page still
 * does its job.
 *
 * ## The seeding guard
 *
 * These pages read live Doffin data. On a laptop with an empty database
 * `searchPublicTenders` correctly returns nothing, and an assertion about
 * result cards would then fail for a reason that has nothing to do with the
 * code. So the specs that need notices check the page's own count line first
 * and skip when it reads zero — the page's structural assertions (heading,
 * region links, signup form) still run everywhere, because those hold with or
 * without data.
 *
 * `bygg-og-anlegg-utforende` is the trade used throughout: it is the densest of
 * the eight templates in `qualifying-pages.ts` (187 own notices in Oslo og
 * Viken over 94 days) and it earned regional pages in all six landsdeler, so it
 * is the one most likely to have something to show in any environment that has
 * ingested at all.
 */

const TRADE = 'bygg-og-anlegg-utforende';
const TRADE_PATH = appPath(`/anbud-for/${TRADE}`);

/** The «12 kunngjøringer · Bransjemalen» line the explorer renders. */
const COUNT_LINE = /(\d+) kunngjøring(er)?/;

function resultCount(text: string): number {
  const match = COUNT_LINE.exec(text);
  return match ? Number(match[1]) : 0;
}

test.describe('anbud-for uten JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('viser overskrift, treffliste og attribusjon i selve HTML-en', async ({ page }) => {
    await page.goto(TRADE_PATH);

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Anbud for');

    const tekst = await page.locator('main').innerText();
    // CC BY 4.0 krever attribusjon på hver flate som videreformidler data.
    expect(tekst).toContain('Data: Doffin/DFØ (CC BY 4.0)');

    const antall = resultCount(tekst);
    test.skip(antall === 0, 'miljøet har ingen kunngjøringer for denne bransjen');

    // Hele settet ligger i markupen, ikke bare de første kortene.
    await expect(page.locator('main li.luma-card')).toHaveCount(antall);
  });

  test('viser begrunnelsene åpne, siden ingen kan klikke dem fram', async ({ page }) => {
    await page.goto(TRADE_PATH);
    const tekst = await page.locator('main').innerText();
    test.skip(resultCount(tekst) === 0, 'miljøet har ingen kunngjøringer');

    expect(tekst).toContain('Hvorfor traff dette?');
    expect(tekst).toContain(
      'Treffnivå er relevans mot bransjemalen, aldri sannsynlighet for å vinne.',
    );
  });

  test('rendrer ingen kontroller som ikke kan virke', async ({ page }) => {
    await page.goto(TRADE_PATH);
    // Søkefeltet og filterpanelet hører hydreringen til. Uten JavaScript skal de
    // være borte, ikke synlige og døde.
    await expect(page.getByLabel('Søk i tittel eller oppdragsgiver')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Avanserte filtre' })).toHaveCount(0);
  });

  test('landsdelvelgeren er ekte lenker', async ({ page }) => {
    await page.goto(TRADE_PATH);
    const lenke = page.getByRole('navigation', { name: 'Velg landsdel' }).getByRole('link', {
      name: 'Vestlandet',
    });
    await expect(lenke).toHaveAttribute('href', new RegExp(`${TRADE}/vestlandet$`));
    await lenke.click();
    await expect(page).toHaveURL(new RegExp(`${TRADE}/vestlandet$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Vestlandet');
  });

  test('registreringsskjemaet er et ekte skjema med de feltene handlingen leser', async ({
    page,
  }) => {
    await page.goto(TRADE_PATH);

    // Ingen avkryssingsboks: vilkårene godtas når lenken i e-posten åpnes, og
    // det er `confirmSignup` som skriver akseptraden med versjon og tidsstempel.
    await expect(page.getByLabel('E-postadresse')).toHaveAttribute('type', 'email');
    await expect(page.getByRole('button', { name: 'Opprett varslingsprofil' })).toBeVisible();

    // Bransjen reiser med skjemaet, ikke i URL-en — det er det som lar siden
    // være statisk. Verdien blir slått opp på nytt på serveren uansett.
    const skjema = page.locator('form:has(input[name="tjenestemal"])');
    await expect(skjema.locator('input[name="tjenestemal"]')).toHaveValue(TRADE);
  });

  /**
   * Selve innsendingen krever Postmark, og en maskin uten
   * `POSTMARK_SERVER_TOKEN` får en 500 fra handlingen i stedet for en
   * omdirigering. Testen hopper over i stedet for å feile, fordi et rødt
   * resultat da hadde handlet om miljøet og ikke om koden — men den hopper på
   * en variabel som CI faktisk setter, ikke på noe den leser ut av siden.
   */
  test('innsending havner på sjekk-e-post', async ({ page }) => {
    test.skip(
      !process.env['POSTMARK_SERVER_TOKEN'],
      'krever POSTMARK_SERVER_TOKEN for å kunne sende bekreftelseslenken',
    );

    await page.goto(TRADE_PATH);
    await page.getByLabel('E-postadresse').fill(`e2e+${Date.now()}@example.com`);
    await page.getByRole('button', { name: 'Opprett varslingsprofil' }).click();

    await expect(page).toHaveURL(/registrering\/sjekk-e-post/);
  });
});

test.describe('anbud-for med JavaScript', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TRADE_PATH);
  });

  test('åpner «Hvorfor traff dette?» og viser begrunnelsen', async ({ page }) => {
    const tekst = await page.locator('main').innerText();
    test.skip(resultCount(tekst) === 0, 'miljøet har ingen kunngjøringer');

    const knapp = page.getByRole('button', { name: 'Hvorfor traff dette?' }).first();
    await expect(knapp).toHaveAttribute('aria-expanded', 'false');

    const panelId = await knapp.getAttribute('aria-controls');
    const panel = page.locator(`#${panelId}`);
    await expect(panel).toBeHidden();

    await knapp.click();
    await expect(knapp).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toContainText('Kunngjøringen er merket');
    // Aldri en prosent eller en poengsum (spec 4.3) — bare ordet.
    await expect(panel).toContainText(/Sterk|Middels|Svak/);
    expect(await panel.innerText()).not.toMatch(/\d+\s*%/);
  });

  test('søkefeltet snevrer inn listen, og tilbakestilling gjenoppretter den', async ({ page }) => {
    const start = resultCount(await page.locator('main').innerText());
    test.skip(start < 2, 'trenger minst to kunngjøringer for å måle en innsnevring');

    const telling = page.getByText(COUNT_LINE).first();
    await expect(telling).toContainText('Bransjemalen');

    await page.getByLabel('Søk i tittel eller oppdragsgiver').fill('zzzzikkefinnes');
    await expect(telling).toContainText('0 kunngjøringer');
    await expect(telling).toContainText('1 filter aktivt');
    await expect(page.locator('main li.luma-card')).toHaveCount(0);

    await page.getByRole('button', { name: 'Avanserte filtre' }).click();
    await page.getByRole('button', { name: 'Tilbakestill til bransjemalen' }).first().click();

    await expect(telling).toContainText('Bransjemalen');
    await expect(page.locator('main li.luma-card')).toHaveCount(start);
  });

  test('landsdellenken navigerer til den regionale siden', async ({ page }) => {
    await page
      .getByRole('navigation', { name: 'Velg landsdel' })
      .getByRole('link', { name: 'Vestlandet' })
      .click();

    await expect(page).toHaveURL(new RegExp(`${TRADE}/vestlandet$`));
    // Den valgte landsdelen er markert for hjelpemidler, ikke bare visuelt.
    await expect(
      page.getByRole('navigation', { name: 'Velg landsdel' }).getByRole('link', {
        name: 'Vestlandet',
      }),
    ).toHaveAttribute('aria-current', 'page');
  });
});
