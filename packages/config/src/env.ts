import { z } from 'zod';

/**
 * Environment validation for the three deployed services.
 *
 * Every parser is a pure function of a record so it can be tested without
 * mutating `process.env`. Spec section 48 lists the variables; the Doffin
 * credential is `DOFFIN_SUBSCRIPTION_KEY` (Azure APIM subscription-key style)
 * rather than the spec's generic `DOFFIN_API_KEY`.
 */

export type EnvSource = Record<string, string | undefined>;

/** Minimum length for any value used as cryptographic key material. */
const SECRET_MIN_LENGTH = 32;

/**
 * Splits a comma-separated environment value into trimmed, non-empty parts.
 * Exported because several call sites parse operator-supplied lists.
 */
export function csvList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const secret = (name: string) =>
  z.string().min(SECRET_MIN_LENGTH, `${name} must be at least ${SECRET_MIN_LENGTH} characters`);

const postgresUrl = z
  .string()
  .refine(
    (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
    'must be a postgres:// or postgresql:// connection string',
  );

const httpUrl = z.url();

const emailList = z
  .string()
  .optional()
  .transform((raw) => csvList(raw).map((entry) => entry.toLowerCase()))
  .refine(
    (entries) => entries.every((entry) => z.email().safeParse(entry).success),
    'must be a comma-separated list of email addresses',
  );

const stringList = z
  .string()
  .optional()
  .transform((raw) => csvList(raw));

/** Present in every service. */
const baseShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: postgresUrl,
  APP_URL: httpUrl,
  LUMA_PRIVACY_POLICY_URL: httpUrl,
  TENDER_SERVICE_TERMS_URL: httpUrl,
  SENTRY_DSN: z.string().optional(),
  ANALYTICS_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
};

/** Anything that reads or writes a user session. */
const authShape = {
  AUTH_SECRET: secret('AUTH_SECRET'),
  AUTH_EMAIL_FROM: z.email(),
  ADMIN_EMAIL_ALLOWLIST: emailList,
};

/** Anything that renders or validates a share link. */
const sharingShape = {
  SHARE_TOKEN_SECRET: secret('SHARE_TOKEN_SECRET'),
  SHARE_DEFAULT_TTL_DAYS: z.coerce.number().int().positive().default(30),
};

/** Legal and consent text versions, recorded on every acceptance event. */
const legalShape = {
  CURRENT_PRIVACY_POLICY_VERSION: z.string().min(1),
  CURRENT_TERMS_VERSION: z.string().min(1),
  CURRENT_MARKETING_CONSENT_TEXT_VERSION: z.string().min(1),
};

/**
 * The sender identity printed in every email footer.
 *
 * Spec section 25 requires sender and contact information there, and Norwegian
 * marketing law expects a physical address. Section 48 lists no variable for
 * it, so the address lived as a constant in a service module — configuration
 * in a source file, which an operator has no way of discovering is theirs to
 * change. These three keys are that constant, made visible.
 *
 * `SENDER_CONTACT_EMAIL` is separate from `AUTH_EMAIL_FROM` on purpose: the
 * from-address is a verified Postmark sender signature and is usually a
 * no-reply, while this is the address a recipient can actually write to.
 */
const senderShape = {
  SENDER_NAME: z.string().trim().min(1).default('Luma Training'),
  SENDER_POSTAL_ADDRESS: z.string().trim().min(1),
  SENDER_CONTACT_EMAIL: z.email(),
};

const postmarkShape = {
  POSTMARK_SERVER_TOKEN: z.string().min(1),
  POSTMARK_ACCOUNT_TOKEN: z.string().optional(),
  POSTMARK_TRANSACTIONAL_STREAM: z.string().min(1).default('transactional'),
  POSTMARK_TENDER_NOTIFICATION_STREAM: z.string().min(1).default('tender-notifications'),
  POSTMARK_MARKETING_STREAM: z.string().min(1).default('luma-marketing'),
  POSTMARK_WEBHOOK_USERNAME: z.string().min(1),
  POSTMARK_WEBHOOK_PASSWORD: z.string().min(1),
};

const coreSchema = z.object({
  ...baseShape,
  ...authShape,
  ...sharingShape,
  ...legalShape,
  ...senderShape,
  ...postmarkShape,
  API_URL: httpUrl,
  MCP_URL: httpUrl,

  DOFFIN_API_BASE_URL: httpUrl.default('https://api.doffin.no'),
  DOFFIN_SUBSCRIPTION_KEY: z.string().min(1),

  MCP_TOKEN_PEPPER: secret('MCP_TOKEN_PEPPER'),
  CRON_SECRET: secret('CRON_SECRET'),

  // Spec 28: manual invoicing is the only implemented provider. Adding a value
  // here must be accompanied by an implementation, so the enum stays narrow.
  BILLING_PROVIDER: z.enum(['manual']).default('manual'),
  BILLING_ADMIN_EMAIL: z.email(),
  DEFAULT_VAT_PERCENT: z.coerce.number().int().min(0).max(100).default(25),

  // Spec 23.2: editorial routing for the Oslo-only full-day course.
  OSLO_REGION_CODES: stringList,

  /**
   * Whether this instance runs the pg-boss worker (spec 38, ADR-8).
   *
   * Defaults to on, because the normal deployment is one `core` process that
   * serves HTTP and works the queue (ADR-1). Setting it to `false` yields an
   * instance that still enqueues, reads queue state and answers readiness, but
   * attaches no handlers and runs no cron — which is what makes it safe to
   * scale the API horizontally without every replica competing for the same
   * ingest run.
   *
   * Parsed as a flag rather than with `z.coerce.boolean()`, which returns true
   * for the string `'false'` and would silently do the opposite of what the
   * operator wrote.
   */
  WORKER_ENABLED: z
    .string()
    .optional()
    .transform((raw) => !['0', 'false', 'no', 'off'].includes((raw ?? '').trim().toLowerCase())),
});

const webSchema = z.object({
  ...baseShape,
  ...authShape,
  ...sharingShape,
  ...legalShape,
  ...senderShape,
  API_URL: httpUrl,
  MCP_URL: httpUrl,
  POSTMARK_SERVER_TOKEN: z.string().min(1),
  POSTMARK_TRANSACTIONAL_STREAM: z.string().min(1).default('transactional'),
  OSLO_REGION_CODES: stringList,
});

const mcpSchema = z.object({
  ...baseShape,
  MCP_URL: httpUrl,
  MCP_TOKEN_PEPPER: secret('MCP_TOKEN_PEPPER'),
  /**
   * Extra hosts the MCP endpoint answers on, beyond `MCP_URL` (spec §40's
   * host allowlist). Not in §48; see `docs/spec-deviations.md`. Optional
   * because `MCP_URL` alone is correct for a single-domain deployment — this
   * exists for the domains a platform adds without being asked, such as
   * Railway's generated `*.up.railway.app` alongside a custom one.
   */
  MCP_ALLOWED_HOSTS: stringList,
});

export type CoreEnv = z.infer<typeof coreSchema>;
export type WebEnv = z.infer<typeof webSchema>;
export type McpEnv = z.infer<typeof mcpSchema>;

/**
 * Formats validation issues as `KEY: reason` lines.
 *
 * Deliberately reports only the path and the rule that failed. Environment
 * values are secrets; echoing the received value into an error message would
 * put connection strings and tokens into logs and crash reports (spec 47).
 */
function formatIssues(issues: readonly z.core.$ZodIssue[]): string {
  const lines = issues.map((issue) => {
    const key = issue.path.join('.') || '(root)';
    return `  ${key}: ${issue.message}`;
  });
  return `Invalid environment configuration:\n${lines.join('\n')}`;
}

function parseWith<T extends z.ZodType>(schema: T, source: EnvSource): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(formatIssues(result.error.issues));
  }
  return result.data;
}

export function parseCoreEnv(source: EnvSource): CoreEnv {
  return parseWith(coreSchema, source);
}

export function parseWebEnv(source: EnvSource): WebEnv {
  return parseWith(webSchema, source);
}

export function parseMcpEnv(source: EnvSource): McpEnv {
  return parseWith(mcpSchema, source);
}
