/**
 * Log redaction. Spec section 47 forbids logging MCP tokens, magic links,
 * share tokens in cleartext, full user prompts and unnecessary personal data;
 * spec section 40 additionally requires email addresses to be redacted.
 *
 * Two mechanisms are needed. `redactPaths` handles structured fields, which
 * pino removes cheaply. `scrubSecrets` handles the harder case of a credential
 * that ends up inside a message string or an error thrown by a library.
 */

export const REDACTED = '[redacted]';

/** Structured log keys pino removes before serialising. */
export const redactPaths: readonly string[] = [
  'token',
  'tokens',
  'accessToken',
  'mcpToken',
  'shareToken',
  'magicLink',
  'magicLinkToken',
  'sessionToken',
  'password',
  'secret',
  'apiKey',
  'subscriptionKey',
  'authorization',
  'cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["ocp-apim-subscription-key"]',
  'res.headers["set-cookie"]',
  '*.token',
  '*.password',
  '*.secret',
  '*.authorization',
];

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/**
 * Ordered so that more specific patterns run first. Each entry replaces only
 * the credential, keeping the surrounding text readable for debugging.
 */
const SECRET_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // Authorization headers and bearer tokens.
  { pattern: /\b(Bearer|Basic)\s+[\w\-._~+/]{8,}=*/gi, replacement: `$1 ${REDACTED}` },
  // Query-string credentials: ?token=..., &key=..., ?secret=...
  {
    pattern: /\b(token|key|secret|password|pepper|signature|sig)=[\w\-._~+/]{8,}=*/gi,
    replacement: `$1=${REDACTED}`,
  },
  // Share links: /delt/<token> and /shared/<token>.
  { pattern: /\/(delt|shared)\/[\w\-._~]{16,}/gi, replacement: `/$1/${REDACTED}` },
  // Magic-link confirmation paths.
  { pattern: /\/(bekreft|verify|callback)\/[\w\-._~]{16,}/gi, replacement: `/$1/${REDACTED}` },
  // Our own token prefixes, wherever they appear.
  { pattern: /\blum_(live|test)_[\w-]{8,}/gi, replacement: REDACTED },
  // Postgres connection strings with inline credentials.
  { pattern: /\b(postgres(?:ql)?:\/\/)[^:\s]+:[^@\s]+@/gi, replacement: `$1${REDACTED}@` },
];

/**
 * Masks an email address to a first initial plus its domain, so that delivery
 * problems remain diagnosable without storing the address in logs.
 */
export function maskEmail(value: string | undefined): string {
  if (!value) return REDACTED;
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return REDACTED;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!domain.includes('.')) return REDACTED;
  const head = local.length > 1 ? local[0] : '';
  return `${head}***@${domain}`;
}

/**
 * Removes credentials and personal data from a free-text string.
 *
 * Applied to log messages and to error messages coming from libraries we do
 * not control, where a token can appear inside an exception rather than in a
 * structured field.
 */
export function scrubSecrets(input: string): string {
  let output = input;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output.replace(EMAIL_PATTERN, (match) => maskEmail(match));
}
