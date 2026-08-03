import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import type { Logger } from '@luma/observability';
import type { Actor } from '../services/context.js';

/**
 * The Fastify instance type used throughout the route layer.
 *
 * `server.ts` builds Fastify with a concrete pino instance, which narrows the
 * logger generic; the bare `FastifyInstance` alias then no longer matches it
 * and every route registrar would fail to typecheck. Naming the narrowed type
 * once here is cheaper than threading generics through a dozen files.
 */
export type ApiInstance = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  Logger
>;

/**
 * The authenticated caller, resolved once per request from the session cookie
 * and read by the routes that need one.
 *
 * Authentication is a request concern and lives here. Authorisation — who may
 * see or change which row — is not, and lives in the service layer where spec
 * §39 puts it.
 */
declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor;
  }
}
