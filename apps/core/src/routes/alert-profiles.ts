import { z } from 'zod';
import {
  createAlertProfile,
  deleteAlertProfile,
  getAlertProfile,
  listAlertProfiles,
  previewAlertProfile,
  updateAlertProfile,
} from '../services/alert-profiles.js';
import { listServiceTemplates } from '../services/service-templates.js';
import { paginationQuerySchema } from '../services/pagination.js';
import { actorOf } from './guards.js';
import { parseOrThrow, rateLimitError } from './errors.js';
import type { ApiInstance } from './types.js';
import type { ApiContext } from '../services/context.js';

/**
 * `/api/v1/alert-profiles` and `/api/v1/service-templates` (spec §11).
 *
 * Ownership is not checked here. Every handler hands the actor to the service,
 * which is where `requireOwnership` runs (spec §39) — so a route added later
 * that forgets to filter still cannot read another user's profile.
 */

const idParamsSchema = z.object({ id: z.uuid() });

export function registerAlertProfileRoutes(app: ApiInstance, ctx: ApiContext): void {
  app.get('/alert-profiles', async (request) => {
    const actor = actorOf(request);
    const query = parseOrThrow(paginationQuerySchema, request.query);
    return listAlertProfiles(ctx, actor, query);
  });

  app.post('/alert-profiles', async (request, reply) => {
    const actor = actorOf(request);
    const profile = await createAlertProfile(ctx, actor, request.body);
    return reply.code(201).send(profile);
  });

  app.get('/alert-profiles/:id', async (request) => {
    const actor = actorOf(request);
    const { id } = parseOrThrow(idParamsSchema, request.params);
    return getAlertProfile(ctx, actor, id);
  });

  app.patch('/alert-profiles/:id', async (request) => {
    const actor = actorOf(request);
    const { id } = parseOrThrow(idParamsSchema, request.params);
    return updateAlertProfile(ctx, actor, id, request.body);
  });

  app.delete('/alert-profiles/:id', async (request, reply) => {
    const actor = actorOf(request);
    const { id } = parseOrThrow(idParamsSchema, request.params);
    await deleteAlertProfile(ctx, actor, id);
    return reply.code(204).send();
  });

  app.post(
    '/alert-profiles/:id/preview',
    {
      config: {
        // Preview scores hundreds of tenders per call. Cheaper than a digest,
        // far more expensive than a row read, so it gets its own budget.
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          errorResponseBuilder: rateLimitError,
        },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      const { id } = parseOrThrow(idParamsSchema, request.params);
      return previewAlertProfile(ctx, actor, id, request.body);
    },
  );

  // Public. Editorial onboarding content, identical for everyone, and needed
  // on the signup page before an account exists (spec §11.2).
  app.get('/service-templates', async () => ({ items: await listServiceTemplates(ctx) }));
}
