import { z } from 'zod';
import { listShares, revokeShare, viewSharedTender } from '../services/sharing.js';
import { paginationQuerySchema } from '../services/pagination.js';
import { actorOf } from './guards.js';
import { parseOrThrow, rateLimitError } from './errors.js';
import type { ApiInstance } from './types.js';
import type { ApiContext } from '../services/context.js';

/**
 * `/api/v1/shares` (the owner's view) and `/api/v1/shared/:token` (the public
 * one). Spec §17, §40, ADR-0015.
 *
 * The two live in one file because the second is only safe if you can see the
 * first: everything the owner may read — who they shared with, how often it was
 * opened, which tender — is absent from the public projection.
 */

const idParamsSchema = z.object({ id: z.uuid() });
const tokenParamsSchema = z.object({ token: z.string().min(20).max(200) });

/**
 * The enumeration budget for the public route (spec §40).
 *
 * Tokens are 256 bits, so guessing one is not the threat; the threat is a
 * script trying enough of them to notice a timing or status difference. Thirty
 * a minute leaves a shared link perfectly usable — a person opens it once —
 * while making any systematic probe pointless.
 */
const SHARED_VIEW_RATE_LIMIT = { max: 30, timeWindow: '1 minute' } as const;

export function registerShareRoutes(app: ApiInstance, ctx: ApiContext): void {
  app.get('/shares', async (request) => {
    const actor = actorOf(request);
    const query = parseOrThrow(paginationQuerySchema, request.query);
    return listShares(ctx, actor, query);
  });

  app.post('/shares/:id/revoke', async (request) => {
    const actor = actorOf(request);
    const { id } = parseOrThrow(idParamsSchema, request.params);
    return revokeShare(ctx, actor, id);
  });

  app.get(
    '/shared/:token',
    {
      config: {
        rateLimit: {
          ...SHARED_VIEW_RATE_LIMIT,
          errorResponseBuilder: rateLimitError,
        },
      },
    },
    async (request, reply) => {
      const { token } = parseOrThrow(tokenParamsSchema, request.params);
      const view = await viewSharedTender(ctx, token);

      // A shared tender is for one recipient, not for a search index
      // (spec §17: delingslenker skal ikke indekseres).
      return reply
        .header('X-Robots-Tag', 'noindex, nofollow')
        .header('Cache-Control', 'no-store')
        .send(view);
    },
  );
}
