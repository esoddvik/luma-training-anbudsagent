import { z } from 'zod';
import { paginationQuerySchema } from '../services/pagination.js';
import {
  getTender,
  listTenders,
  setTenderState,
  submitFeedback,
  tenderListQuerySchema,
} from '../services/tenders.js';
import { createShare } from '../services/sharing.js';
import { actorOf } from './guards.js';
import { parseOrThrow } from './errors.js';
import type { ApiInstance } from './types.js';
import type { ApiContext } from '../services/context.js';

/**
 * `/api/v1/tenders/*` (spec §16, §15, §17).
 *
 * Saving and dismissing are POSTs rather than PATCHes on a state field,
 * matching the route list in spec §39. They are idempotent regardless: pressing
 * save twice is the same fact recorded once.
 */

const idParamsSchema = z.object({ id: z.uuid() });

export function registerTenderRoutes(app: ApiInstance, ctx: ApiContext): void {
  app.get('/tenders', async (request) => {
    const actor = actorOf(request);
    const query = parseOrThrow(paginationQuerySchema.and(tenderListQuerySchema), request.query);
    return listTenders(ctx, actor, query);
  });

  app.get('/tenders/:id', async (request) => {
    const actor = actorOf(request);
    const { id } = parseOrThrow(idParamsSchema, request.params);
    return getTender(ctx, actor, id);
  });

  app.post('/tenders/:id/save', async (request) => {
    const actor = actorOf(request);
    const { id } = parseOrThrow(idParamsSchema, request.params);
    return setTenderState(ctx, actor, id, 'saved');
  });

  app.post('/tenders/:id/dismiss', async (request) => {
    const actor = actorOf(request);
    const { id } = parseOrThrow(idParamsSchema, request.params);
    return setTenderState(ctx, actor, id, 'dismissed');
  });

  app.post('/tenders/:id/feedback', async (request, reply) => {
    const actor = actorOf(request);
    const { id } = parseOrThrow(idParamsSchema, request.params);
    const result = await submitFeedback(ctx, actor, id, request.body);
    return reply.code(201).send(result);
  });

  app.post('/tenders/:id/share', async (request, reply) => {
    const actor = actorOf(request);
    const { id } = parseOrThrow(idParamsSchema, request.params);
    const share = await createShare(ctx, actor, id, request.body);
    // The URL is in this response and nowhere else, ever again.
    return reply.code(201).send(share);
  });
}
