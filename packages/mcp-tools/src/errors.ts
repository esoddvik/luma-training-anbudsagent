import type { z } from 'zod';

/**
 * Errors a tool may return, and the Norwegian wording that goes with them.
 *
 * Everything a model on the other side of the connection reads is Norwegian
 * (spec section 6). The codes stay English because they are machine-facing.
 *
 * `not_found` is deliberately the answer for "this resource belongs to another
 * user" as well as for "this resource does not exist". Distinguishing the two
 * would turn `get_alert_profile` into an id oracle (ADR-0003, cross-user
 * isolation test).
 */

export const TOOL_ERROR_CODES = [
  'invalid_input',
  'forbidden',
  'not_found',
  'conflict',
  'internal_error',
] as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    /** Norwegian, safe to show to a model and to the user behind it. */
    message: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export function notFound(message: string): ToolError {
  return new ToolError('not_found', message);
}

export function invalidInput(message: string): ToolError {
  return new ToolError('invalid_input', message);
}

/**
 * Renders a Zod failure as one Norwegian sentence naming the offending fields.
 *
 * Field-level messages are written in Norwegian at the schema, so the common
 * cases read naturally. Zod's own fallback text can still surface for a raw
 * type mismatch; the envelope keeps the response Norwegian either way, and the
 * field path is what a model actually needs in order to retry correctly.
 */
export function formatZodErrorNb(error: z.ZodError): string {
  const parts = error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
  return `Ugyldige parametre: ${parts.join('; ')}.`;
}

/** The message used when a handler throws something unexpected. */
export const INTERNAL_ERROR_NB =
  'Det oppsto en uventet feil i tjenesten. Ingen data ble endret. Prøv igjen, og meld fra hvis feilen gjentar seg.';
