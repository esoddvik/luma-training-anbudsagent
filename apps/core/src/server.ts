import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import {
  buildHealthReport,
  newCorrelationId,
  readinessHttpStatus,
  runReadinessChecks,
  withCorrelationId,
  type DependencyCheck,
  type Logger,
} from '@luma/observability';
import { normalizeError, rateLimitError } from './routes/errors.js';
import { registerApiRoutes } from './routes/index.js';
import type { ApiContext } from './services/context.js';

/**
 * The core HTTP server.
 *
 * `core` runs the API, the pg-boss worker and the scheduled jobs in one Node
 * process (ADR-1). This module owns only the HTTP surface; the worker is
 * started alongside it from `main.ts`.
 */

export interface BuildServerOptions {
  logger: Logger;
  /** Probed by `/ready`. Empty until the database package is wired in. */
  readinessChecks?: readonly DependencyCheck[];
  /** Browser origins allowed to call the API. The web app is the only one. */
  allowedOrigins: readonly string[];
  /** Trusted when running behind Railway's proxy so rate limits see real IPs. */
  trustProxy?: boolean;
  /**
   * Everything the `/api/v1` surface needs. Omitted, the server serves only
   * `/health` and `/ready`, which is what the container health check and the
   * existing server tests exercise.
   */
  api?: ApiContext;
}

const CORRELATION_HEADER = 'x-correlation-id';

/**
 * The return type is inferred rather than annotated as `FastifyInstance`:
 * passing a concrete pino instance narrows Fastify's logger generic, and the
 * default `FastifyInstance` alias no longer matches it.
 */
export async function buildServer(options: BuildServerOptions) {
  const app = Fastify({
    loggerInstance: options.logger,
    trustProxy: options.trustProxy ?? true,
    // Spec section 39 requires request size limits.
    bodyLimit: 1_048_576,
    genReqId: (request) => {
      const supplied = request.headers[CORRELATION_HEADER];
      return typeof supplied === 'string' && supplied.length > 0 ? supplied : newCorrelationId();
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // The API serves JSON; the web app sets its own CSP.
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
  });

  await app.register(cors, {
    origin: [...options.allowedOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  await app.register(cookie);

  // Spec section 39: rate limiting, with tighter per-route limits applied where
  // enumeration is a risk (/shared/:token and /order-requests).
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // The default body is English prose written for developers. Every response
    // this API produces is Norwegian with a machine-readable code (§39, ADR-12).
    errorResponseBuilder: rateLimitError,
  });

  // Every request runs inside a correlation-id scope so that logs emitted deep
  // in a service call can be tied back to the request without threading a
  // logger through every function signature.
  app.addHook('onRequest', (request, reply, done) => {
    reply.header(CORRELATION_HEADER, String(request.id));
    withCorrelationId(String(request.id), done);
  });

  const startedAt = Date.now();

  // Liveness: deliberately free of dependencies, so a slow database can never
  // make the platform restart a healthy process.
  app.get('/health', async () => buildHealthReport('core', (Date.now() - startedAt) / 1000));

  app.get('/ready', async (_request, reply) => {
    const report = await runReadinessChecks('core', options.readinessChecks ?? []);
    return reply.code(readinessHttpStatus(report)).send(report);
  });

  // Both handlers are installed *before* the API plugin is registered, and the
  // ordering is load bearing rather than stylistic. `await app.register(...)`
  // boots Fastify, and a child context inherits the error handler that exists
  // at the moment it is created. Registering the plugin first would leave every
  // `/api/v1` failure answering with Fastify's default English body while the
  // status code looked correct — a difference no status assertion would catch.
  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Ressursen finnes ikke.' } }),
  );

  // Spec section 39: machine-readable error codes, and never expose a database
  // error to a caller. `normalizeError` owns that mapping; the only thing left
  // here is deciding what to log.
  app.setErrorHandler(async (error: unknown, request, reply) => {
    const { status, payload, internal } = normalizeError(error);
    if (internal) {
      request.log.error({ err: error }, 'unhandled request error');
    }
    return reply.code(status).send(payload);
  });

  if (options.api) {
    await registerApiRoutes(app, {
      ctx: options.api,
      allowedOrigins: options.allowedOrigins,
    });
  }

  return app;
}
