import { describe, expect, it } from 'vitest';
import { parseCoreEnv, parseMcpEnv, parseWebEnv, csvList } from './env.js';

/**
 * A complete, valid environment for the core service. Individual tests clone
 * this and remove or corrupt exactly one key, so a failure names the key.
 */
const validCore: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/luma',
  APP_URL: 'https://luma-training.com/anbudsvarsling',
  API_URL: 'https://api.luma-training.com',
  MCP_URL: 'https://mcp.luma-training.com',
  AUTH_SECRET: 'x'.repeat(32),
  AUTH_EMAIL_FROM: 'ikke-svar@luma-training.com',
  DOFFIN_API_BASE_URL: 'https://api.doffin.no',
  DOFFIN_SUBSCRIPTION_KEY: 'fake-subscription-key',
  POSTMARK_SERVER_TOKEN: 'fake-server-token',
  POSTMARK_TRANSACTIONAL_STREAM: 'transactional',
  POSTMARK_TENDER_NOTIFICATION_STREAM: 'tender-notifications',
  POSTMARK_MARKETING_STREAM: 'luma-marketing',
  POSTMARK_WEBHOOK_USERNAME: 'hook',
  POSTMARK_WEBHOOK_PASSWORD: 'hook-password',
  MCP_TOKEN_PEPPER: 'y'.repeat(32),
  SHARE_TOKEN_SECRET: 'z'.repeat(32),
  LUMA_PRIVACY_POLICY_URL: 'https://luma-training.com/personvern',
  TENDER_SERVICE_TERMS_URL: 'https://luma-training.com/anbudsvarsling/vilkar',
  CURRENT_PRIVACY_POLICY_VERSION: '2026-01-01',
  CURRENT_TERMS_VERSION: '1.0',
  CURRENT_MARKETING_CONSENT_TEXT_VERSION: '1.0',
  BILLING_ADMIN_EMAIL: 'faktura@luma-training.com',
  CRON_SECRET: 'w'.repeat(32),
  SENDER_POSTAL_ADDRESS: 'Luma Training AS, Storgata 1, 0155 Oslo',
  SENDER_CONTACT_EMAIL: 'post@luma-training.com',
};

/** The browser-facing subset, which also renders transactional email. */
const validWeb: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: validCore.DATABASE_URL as string,
  APP_URL: validCore.APP_URL as string,
  API_URL: validCore.API_URL as string,
  MCP_URL: validCore.MCP_URL as string,
  AUTH_SECRET: validCore.AUTH_SECRET as string,
  AUTH_EMAIL_FROM: validCore.AUTH_EMAIL_FROM as string,
  SHARE_TOKEN_SECRET: validCore.SHARE_TOKEN_SECRET as string,
  LUMA_PRIVACY_POLICY_URL: validCore.LUMA_PRIVACY_POLICY_URL as string,
  TENDER_SERVICE_TERMS_URL: validCore.TENDER_SERVICE_TERMS_URL as string,
  CURRENT_PRIVACY_POLICY_VERSION: '2026-01-01',
  CURRENT_TERMS_VERSION: '1.0',
  CURRENT_MARKETING_CONSENT_TEXT_VERSION: '1.0',
  POSTMARK_SERVER_TOKEN: validCore.POSTMARK_SERVER_TOKEN as string,
  POSTMARK_TRANSACTIONAL_STREAM: 'transactional',
  SENDER_POSTAL_ADDRESS: validCore.SENDER_POSTAL_ADDRESS as string,
  SENDER_CONTACT_EMAIL: validCore.SENDER_CONTACT_EMAIL as string,
};

function webEnvWithout(key: string): Record<string, string | undefined> {
  const clone: Record<string, string | undefined> = { ...validWeb };
  delete clone[key];
  return clone;
}

function coreEnvWithout(key: string): Record<string, string | undefined> {
  const clone: Record<string, string | undefined> = { ...validCore };
  delete clone[key];
  return clone;
}

describe('csvList', () => {
  it('splits a comma-separated string and trims whitespace', () => {
    expect(csvList('NO03, NO02 ,NO01')).toEqual(['NO03', 'NO02', 'NO01']);
  });

  it('drops empty segments rather than producing empty strings', () => {
    expect(csvList('a,,b,')).toEqual(['a', 'b']);
  });

  it('returns an empty array for undefined or blank input', () => {
    expect(csvList(undefined)).toEqual([]);
    expect(csvList('   ')).toEqual([]);
  });
});

describe('parseCoreEnv', () => {
  it('accepts a complete environment', () => {
    const env = parseCoreEnv(validCore);
    expect(env.DATABASE_URL).toBe(validCore.DATABASE_URL);
    expect(env.DOFFIN_SUBSCRIPTION_KEY).toBe('fake-subscription-key');
  });

  it.each([
    'DATABASE_URL',
    'AUTH_SECRET',
    'DOFFIN_SUBSCRIPTION_KEY',
    'POSTMARK_SERVER_TOKEN',
    'SHARE_TOKEN_SECRET',
    'CRON_SECRET',
    'LUMA_PRIVACY_POLICY_URL',
    'TENDER_SERVICE_TERMS_URL',
    // Spec 25: the footer's physical sender address and reply address. An
    // email that ships without them is not merely incomplete, it is
    // non-compliant, so neither may be optional or defaulted.
    'SENDER_POSTAL_ADDRESS',
    'SENDER_CONTACT_EMAIL',
  ])('rejects an environment missing %s', (key) => {
    expect(() => parseCoreEnv(coreEnvWithout(key))).toThrowError(new RegExp(key));
  });

  it('rejects secrets shorter than 32 characters', () => {
    expect(() => parseCoreEnv({ ...validCore, AUTH_SECRET: 'too-short' })).toThrowError(
      /AUTH_SECRET/,
    );
  });

  it('rejects a DATABASE_URL that is not a postgres connection string', () => {
    expect(() =>
      parseCoreEnv({ ...validCore, DATABASE_URL: 'mysql://localhost/luma' }),
    ).toThrowError(/DATABASE_URL/);
  });

  it('rejects a non-URL privacy policy link', () => {
    expect(() => parseCoreEnv({ ...validCore, LUMA_PRIVACY_POLICY_URL: 'not-a-url' })).toThrowError(
      /LUMA_PRIVACY_POLICY_URL/,
    );
  });

  it('defaults the share link lifetime to 30 days (spec 17)', () => {
    expect(parseCoreEnv(validCore).SHARE_DEFAULT_TTL_DAYS).toBe(30);
  });

  it('coerces a numeric share lifetime from its string form', () => {
    expect(parseCoreEnv({ ...validCore, SHARE_DEFAULT_TTL_DAYS: '7' }).SHARE_DEFAULT_TTL_DAYS).toBe(
      7,
    );
  });

  it('rejects a share lifetime that is zero or negative', () => {
    expect(() => parseCoreEnv({ ...validCore, SHARE_DEFAULT_TTL_DAYS: '0' })).toThrowError(
      /SHARE_DEFAULT_TTL_DAYS/,
    );
  });

  it('defaults the VAT rate to the Norwegian standard rate', () => {
    expect(parseCoreEnv(validCore).DEFAULT_VAT_PERCENT).toBe(25);
  });

  it('defaults the billing provider to manual invoicing (spec 28)', () => {
    expect(parseCoreEnv(validCore).BILLING_PROVIDER).toBe('manual');
  });

  it('rejects a billing provider that is not yet implemented', () => {
    expect(() => parseCoreEnv({ ...validCore, BILLING_PROVIDER: 'stripe' })).toThrowError(
      /BILLING_PROVIDER/,
    );
  });

  it('parses the Oslo region codes into a list for editorial routing (spec 23.2)', () => {
    const env = parseCoreEnv({ ...validCore, OSLO_REGION_CODES: 'NO081,NO082' });
    expect(env.OSLO_REGION_CODES).toEqual(['NO081', 'NO082']);
  });

  it('parses the admin allowlist into a list of lowercased addresses', () => {
    const env = parseCoreEnv({
      ...validCore,
      ADMIN_EMAIL_ALLOWLIST: 'Espen@luma-training.com, admin@luma-training.com',
    });
    expect(env.ADMIN_EMAIL_ALLOWLIST).toEqual([
      'espen@luma-training.com',
      'admin@luma-training.com',
    ]);
  });

  it('rejects a non-email entry in the admin allowlist', () => {
    expect(() =>
      parseCoreEnv({ ...validCore, ADMIN_EMAIL_ALLOWLIST: 'not-an-email' }),
    ).toThrowError(/ADMIN_EMAIL_ALLOWLIST/);
  });

  it('reads the sender identity used in every email footer (spec 25)', () => {
    const env = parseCoreEnv(validCore);
    expect(env.SENDER_POSTAL_ADDRESS).toBe('Luma Training AS, Storgata 1, 0155 Oslo');
    expect(env.SENDER_CONTACT_EMAIL).toBe('post@luma-training.com');
  });

  it('defaults the sender name to the company name', () => {
    expect(parseCoreEnv(validCore).SENDER_NAME).toBe('Luma Training');
  });

  it('lets an operator override the sender name', () => {
    expect(parseCoreEnv({ ...validCore, SENDER_NAME: 'Luma Training AS' }).SENDER_NAME).toBe(
      'Luma Training AS',
    );
  });

  it('rejects a postal address that is blank or only whitespace', () => {
    // `.min(1)` alone would accept a single space, which renders as a footer
    // with no address at all and passes every other check in the pipeline.
    expect(() => parseCoreEnv({ ...validCore, SENDER_POSTAL_ADDRESS: '' })).toThrowError(
      /SENDER_POSTAL_ADDRESS/,
    );
    expect(() => parseCoreEnv({ ...validCore, SENDER_POSTAL_ADDRESS: '   ' })).toThrowError(
      /SENDER_POSTAL_ADDRESS/,
    );
  });

  it('rejects a contact address that is not an email address', () => {
    expect(() =>
      parseCoreEnv({ ...validCore, SENDER_CONTACT_EMAIL: 'post(at)luma-training.com' }),
    ).toThrowError(/SENDER_CONTACT_EMAIL/);
  });

  it('never echoes the rejected contact address back in the error message', () => {
    let message = '';
    try {
      parseCoreEnv({ ...validCore, SENDER_CONTACT_EMAIL: 'ola.nordmann(at)privat.example' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/SENDER_CONTACT_EMAIL/);
    expect(message).not.toContain('ola.nordmann');
    expect(message).not.toContain('privat.example');
  });

  it('treats optional observability keys as genuinely optional', () => {
    const env = parseCoreEnv(validCore);
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.ANALYTICS_KEY).toBeUndefined();
  });

  it('reports every invalid key at once rather than only the first', () => {
    let message = '';
    try {
      parseCoreEnv({ ...validCore, AUTH_SECRET: 'short', DATABASE_URL: 'nope' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/AUTH_SECRET/);
    expect(message).toMatch(/DATABASE_URL/);
  });

  it('never includes a secret value in the validation error message', () => {
    let message = '';
    try {
      parseCoreEnv({ ...validCore, DATABASE_URL: 'mysql://user:hunter2@host/db' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('hunter2');
  });
});

describe('parseWebEnv', () => {
  it('accepts the browser-facing subset without server secrets', () => {
    const env = parseWebEnv(validWeb);
    expect(env.APP_URL).toBe(validCore.APP_URL);
  });

  it('does not require the Doffin subscription key, which only core uses', () => {
    expect(parseWebEnv(validWeb)).not.toHaveProperty('DOFFIN_SUBSCRIPTION_KEY');
  });

  it.each(['SENDER_POSTAL_ADDRESS', 'SENDER_CONTACT_EMAIL'])(
    'requires %s, because the web app renders footers too',
    (key) => {
      expect(() => parseWebEnv(webEnvWithout(key))).toThrowError(new RegExp(key));
    },
  );

  it('reads the same sender identity as core', () => {
    const env = parseWebEnv(validWeb);
    expect(env.SENDER_NAME).toBe('Luma Training');
    expect(env.SENDER_POSTAL_ADDRESS).toBe(validCore.SENDER_POSTAL_ADDRESS);
    expect(env.SENDER_CONTACT_EMAIL).toBe(validCore.SENDER_CONTACT_EMAIL);
  });

  it('rejects an invalid sender contact address without echoing it', () => {
    let message = '';
    try {
      parseWebEnv({ ...validWeb, SENDER_CONTACT_EMAIL: 'kari.hansen kontakt.example' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/SENDER_CONTACT_EMAIL/);
    expect(message).not.toContain('kari.hansen');
  });
});

describe('parseMcpEnv', () => {
  it('requires the token pepper used to hash MCP tokens (spec 30)', () => {
    expect(() =>
      parseMcpEnv({
        NODE_ENV: 'test',
        DATABASE_URL: validCore.DATABASE_URL,
        APP_URL: validCore.APP_URL,
        MCP_URL: validCore.MCP_URL,
        LUMA_PRIVACY_POLICY_URL: validCore.LUMA_PRIVACY_POLICY_URL,
        TENDER_SERVICE_TERMS_URL: validCore.TENDER_SERVICE_TERMS_URL,
      }),
    ).toThrowError(/MCP_TOKEN_PEPPER/);
  });

  it('accepts a complete MCP environment', () => {
    const env = parseMcpEnv({
      NODE_ENV: 'test',
      DATABASE_URL: validCore.DATABASE_URL,
      APP_URL: validCore.APP_URL,
      MCP_URL: validCore.MCP_URL,
      MCP_TOKEN_PEPPER: validCore.MCP_TOKEN_PEPPER,
      LUMA_PRIVACY_POLICY_URL: validCore.LUMA_PRIVACY_POLICY_URL,
      TENDER_SERVICE_TERMS_URL: validCore.TENDER_SERVICE_TERMS_URL,
    });
    expect(env.MCP_TOKEN_PEPPER).toBe(validCore.MCP_TOKEN_PEPPER);
  });

  it('does not require Postmark credentials, which the MCP server never uses', () => {
    const env = parseMcpEnv({
      NODE_ENV: 'test',
      DATABASE_URL: validCore.DATABASE_URL,
      APP_URL: validCore.APP_URL,
      MCP_URL: validCore.MCP_URL,
      MCP_TOKEN_PEPPER: validCore.MCP_TOKEN_PEPPER,
      LUMA_PRIVACY_POLICY_URL: validCore.LUMA_PRIVACY_POLICY_URL,
      TENDER_SERVICE_TERMS_URL: validCore.TENDER_SERVICE_TERMS_URL,
    });
    expect(env).not.toHaveProperty('POSTMARK_SERVER_TOKEN');
  });
});
