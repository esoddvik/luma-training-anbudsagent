import type { FastifyError } from 'fastify';
import type { z } from 'zod';
import { AuthenticationError, AuthorizationError } from '@luma/auth';

/**
 * The error vocabulary of the HTTP API (spec §39).
 *
 * Two requirements shape this file. Every failure must carry a
 * machine-readable code alongside a Norwegian message, and no database error
 * may ever reach a caller. Both are met the same way: services throw
 * `ApiError`, which is the only error type whose message is allowed out, and
 * everything else collapses to `internal_error` in the handler below.
 */

export interface ErrorPayload {
  readonly error: { readonly code: string; readonly message: string };
}

/** A failure a caller is allowed to see. Its message is customer-facing. */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const badRequest = (code: string, message: string) => new ApiError(code, 400, message);

export const notFound = (message = 'Ressursen finnes ikke.') =>
  new ApiError('not_found', 404, message);

export const conflict = (code: string, message: string) => new ApiError(code, 409, message);

export const tooManyRequests = (message: string) => new ApiError('rate_limited', 429, message);

/** The neutral 410 used by the shared view. Never a 404 (§40, ADR-0015). */
export const gone = (code: string, message: string) => new ApiError(code, 410, message);

/**
 * Turns a Zod failure into one Norwegian sentence naming the fields at fault.
 *
 * Zod's own messages are English and occasionally describe internals, so only
 * the *paths* are taken from the issue list. A caller learns which field it got
 * wrong without the API narrating its own schema.
 */
export function validationError(error: z.ZodError): ApiError {
  const fields = [
    ...new Set(
      error.issues.map((issue) => issue.path.map((part) => String(part)).join('.') || '(rot)'),
    ),
  ];
  const list = fields.slice(0, 8).join(', ');
  return new ApiError(
    'validation_error',
    400,
    fields.length > 0
      ? `Forespørselen mangler eller har ugyldige felt: ${list}.`
      : 'Forespørselen kunne ikke valideres.',
  );
}

/** Parses with Zod, or throws the Norwegian `validation_error`. */
export function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

/**
 * Fastify's own 4xx errors carry English text written for developers. The ones
 * a client can actually trigger are translated; anything else becomes a
 * generic Norwegian sentence rather than leaking framework internals.
 */
const FASTIFY_MESSAGES_NB: Readonly<Record<string, string>> = {
  FST_ERR_CTP_BODY_TOO_LARGE: 'Forespørselen er for stor.',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'Forespørselen mangler innhold.',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'Innholdstypen støttes ikke. Bruk application/json.',
  FST_ERR_CTP_INVALID_JSON_BODY: 'Ugyldig JSON i forespørselen.',
  FST_ERR_VALIDATION: 'Forespørselen kunne ikke valideres.',
};

export interface NormalizedError {
  readonly status: number;
  readonly payload: ErrorPayload;
  /** True when the underlying error should be logged at error level. */
  readonly internal: boolean;
}

/**
 * Maps any thrown value onto the wire format.
 *
 * The default branch is the important one: an unrecognised error is reported
 * as `internal_error` with a fixed Norwegian sentence, whatever it actually
 * said. A Drizzle failure carries the SQL statement in its message, so
 * forwarding `error.message` on the 500 path would publish the schema.
 */
export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof ApiError) {
    return {
      status: error.statusCode,
      payload: { error: { code: error.code, message: error.message } },
      internal: false,
    };
  }

  if (error instanceof AuthenticationError) {
    return {
      status: 401,
      payload: { error: { code: 'unauthenticated', message: error.message } },
      internal: false,
    };
  }

  if (error instanceof AuthorizationError) {
    return {
      status: 403,
      payload: { error: { code: 'forbidden', message: error.message } },
      internal: false,
    };
  }

  const fastifyError = error as Partial<FastifyError> | undefined;
  const status = fastifyError?.statusCode ?? 500;

  if (status < 500) {
    const code = fastifyError?.code;
    const message =
      (code ? FASTIFY_MESSAGES_NB[code] : undefined) ?? 'Forespørselen kunne ikke behandles.';
    return {
      status,
      payload: { error: { code: code ?? 'bad_request', message } },
      internal: false,
    };
  }

  return {
    status,
    payload: { error: { code: 'internal_error', message: 'Det oppsto en uventet feil.' } },
    internal: true,
  };
}

/**
 * The rejection every rate limiter returns (§39, §40).
 *
 * A function returning an `ApiError`, not a payload object, because
 * `@fastify/rate-limit` **throws** whatever `errorResponseBuilder` returns.
 * Returning a plain object there sends a non-Error down the error handler,
 * which then cannot read a status from it and reports a 500 — a limiter that
 * looks like a bug and, worse, gets logged as one.
 */
export const rateLimitError = (): ApiError =>
  new ApiError('rate_limited', 429, 'For mange forespørsler. Vent litt før du prøver igjen.');
