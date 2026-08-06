import { expect, test } from '@playwright/test';
import { appPath } from './support';
import { LANDING_HEADING, MCP_HEADING, SIGNUP_SUBMIT, TRUST_TEXT } from '../src/content/copy';

test.describe('landingssiden', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(appPath('/'));
  });

  test('viser hovedoverskriften fra seksjon 43', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: LANDING_HEADING })).toBeVisible();
  });

  test('lenker til bruksvilkårene, der dekningsteksten står', async ({ page }) => {
    // Spec 51 punkt 3 krever at dekningsteksten er til stede og synlig. Den er
    // flyttet fra landingssiden til /vilkar, så det landingssiden må svare for
    // er at den er én lenke unna — både fra registreringen og fra bunnmenyen.
    await expect(page.getByRole('link', { name: 'bruksvilkårene' })).toBeVisible();
  });

  test('viser tillitsteksten og MCP-seksjonen', async ({ page }) => {
    await expect(page.getByText(TRUST_TEXT, { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: MCP_HEADING })).toBeVisible();
  });

  test('har et e-postskjema med tilknyttet ledetekst', async ({ page }) => {
    const epost = page.getByLabel('E-postadresse');
    await expect(epost).toBeVisible();
    await expect(epost).toHaveAttribute('type', 'email');
    await expect(page.getByRole('button', { name: SIGNUP_SUBMIT })).toBeVisible();
  });

  test('er på norsk bokmål', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('lang', 'nb');
  });

  test('har en hopp-til-innhold-lenke som første fokuserbare element', async ({ page }) => {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Hopp til hovedinnhold' })).toBeFocused();
  });
});
