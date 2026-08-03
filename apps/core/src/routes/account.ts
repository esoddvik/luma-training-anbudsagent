import { z } from 'zod';
import { createMcpToken, listMcpTokens, revokeMcpToken } from '../services/mcp-tokens.js';
import { getConsentState, recordConsent } from '../services/consent.js';
import { acceptLegalDocument, getLegalStatus } from '../services/legal.js';
import { getPreferences, updatePreferences } from '../services/notification-preferences.js';
import { paginationQuerySchema } from '../services/pagination.js';
import { actorOf, clientIp, userAgentOf } from './guards.js';
import { parseOrThrow, rateLimitError } from './errors.js';
import type { ApiInstance } from './types.js';
import type { ApiContext } from '../services/context.js';

/**
 * The account surface: `/me`, `/mcp-tokens`, `/notification-preferences`,
 * `/consents` and `/legal-acceptances` (spec §22, §21, §30).
 */

const idParamsSchema = z.object({ id: z.uuid() });

export function registerAccountRoutes(app: ApiInstance, ctx: ApiContext): void {
  app.get('/me', async (request) => {
    const actor = actorOf(request);
    const [preferences, legal, consents] = await Promise.all([
      getPreferences(ctx, actor),
      getLegalStatus(ctx, actor),
      getConsentState(ctx, actor),
    ]);
    return {
      user: { id: actor.userId, email: actor.email, role: actor.role },
      preferences,
      legal,
      consents: consents.current,
    };
  });

  app.get('/mcp-tokens', async (request) => {
    const actor = actorOf(request);
    const query = parseOrThrow(paginationQuerySchema, request.query);
    return listMcpTokens(ctx, actor, query);
  });

  app.post(
    '/mcp-tokens',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 hour',
          errorResponseBuilder: rateLimitError,
        },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      const token = await createMcpToken(ctx, actor, request.body);
      return reply.code(201).send(token);
    },
  );

  app.post('/mcp-tokens/:id/revoke', async (request) => {
    const actor = actorOf(request);
    const { id } = parseOrThrow(idParamsSchema, request.params);
    return revokeMcpToken(ctx, actor, id);
  });

  app.get('/notification-preferences', async (request) => getPreferences(ctx, actorOf(request)));

  app.patch('/notification-preferences', async (request) => {
    const actor = actorOf(request);
    return updatePreferences(ctx, actor, {
      body: request.body,
      ...(clientIp(request) ? { ipAddress: clientIp(request) } : {}),
      ...(userAgentOf(request) ? { userAgent: userAgentOf(request) } : {}),
    });
  });

  app.get('/consents', async (request) => getConsentState(ctx, actorOf(request)));

  app.post('/consents', async (request, reply) => {
    const actor = actorOf(request);
    const event = await recordConsent(ctx, actor, {
      body: request.body,
      ...(clientIp(request) ? { ipAddress: clientIp(request) } : {}),
      ...(userAgentOf(request) ? { userAgent: userAgentOf(request) } : {}),
    });
    // 201: withdrawal creates a row too. There is no PATCH here and there
    // never will be — consent is append-only (ADR-0009).
    return reply.code(201).send(event);
  });

  app.get('/legal-acceptances', async (request) => ({
    items: await getLegalStatus(ctx, actorOf(request)),
  }));

  app.post('/legal-acceptances', async (request, reply) => {
    const actor = actorOf(request);
    const accepted = await acceptLegalDocument(ctx, actor, {
      body: request.body,
      ...(clientIp(request) ? { ipAddress: clientIp(request) } : {}),
    });
    return reply.code(201).send(accepted);
  });
}
