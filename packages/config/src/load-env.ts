import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads the repository-root `.env` into `process.env` for local development.
 *
 * Import this module for side effects *before* anything reads configuration.
 * ES module imports are hoisted, so a module that reads `process.env` at import
 * time will observe an empty value if the loading happens in a sibling import
 * rather than earlier in the graph. Every service entrypoint therefore imports
 * this first, and configuration is read lazily behind a function.
 *
 * In production the platform (Vercel, Railway) injects the environment, so no
 * file is read and a missing `.env` is not an error.
 */
export function loadDotEnv(): void {
  if (process.env.NODE_ENV === 'production') return;

  const here = dirname(fileURLToPath(import.meta.url));
  // packages/config/dist -> packages/config -> packages -> repo root
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(here, '../../../.env'),
    resolve(here, '../../../../.env'),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      process.loadEnvFile(candidate);
      return;
    } catch {
      // A malformed .env should not crash a service that has its environment
      // injected by the platform; validation downstream reports what is missing.
      return;
    }
  }
}
