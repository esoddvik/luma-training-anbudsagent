import { z } from 'zod';
import {
  alertProfileInputSchema,
  createOrderInputSchema,
  sharedTenderViewSchema,
} from '@luma/domain';
import { rerunMatchingSchema, suppressTenderSchema } from '../services/admin.js';
import { updateCompanyInputSchema } from '../services/company.js';
import { recordConsentInputSchema } from '../services/consent.js';
import { acceptLegalInputSchema } from '../services/legal.js';
import { createMcpTokenInputSchema } from '../services/mcp-tokens.js';
import { updatePreferencesSchema } from '../services/notification-preferences.js';
import { adminOrderUpdateSchema } from '../services/orders.js';
import { paginationQuerySchema } from '../services/pagination.js';
import { createShareInputSchema } from '../services/sharing.js';
import { feedbackInputSchema, tenderListQuerySchema } from '../services/tenders.js';
import { redeemSchema, requestLinkSchema } from './auth.js';

/**
 * The OpenAPI 3.1 document (spec §39, "OpenAPI-dokumentasjon").
 *
 * Generated from the **same Zod schemas the handlers validate with**, via
 * `z.toJSONSchema`. That is the whole design: this document cannot describe a
 * request shape the API does not actually enforce, because there is only one
 * definition of each shape and both the validator and the schema section read
 * it.
 *
 * Two things it deliberately does *not* do.
 *
 * It does not use `@fastify/swagger`. That plugin reflects over Fastify's
 * per-route `schema` option, which this API does not use — validation happens
 * inside each handler through `parseOrThrow`, so a reflected document would
 * list every path with no shapes at all. Making it work would mean moving
 * validation into Fastify's pipeline ahead of the handlers, which changes the
 * error path: the machine-readable codes and Norwegian messages §39 requires
 * are produced by `errors.ts` and are tested. A documentation tool is not
 * worth trading a tested error contract for.
 *
 * It does not hand-maintain a path list. `buildOpenApiDocument` is handed the
 * *real* route table, collected from Fastify, and `openapi.test.ts` asserts in
 * both directions that the table and `OPERATIONS` describe the same set. A new
 * undocumented route fails the build; a documented path that no longer exists
 * fails it too.
 */

export const OPENAPI_VERSION = '3.1.0';

/** `z.date()` and `z.custom()` have no JSON Schema form; emit `{}` rather than throwing. */
const TO_JSON_SCHEMA = { unrepresentable: 'any' } as const;

/**
 * Request bodies are documented as the shape a *client sends*, responses as
 * the shape the server returns. The distinction is not cosmetic: `emailSchema`
 * trims and lowercases through a transform, so its output carries constraints
 * a caller is not required to satisfy.
 */
function toSchema(schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { ...TO_JSON_SCHEMA, io }) as Record<string, unknown>;
  // `$schema` is meaningful on a standalone document and noise inside an
  // OpenAPI `components.schemas` entry, which declares its dialect once.
  delete json.$schema;
  return json;
}

/** A request body, optionally relaxed to "any subset of these fields". */
function requestBodySchema(schema: z.ZodType, partial?: boolean): Record<string, unknown> {
  const json = toSchema(schema, 'input');
  if (partial) delete json.required;
  return json;
}

/** The error envelope every failure uses (`errors.ts`). */
const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().describe('Machine-readable, stable across releases.'),
    message: z.string().describe('Norwegian bokmål, safe to show a user.'),
  }),
});

/** Status codes shared by every authenticated route, produced by `errors.ts`. */
const AUTHENTICATED_ERRORS = [401, 403, 429] as const;

interface Operation {
  readonly summary: string;
  readonly tag: string;
  /** False only for the handful of routes that work without a session. */
  readonly authenticated?: boolean;
  readonly requestBody?: z.ZodType;
  /**
   * The body is any *subset* of `requestBody`'s fields.
   *
   * Modelled by dropping `required` rather than by `.partial()`, which Zod
   * refuses on a schema carrying a refinement — and `alertProfileInputSchema`
   * carries one (the value floor must not exceed the ceiling). Dropping
   * `required` is also the more accurate description: the handler merges the
   * patch over the stored profile and validates the *whole* result, so a
   * caller may omit any field but cannot violate the refinement.
   */
  readonly partialBody?: boolean;
  readonly query?: z.ZodType;
  /** Success status this route actually returns. Never invented. */
  readonly success: number;
  /** Response body for the success status, when it has one. */
  readonly response?: z.ZodType;
  /** Failure statuses beyond the shared authenticated set. */
  readonly errors?: readonly number[];
}

/**
 * The public projection of a shared tender.
 *
 * Built from `sharedTenderViewSchema` and nothing else. Spec §17 forbids the
 * shared view exposing who shared it or any profile value, and a document that
 * *named* such a field would leak the design intent even if the endpoint never
 * returned one. Deriving it from the domain schema means the published shape
 * and the returned shape cannot diverge.
 */
const sharedViewResponseSchema = z.object({
  tender: sharedTenderViewSchema,
  invitation: z.object({ heading: z.string(), body: z.string() }),
});

/**
 * Every operation, keyed by `METHOD /path` exactly as Fastify reports it.
 *
 * Summaries are English: this is a developer-facing artefact, and ADR-12's
 * Norwegian-only rule governs customer-facing surfaces. The `message` field of
 * every error response is Norwegian, and that is documented above.
 */
export const OPERATIONS: Readonly<Record<string, Operation>> = {
  'GET /api/v1/openapi.json': {
    summary: 'This document.',
    tag: 'meta',
    authenticated: false,
    success: 200,
  },

  'POST /api/v1/auth/request-link': {
    summary: 'Request a magic login link. The response never reveals whether the account exists.',
    tag: 'auth',
    authenticated: false,
    requestBody: requestLinkSchema,
    success: 202,
    errors: [400, 429],
  },
  'POST /api/v1/auth/redeem': {
    summary: 'Redeem a magic link and open a session. Single use.',
    tag: 'auth',
    authenticated: false,
    requestBody: redeemSchema,
    success: 200,
    errors: [400, 401, 429],
  },
  'POST /api/v1/auth/logout': { summary: 'End this session.', tag: 'auth', success: 200 },
  'POST /api/v1/auth/logout-all': {
    summary: 'End every session for this account.',
    tag: 'auth',
    success: 200,
  },

  'GET /api/v1/me': { summary: 'The signed-in account.', tag: 'account', success: 200 },

  'GET /api/v1/company': {
    summary: 'The caller’s company profile, or null.',
    tag: 'account',
    success: 200,
  },
  'PATCH /api/v1/company': {
    summary: 'Create or update the company profile.',
    tag: 'account',
    requestBody: updateCompanyInputSchema,
    success: 200,
    errors: [400, 409],
  },

  'GET /api/v1/alert-profiles': {
    summary: 'List the caller’s alert profiles.',
    tag: 'alert-profiles',
    query: paginationQuerySchema,
    success: 200,
  },
  'POST /api/v1/alert-profiles': {
    summary: 'Create an alert profile.',
    tag: 'alert-profiles',
    requestBody: alertProfileInputSchema,
    success: 201,
    errors: [400, 404],
  },
  'GET /api/v1/alert-profiles/:id': {
    summary: 'One alert profile.',
    tag: 'alert-profiles',
    success: 200,
    errors: [400, 404],
  },
  'PATCH /api/v1/alert-profiles/:id': {
    summary: 'Update an alert profile. The patch is validated against the whole merged profile.',
    tag: 'alert-profiles',
    requestBody: alertProfileInputSchema,
    partialBody: true,
    success: 200,
    errors: [400, 404],
  },
  'DELETE /api/v1/alert-profiles/:id': {
    summary: 'Soft-delete an alert profile.',
    tag: 'alert-profiles',
    success: 204,
    errors: [400, 404],
  },
  'POST /api/v1/alert-profiles/:id/preview': {
    summary: 'Preview matches, including unsaved edits. Writes nothing.',
    tag: 'alert-profiles',
    requestBody: alertProfileInputSchema,
    partialBody: true,
    success: 200,
    errors: [400, 404],
  },

  'GET /api/v1/service-templates': {
    summary: 'Editorial onboarding templates. Public; identical for everyone.',
    tag: 'alert-profiles',
    authenticated: false,
    success: 200,
  },

  'GET /api/v1/tenders': {
    summary: 'Tenders matched to the caller’s own profiles.',
    tag: 'tenders',
    query: paginationQuerySchema.and(tenderListQuerySchema),
    success: 200,
  },
  'GET /api/v1/tenders/:id': {
    summary: 'One matched tender with its stored explanation.',
    tag: 'tenders',
    success: 200,
    errors: [400, 404],
  },
  'POST /api/v1/tenders/:id/save': {
    summary: 'Mark a tender saved. Idempotent.',
    tag: 'tenders',
    success: 200,
    errors: [400, 404],
  },
  'POST /api/v1/tenders/:id/dismiss': {
    summary: 'Mark a tender dismissed. Idempotent.',
    tag: 'tenders',
    success: 200,
    errors: [400, 404],
  },
  'POST /api/v1/tenders/:id/feedback': {
    summary: 'Record relevance feedback. Never edits the profile.',
    tag: 'tenders',
    requestBody: feedbackInputSchema,
    success: 201,
    errors: [400, 404],
  },
  'POST /api/v1/tenders/:id/share': {
    summary: 'Create a share link. The URL is returned once and is not recoverable.',
    tag: 'sharing',
    requestBody: createShareInputSchema,
    success: 201,
    errors: [400, 404],
  },

  'GET /api/v1/shares': {
    summary: 'The caller’s share links. Never includes the token.',
    tag: 'sharing',
    query: paginationQuerySchema,
    success: 200,
  },
  'POST /api/v1/shares/:id/revoke': {
    summary: 'Revoke a share link. Idempotent.',
    tag: 'sharing',
    success: 200,
    errors: [400, 404],
  },
  'GET /api/v1/shared/:token': {
    summary:
      'The public shared view. Requires no session. Revoked, expired and unknown tokens all answer 410 with the same body, so the endpoint cannot be used to discover which tokens exist.',
    tag: 'sharing',
    authenticated: false,
    success: 200,
    response: sharedViewResponseSchema,
    errors: [400, 410, 429],
  },

  'GET /api/v1/mcp-tokens': {
    summary: 'The caller’s MCP tokens. Never includes the token value.',
    tag: 'mcp',
    query: paginationQuerySchema,
    success: 200,
  },
  'POST /api/v1/mcp-tokens': {
    summary: 'Create an MCP token. The value is returned exactly once.',
    tag: 'mcp',
    requestBody: createMcpTokenInputSchema,
    success: 201,
    errors: [400],
  },
  'POST /api/v1/mcp-tokens/:id/revoke': {
    summary: 'Revoke an MCP token. Idempotent.',
    tag: 'mcp',
    success: 200,
    errors: [400, 404],
  },

  'GET /api/v1/notification-preferences': {
    summary: 'Notification preferences and derived marketing-consent state.',
    tag: 'consent',
    success: 200,
  },
  'PATCH /api/v1/notification-preferences': {
    summary:
      'Update preferences. Marketing consent is appended to the consent log, not stored here; turning either switch off never affects the other.',
    tag: 'consent',
    requestBody: updatePreferencesSchema,
    success: 200,
    errors: [400],
  },
  'GET /api/v1/consents': {
    summary: 'The full consent event log and the state derived from it.',
    tag: 'consent',
    success: 200,
  },
  'POST /api/v1/consents': {
    summary: 'Append a consent event. Withdrawal is a new event; nothing is ever updated.',
    tag: 'consent',
    requestBody: recordConsentInputSchema,
    success: 201,
    errors: [400],
  },
  'GET /api/v1/legal-acceptances': {
    summary: 'Which legal document versions the caller has accepted, and what is outstanding.',
    tag: 'consent',
    success: 200,
  },
  'POST /api/v1/legal-acceptances': {
    summary: 'Accept a legal document version. Insert-only.',
    tag: 'consent',
    requestBody: acceptLegalInputSchema,
    success: 201,
    errors: [400],
  },

  'GET /api/v1/order-requests': {
    summary: 'The caller’s order requests.',
    tag: 'orders',
    query: paginationQuerySchema,
    success: 200,
  },
  'POST /api/v1/order-requests': {
    summary: 'Submit an order request. Invoice only; no card payment exists in this API.',
    tag: 'orders',
    requestBody: createOrderInputSchema,
    success: 201,
    errors: [400, 429],
  },
  'GET /api/v1/order-requests/:id': {
    summary: 'One order request.',
    tag: 'orders',
    success: 200,
    errors: [400, 404],
  },

  'POST /api/v1/postmark/webhooks/:stream': {
    summary:
      'Postmark delivery, bounce and complaint webhooks. Authenticated by HTTP Basic rather than a session, and exempt from the CSRF header requirement.',
    tag: 'webhooks',
    authenticated: false,
    success: 200,
    errors: [400, 401],
  },

  'GET /api/v1/admin/ingest-status': {
    summary: 'Ingest, queue and account figures for the admin dashboard.',
    tag: 'admin',
    success: 200,
  },
  'POST /api/v1/admin/ingest/run': {
    summary: 'Re-run Doffin ingest. Audited.',
    tag: 'admin',
    success: 200,
  },
  'POST /api/v1/admin/matching/run': {
    summary: 'Re-run matching. Audited.',
    tag: 'admin',
    requestBody: rerunMatchingSchema,
    success: 200,
    errors: [400],
  },
  'POST /api/v1/admin/tenders/:id/suppress': {
    summary: 'Suppress an invalid tender. A reason is mandatory. Audited.',
    tag: 'admin',
    requestBody: suppressTenderSchema,
    success: 200,
    errors: [400, 404, 409],
  },
  'GET /api/v1/admin/order-requests': {
    summary: 'Every order request, for the admin queue.',
    tag: 'admin',
    query: paginationQuerySchema,
    success: 200,
  },
  'PATCH /api/v1/admin/order-requests/:id': {
    summary: 'Move an order request. Illegal transitions are refused. Audited.',
    tag: 'admin',
    requestBody: adminOrderUpdateSchema,
    success: 200,
    errors: [400, 404, 409],
  },
  'GET /api/v1/admin/audit-events': {
    summary: 'The administrative audit log, newest first.',
    tag: 'admin',
    query: paginationQuerySchema,
    success: 200,
  },
};

/** A route as Fastify reports it. */
export interface RouteRef {
  readonly method: string;
  readonly url: string;
}

export function operationKey(route: RouteRef): string {
  return `${route.method} ${route.url}`;
}

const STATUS_TEXT: Readonly<Record<number, string>> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No content',
  400: 'Validation failed (`validation_error`) or a malformed cursor (`invalid_cursor`).',
  401: 'No valid session (`unauthenticated`), or a login link that cannot be redeemed.',
  403: 'Not the caller’s resource (`forbidden`), or a rejected cross-site write (`csrf_*`).',
  404: 'No such resource (`not_found`).',
  409: 'Conflicts with current state.',
  410: 'Gone (`share_unavailable`). Revoked, expired and unknown are indistinguishable.',
  429: 'Rate limited (`rate_limited`).',
};

/** Turns `/a/:id` into `/a/{id}` and lists the parameters OpenAPI needs. */
function toOpenApiPath(url: string): { path: string; params: string[] } {
  const params: string[] = [];
  const path = url.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    params.push(name);
    return `{${name}}`;
  });
  return { path, params };
}

export interface OpenApiDocument {
  openapi: string;
  info: Record<string, unknown>;
  servers: { url: string }[];
  tags: { name: string }[];
  components: Record<string, unknown>;
  paths: Record<string, Record<string, unknown>>;
}

/**
 * Builds the document from the route table Fastify actually registered.
 *
 * Routes with no `OPERATIONS` entry are included with a marker rather than
 * skipped: silently omitting them would let the document look complete while
 * the drift test is what fails, and the document is the artefact people read.
 */
export function buildOpenApiDocument(routes: readonly RouteRef[]): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  const tags = new Set<string>();

  for (const route of [...routes].sort((a, b) => operationKey(a).localeCompare(operationKey(b)))) {
    const operation = OPERATIONS[operationKey(route)];
    const { path, params } = toOpenApiPath(route.url);
    const method = route.method.toLowerCase();

    const responses: Record<string, unknown> = {};
    const statuses = [
      operation?.success ?? 200,
      ...(operation?.errors ?? []),
      ...(operation?.authenticated === false ? [] : AUTHENTICATED_ERRORS),
    ];

    for (const status of [...new Set(statuses)].sort((a, b) => a - b)) {
      const description = STATUS_TEXT[status] ?? 'See the error code.';
      const isError = status >= 400;
      const body =
        isError || operation?.response
          ? {
              content: {
                'application/json': {
                  schema: isError
                    ? { $ref: '#/components/schemas/Error' }
                    : toSchema(operation!.response!, 'output'),
                },
              },
            }
          : {};
      responses[String(status)] = { description, ...body };
    }

    if (operation) tags.add(operation.tag);

    paths[path] ??= {};
    paths[path][method] = {
      summary: operation?.summary ?? 'UNDOCUMENTED — see openapi.test.ts.',
      ...(operation ? { tags: [operation.tag] } : {}),
      ...(operation?.authenticated === false ? { security: [] } : {}),
      parameters: [
        ...params.map((name) => ({
          name,
          in: 'path' as const,
          required: true,
          schema: { type: 'string' },
        })),
        ...(operation?.query
          ? Object.entries(
              (toSchema(operation.query, 'input').properties ?? {}) as Record<string, unknown>,
            ).map(([name, schema]) => ({ name, in: 'query' as const, required: false, schema }))
          : []),
      ],
      ...(operation?.requestBody
        ? {
            requestBody: {
              required: !operation.partialBody,
              content: {
                'application/json': {
                  schema: requestBodySchema(operation.requestBody, operation.partialBody),
                },
              },
            },
          }
        : {}),
      responses,
    };
  }

  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: 'Luma Anbudsvarsling API',
      version: '1.0.0',
      description: [
        'The HTTP API behind Luma Anbudsvarsling (spec §39).',
        '',
        'Every error body is `{ error: { code, message } }`. `code` is stable and',
        'machine-readable; `message` is Norwegian bokmål and safe to show a user.',
        'Database errors are never exposed.',
        '',
        'Authentication is an opaque session cookie. Every state-changing request',
        'must also send the `x-luma-csrf` header and an `Origin` this API accepts.',
        'Lists are cursor-paginated with a capped `limit`.',
      ].join('\n'),
    },
    servers: [{ url: '/' }],
    tags: [...tags].sort().map((name) => ({ name })),
    components: {
      schemas: { Error: toSchema(errorResponseSchema, 'output') },
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'luma_session' },
      },
    },
    paths,
  };
}
