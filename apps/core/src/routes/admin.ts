import { z } from 'zod';
import { orderStatusSchema } from '@luma/domain';
import {
  getIngestStatus,
  rerunIngest,
  rerunMatching,
  runBackfillForAdmin,
  suppressTender,
} from '../services/admin.js';
import { listAuditEvents } from '../services/audit.js';
import { handleOrderRequest, listAllOrderRequests } from '../services/orders.js';
import { paginationQuerySchema } from '../services/pagination.js';
import { actorOf } from './guards.js';
import { parseOrThrow, rateLimitError } from './errors.js';
import type { ApiInstance } from './types.js';
import type { ApiContext } from '../services/context.js';

/**
 * `/api/v1/admin/*` (spec §45).
 *
 * No `requireAdmin` appears in this file. Every handler delegates to a service
 * whose first statement is the role check, which keeps the rule in one place
 * and means a non-admin gets the same 403 whether they arrive over HTTP or
 * from a script that imports the service directly.
 */

const idParamsSchema = z.object({ id: z.uuid() });

export function registerAdminRoutes(app: ApiInstance, ctx: ApiContext): void {
  app.get('/admin/ingest-status', async (request) => getIngestStatus(ctx, actorOf(request)));

  app.post(
    '/admin/ingest/run',
    {
      config: {
        // A manual ingest hits the Doffin API hard. One a minute is generous
        // for a human and useless for a loop.
        rateLimit: {
          max: 1,
          timeWindow: '1 minute',
          errorResponseBuilder: rateLimitError,
        },
      },
    },
    async (request) => rerunIngest(ctx, actorOf(request)),
  );

  /*
   * One per five minutes, far tighter than the others, because this one is
   * long. It walks a fortnight window at a time against Doffin and returns
   * when it is done, so two overlapping runs would double the request rate
   * against the source for no benefit — the second would find everything the
   * first had already written.
   */
  app.post(
    '/admin/ingestion/backfill',
    {
      config: {
        rateLimit: {
          max: 1,
          timeWindow: '5 minutes',
          errorResponseBuilder: rateLimitError,
        },
      },
    },
    async (request) => runBackfillForAdmin(ctx, actorOf(request), request.body),
  );

  app.post(
    '/admin/matching/run',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          errorResponseBuilder: rateLimitError,
        },
      },
    },
    async (request) => rerunMatching(ctx, actorOf(request), request.body),
  );

  app.post('/admin/tenders/:id/suppress', async (request) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    return suppressTender(ctx, actorOf(request), id, request.body);
  });

  app.get('/admin/order-requests', async (request) => {
    const query = parseOrThrow(
      paginationQuerySchema.and(z.object({ status: orderStatusSchema.optional() })),
      request.query,
    );
    return listAllOrderRequests(ctx, actorOf(request), query);
  });

  app.patch('/admin/order-requests/:id', async (request) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    return handleOrderRequest(ctx, actorOf(request), id, request.body);
  });

  app.get('/admin/audit-events', async (request) => {
    const query = parseOrThrow(
      paginationQuerySchema.and(z.object({ action: z.string().max(120).optional() })),
      request.query,
    );
    return listAuditEvents(ctx, actorOf(request), query);
  });
}
