import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['PORT'] ?? 3000);
const externalBaseUrl = process.env['PLAYWRIGHT_BASE_URL'];
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${PORT}`;
const isCi = process.env['CI'] === 'true' || process.env['CI'] === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  workers: isCi ? 1 : undefined,
  reporter: isCi ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    locale: 'nb-NO',
    timezoneId: 'Europe/Oslo',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome']! } },
    // Section 16 requires the interface to be mobile friendly, so the smoke
    // test runs on a phone viewport too.
    { name: 'mobil', use: { ...devices['Pixel 7']! } },
  ],
  // When PLAYWRIGHT_BASE_URL is set we test an already-running deployment.
  ...(externalBaseUrl === undefined
    ? {
        webServer: {
          command: 'pnpm run build && pnpm run start',
          url: baseURL,
          reuseExistingServer: !isCi,
          timeout: 180_000,
        },
      }
    : {}),
});
