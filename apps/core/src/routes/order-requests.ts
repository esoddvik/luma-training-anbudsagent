import { z } from 'zod';
import { INVOICE_COPY_NB } from '@luma/domain';
import { createOrderRequest, getOrderRequest, listOwnOrderRequests } from '../services/orders.js';
import { paginationQuerySchema } from '../services/pagination.js';
import { actorOf } from './guards.js';
import { parseOrThrow, rateLimitError } from './errors.js';
import type { ApiInstance } from './types.js';
import type { ApiContext } from '../services/context.js';

/**
 * `/api/v1/order-requests` (spec §28.2).
 *
 * Rate limited well below the global default, as spec §39 requires. Submitting
 * an order sends two emails and puts a human in the loop, so this is the one
 * customer-facing endpoint where an abusive caller costs Luma attention rather
 * than only CPU.
 */

const idParamsSchema = z.object({ id: z.uuid() });

export function registerOrderRequestRoutes(app: ApiInstance, ctx: ApiContext): void {
  app.get('/order-requests', async (request) => {
    const actor = actorOf(request);
    const query = parseOrThrow(paginationQuerySchema, request.query);
    return listOwnOrderRequests(ctx, actor, query);
  });

  app.post(
    '/order-requests',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 hour',
          errorResponseBuilder: rateLimitError,
        },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      const order = await createOrderRequest(ctx, actor, request.body);
      // The approved Norwegian invoice copy travels with the response so the
      // web app does not restate it and drift (spec §28.2).
      return reply.code(201).send({ order, copy: INVOICE_COPY_NB });
    },
  );

  app.get('/order-requests/:id', async (request) => {
    const actor = actorOf(request);
    const { id } = parseOrThrow(idParamsSchema, request.params);
    return getOrderRequest(ctx, actor, id);
  });
}
