import { SESSION_COOKIE_NAME } from '@luma/auth';
import { resolveActor } from '../services/auth.js';
import { registerAccountRoutes } from './account.js';
import { registerAdminRoutes } from './admin.js';
import { registerAlertProfileRoutes } from './alert-profiles.js';
import { registerAuthRoutes } from './auth.js';
import { registerCompanyRoutes } from './company.js';
import { registerOrderRequestRoutes } from './order-requests.js';
import { registerPostmarkRoutes } from './postmark.js';
import { registerShareRoutes } from './shares.js';
import { registerTenderRoutes } from './tenders.js';
import { checkCsrf } from './guards.js';
import type { ApiInstance } from './types.js';
import type { ApiContext } from '../services/context.js';
import './types.js';

/**
 * The whole HTTP API, mounted under `/api/v1` (spec §39).
 *
 * Registered as one encapsulated Fastify plugin so the two request hooks below
 * apply to every API route and to nothing else: `/health` and `/ready` must
 * stay free of a database read, and a health probe that had to resolve a
 * session would defeat the point of having one.
 */

export const API_PREFIX = '/api/v1';

export interface ApiRoutesOptions {
  readonly ctx: ApiContext;
  /** The origins CORS accepts. Reused for the CSRF origin check. */
  readonly allowedOrigins: readonly string[];
}

export async function registerApiRoutes(
  app: ApiInstance,
  options: ApiRoutesOptions,
): Promise<void> {
  const { ctx, allowedOrigins } = options;

  await app.register(
    async (api: ApiInstance) => {
      // Cross-site write protection. Runs before anything reads the session,
      // so a rejected request never touches the database. See `guards.ts` for
      // why the check is a custom header *and* an origin comparison.
      api.addHook('onRequest', async (request) => {
        checkCsrf(request, allowedOrigins);
      });

      // Authentication only. The actor may be undefined here; routes that
      // need one call `actorOf`, and authorisation happens in the services.
      api.addHook('preHandler', async (request) => {
        const cookie = request.cookies[SESSION_COOKIE_NAME];
        const actor = await resolveActor(ctx, cookie);
        if (actor) request.actor = actor;
      });

      registerAuthRoutes(api, ctx);
      registerAccountRoutes(api, ctx);
      registerCompanyRoutes(api, ctx);
      registerAlertProfileRoutes(api, ctx);
      registerTenderRoutes(api, ctx);
      registerShareRoutes(api, ctx);
      registerOrderRequestRoutes(api, ctx);
      // No session, no CSRF header: Postmark carries its own credentials
      // (§27). The exemption is in `guards.ts`; this is the route it exists for.
      registerPostmarkRoutes(api, ctx);
      registerAdminRoutes(api, ctx);
    },
    { prefix: API_PREFIX },
  );
}
