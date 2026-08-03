import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError } from 'fastify';
import {
  buildHealthReport,
  newCorrelationId,
  readinessHttpStatus,
  runReadinessChecks,
  withCorrelationId,
  type DependencyCheck,
  type Logger,
} from '@luma/observability';

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

  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Ressursen finnes ikke.' } }),
  );

  // Spec section 39: machine-readable error codes, and never expose a database
  // error to a caller.
  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled request error');
      return reply.code(status).send({
        error: { code: 'internal_error', message: 'Det oppsto en uventet feil.' },
      });
    }
    return reply.code(status).send({
      error: { code: error.code ?? 'bad_request', message: error.message },
    });
  });

  return app;
}
