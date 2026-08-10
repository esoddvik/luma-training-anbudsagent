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

/**
 * The trade the expired-group tests use, and why it is not `TRADE`.
 *
 * Not because `TRADE` lacks expired notices — it has six. The reason is that
 * how many it has depends on how `searchPublicTenders` slices the corpus, and
 * that has changed twice while these tests were being written:
 *
 * | measured 2026-08-10 | bygg rows | expired | renhold rows | expired |
 * | --- | --- | --- | --- | --- |
 * | one population, cut by `publishedAt desc` | 37 | 0 | 13 | 2 |
 * | open/planned/expired, each with its own limit | 50 | 6 | 13 | 2 |
 *
 * Under the first shape the group was empty on the densest trades and these
 * tests skipped themselves — green having checked nothing, on the one group
 * whose whole point is that it starts out hidden. Under the second it is
 * populated everywhere. `renhold-og-facility-management` gave the same answer
 * under both, and it will keep doing so: its entire 90-day result set is 13
 * rows, so no limit on any population can cut it. That stability is the whole
 * reason it is the fixture — this suite should not go quiet again the next
 * time someone reshapes the query.
 *
 * `TRADE` is covered too, by «avsluttede konkurranser finnes også på den
 * tetteste bransjesiden» below. That is the assertion that would have been
 * permanently skipped under the first shape, so it is worth having as well as
 * the stable one — between them, one test proves the group renders where it is
 * hardest to render, and the other cannot stop proving it renders at all.
 *
 * The environment guard in each stays regardless: a laptop with an empty
 * database still has nothing to assert on.
 */
const EXPIRED_TRADE = 'renhold-og-facility-management';
const EXPIRED_TRADE_PATH = appPath(`/anbud-for/${EXPIRED_TRADE}`);

/**
 * The «26 åpne kunngjøringer · 5 planlagte · Bransjemalen» line (R4, R6).
 *
 * The number is the *open* count and no longer the total: expired competitions
 * moved into their own collapsed group and planned ones into theirs, so a
 * `li.luma-card` count taken over the whole page is larger than this and is
 * meant to be.
 */
const COUNT_LINE = /(\d+) åpne? kunngjøring(er)?/;

function resultCount(text: string): number {
  const match = COUNT_LINE.exec(text);
  return match ? Number(match[1]) : 0;
}

/** The main list only. Planned and expired notices live in sibling sections. */
const MAIN_LIST = 'section[aria-labelledby="apne-treff"] li.luma-card';

const MONTHS_NB = [
  'januar',
  'februar',
  'mars',
  'april',
  'mai',
  'juni',
  'juli',
  'august',
  'september',
  'oktober',
  'november',
  'desember',
];

/**
 * The deadline a card renders, as a timestamp, or `null` when it states none.
 *
 * Parsed out of the Norwegian text rather than read from a data attribute on
 * purpose: the assertion V3 and V4 are making is about what the *reader* sees,
 * and a hidden attribute could be right while the visible line was wrong.
 */
function deadlineFromCard(text: string): number | null {
  const match = /Frist\s+(\d{1,2})\.\s+([a-zæøå]+)\s+(\d{4})/i.exec(text);
  if (!match) return null;
  const month = MONTHS_NB.indexOf((match[2] ?? '').toLowerCase());
  if (month < 0) return null;
  return Date.UTC(Number(match[3]), month, Number(match[1]));
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

    // Hovedlisten er nøyaktig de åpne kunngjøringene tellelinjen lover.
    await expect(page.locator(MAIN_LIST)).toHaveCount(antall);

    // Og hele settet ligger fortsatt i markupen: de avsluttede og de planlagte
    // er egne seksjoner, ikke noe som er utelatt fra serverrenderingen.
    const alle = await page.locator('main li.luma-card').count();
    expect(alle).toBeGreaterThanOrEqual(antall);
  });

  test('avsluttede konkurranser ligger i markupen, åpne som gruppe uten JavaScript', async ({
    page,
  }) => {
    await page.goto(EXPIRED_TRADE_PATH);
    const gruppe = page.locator('section[aria-labelledby="avsluttede-treff"]');
    test.skip((await gruppe.count()) === 0, 'ingen utløpte kunngjøringer i dette miljøet');

    // Ingen sammenklapping uten JavaScript: en «+»-knapp som ikke kan trykkes
    // ville skjult dem for godt.
    await expect(
      gruppe.getByRole('heading', { name: /Avsluttede konkurranser \(\d+\)/ }),
    ).toBeVisible();
    await expect(gruppe).toContainText('Fristen har gått ut.');
    await expect(gruppe.locator('li.luma-card').first()).toBeVisible();
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
  // Bredt vindu, i begge prosjektene. Under 640px flytter filtrene seg inn i
  // bunnskuffen (R6), så «Avanserte filtre» finnes ikke der — uten dette ville
  // disse testene betydd to forskjellige ting i `desktop` og i `mobil`.
  test.use({ viewport: { width: 1280, height: 900 } });

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
    const alle = await page.locator('main li.luma-card').count();

    const telling = page.getByText(COUNT_LINE).first();
    await expect(telling).toContainText('Bransjemalen');

    await page.getByLabel('Søk i tittel eller oppdragsgiver').fill('zzzzikkefinnes');
    await expect(telling).toContainText('0 åpne kunngjøringer');
    await expect(telling).toContainText('1 endring fra malen');
    await expect(page.locator('main li.luma-card')).toHaveCount(0);

    await page.getByRole('button', { name: 'Avanserte filtre' }).click();
    await page.getByRole('button', { name: 'Tilbakestill til bransjemalen' }).first().click();

    await expect(telling).toContainText('Bransjemalen');
    await expect(page.locator('main li.luma-card')).toHaveCount(alle);
  });

  /**
   * V3 og V4 — det R4 og R5 faktisk lover leseren.
   *
   * Begge leses ut av teksten på kortene, ikke ut av et skjult attributt: det
   * er den synlige fristen som er påstanden, og et attributt kunne vært riktig
   * mens linjen over var feil.
   */
  test('V3: ingen kunngjøring i hovedlisten har frist før nå', async ({ page }) => {
    const kort = page.locator(MAIN_LIST);
    const antall = await kort.count();
    test.skip(antall === 0, 'miljøet har ingen åpne kunngjøringer');

    const iDag = Date.now() - 86_400_000; // ett døgn slingringsmonn for tidssoner
    for (const tekst of await kort.allInnerTexts()) {
      expect(tekst).not.toContain('Frist gikk ut');
      const frist = deadlineFromCard(tekst);
      if (frist !== null) expect(frist).toBeGreaterThanOrEqual(iDag);
    }
  });

  test('V4: fristene i hovedlisten stiger', async ({ page }) => {
    const kort = page.locator(MAIN_LIST);
    test.skip((await kort.count()) < 2, 'trenger minst to kort for å måle rekkefølge');

    const frister = (await kort.allInnerTexts())
      .map(deadlineFromCard)
      .filter((value): value is number => value !== null);

    expect([...frister].sort((a, b) => a - b)).toEqual(frister);
  });

  test('landsdekkende kunngjøringer ligger i hovedlisten, ikke i egen seksjon', async ({
    page,
  }) => {
    // R5. Den gamle «Gjelder hele landet»-seksjonen er borte; markøren står på
    // kortet, og kortet er sortert sammen med alle andre.
    await expect(page.locator('section[aria-labelledby="nasjonale-treff"]')).toHaveCount(0);

    const markerte = page.locator(MAIN_LIST, { hasText: 'Gjelder hele landet' });
    test.skip((await markerte.count()) === 0, 'ingen landsdekkende kunngjøringer her');
    await expect(markerte.first()).toBeVisible();
  });

  /** V6 — filtrene virker anonymt, uten navigasjon og uten innlogging. */
  test('V6: å fjerne en CPV-kode endrer tellingen, uten navigasjon og uten innlogging', async ({
    page,
  }) => {
    const før = resultCount(await page.locator('main').innerText());
    test.skip(før === 0, 'miljøet har ingen kunngjøringer');

    const url = page.url();
    await page.getByRole('button', { name: 'Avanserte filtre' }).click();

    const chips = page.getByRole('button', { name: /^Fjern «/ });
    const antallChips = await chips.count();
    test.skip(antallChips < 2, 'malen har for få CPV-koder til at én kan fjernes uten å tømme alt');

    await chips.first().click();
    await expect(chips).toHaveCount(antallChips - 1);

    const telling = page.getByText(COUNT_LINE).first();
    await expect(telling).toContainText('1 endring fra malen');
    expect(resultCount(await page.locator('main').innerText())).toBeLessThanOrEqual(før);

    // Ingen navigasjon: siden er statisk og filteret er en tilstand i nettleseren.
    expect(page.url()).toBe(url);
    // Ingen innlogging: ingenting har sendt leseren mot /logg-inn.
    await expect(page.locator('main')).not.toContainText('Logg inn for å');
  });

  /** V8 — ingen prosent, ingen måler, ingen tallverdi nær relevans. */
  test('V8: verken kortene eller filterpanelet viser en tallverdi for relevans', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Avanserte filtre' }).click();
    await page.getByRole('button', { name: '+ Finn CPV-kode' }).click();
    await page.getByLabel('Søk etter kategori').fill('vask av vinduer');

    const panel = page.locator('#avanserte-filtre-panel');
    const tekst = await panel.innerText();
    expect(tekst).toContain('Vinduspuss');
    // Rangeringen har en poengsum internt; den skal ikke ut på skjermen.
    expect(tekst).not.toMatch(/\d+\s*%/);
    expect(tekst).not.toMatch(/poeng|score|treffprosent/i);
    // Rangeringen har en vekt per treff internt. Ingen av radene i CPV-lista
    // viser noe tall utover selve koden, som er en identifikator og ikke et mål.
    // Avgrenset til treffradene med vilje: «Neste 30 dager» og «500 000+» står
    // ellers i samme panel, og de er filterverdier, ikke relevans.
    for (const rad of await page.locator('#avanserte-filtre-panel li button').allInnerTexts()) {
      for (const tall of rad.match(/\d[\d\s]*/g) ?? []) {
        expect(tall.replace(/\s/g, '')).toMatch(/^\d{8}$/);
      }
    }

    // Ingen måler noe sted på siden, uansett hvor godt den var ment.
    await expect(page.locator('meter, progress, [role="meter"], [role="progressbar"]')).toHaveCount(
      0,
    );
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

  /**
   * R4 på den tetteste bransjen — den ene siden gruppen aldri nådde.
   *
   * Under det gamle utvalget returnerte `bygg-og-anlegg-utforende` 37 rader og
   * 0 utløpte: kuttet gikk på kunngjøringsdato, og de utløpte er nettopp de
   * eldst kunngjorte. Denne testen ville vært evig hoppet over. Nå har siden 6,
   * og vakten under er bare et miljøhensyn.
   */
  test('avsluttede konkurranser finnes også på den tetteste bransjesiden', async ({ page }) => {
    await expect(page.getByLabel('Søk i tittel eller oppdragsgiver')).toBeVisible();

    const knapp = page.getByRole('button', { name: /Avsluttede konkurranser \(\d+\)/ });
    test.skip((await knapp.count()) === 0, 'ingen utløpte kunngjøringer i dette miljøet');

    await knapp.click();
    const panel = page.locator('#avsluttede-treff-panel');
    await expect(panel).toContainText('Frist gikk ut');

    // Og de ligger der de hører hjemme: ingen av dem i hovedlisten.
    for (const tekst of await page.locator(MAIN_LIST).allInnerTexts()) {
      expect(tekst).not.toContain('Frist gikk ut');
    }
  });

  test('avsluttede konkurranser er lukket som standard og kan åpnes', async ({ page }) => {
    // Ikke `TRADE`: se noten på `EXPIRED_TRADE` om hvorfor den tynne bransjen
    // er den som ikke kan skjule gruppen for testen uansett hva spørringen gjør.
    await page.goto(EXPIRED_TRADE_PATH);
    // Gruppen er en overskrift før hydrering og en knapp etter. Vent på
    // søkefeltet, som bare finnes når hydreringen er ferdig — ellers måler
    // testen serverrenderingen og hopper over seg selv på et kappløp.
    await expect(page.getByLabel('Søk i tittel eller oppdragsgiver')).toBeVisible();

    const knapp = page.getByRole('button', { name: /Avsluttede konkurranser \(\d+\)/ });
    test.skip((await knapp.count()) === 0, 'ingen utløpte kunngjøringer i dette miljøet');

    await expect(knapp).toHaveAttribute('aria-expanded', 'false');
    const panel = page.locator('#avsluttede-treff-panel');
    await expect(panel).toBeHidden();

    await knapp.click();
    await expect(panel).toContainText('Fristen har gått ut.');
    await expect(panel).toContainText('Frist gikk ut');
  });
});

test.describe('anbud-for på mobil', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('filtrene ligger i en bunnskuff, og fritekstsøket står fortsatt inline', async ({
    page,
  }) => {
    await page.goto(TRADE_PATH);

    // Fritekst er inline; alt annet er bak «Filtre».
    await expect(page.getByLabel('Søk i tittel eller oppdragsgiver')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Avanserte filtre' })).toHaveCount(0);

    const åpne = page.getByRole('button', { name: /^Filtre/ });
    await expect(åpne).toBeVisible();
    await åpne.click();

    const skuff = page.getByRole('dialog');
    await expect(skuff).toBeVisible();
    await expect(skuff.getByRole('heading', { name: /^Filtre/ })).toBeVisible();
    await expect(skuff.getByText('CPV-koder')).toBeVisible();

    // Bare ett fast element om gangen: skuffen er det eneste `position: fixed`
    // på siden mens den er åpen — påmeldingsbåndet er statisk under 900px.
    const faste = await page.evaluate(
      () =>
        [...document.querySelectorAll('body *')].filter(
          (element) => getComputedStyle(element).position === 'fixed',
        ).length,
    );
    expect(faste).toBe(1);

    await page.keyboard.press('Escape');
    await expect(skuff).toHaveCount(0);
  });

  test('knappen teller endringer fra malen', async ({ page }) => {
    await page.goto(TRADE_PATH);
    await expect(page.getByRole('button', { name: 'Filtre', exact: true })).toBeVisible();

    await page.getByLabel('Søk i tittel eller oppdragsgiver').fill('skole');
    await expect(page.getByRole('button', { name: 'Filtre (1)', exact: true })).toBeVisible();
  });
});
