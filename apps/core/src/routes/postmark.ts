import { z } from 'zod';
import { handlePostmarkWebhook } from '../services/postmark-webhooks.js';
import { parseOrThrow, rateLimitError } from './errors.js';
import type { ApiInstance } from './types.js';
import type { ApiContext } from '../services/context.js';

/**
 * `/api/v1/postmark/webhooks/:stream` (spec §27, §39, §40, ADR-5).
 *
 * The one route in this API with no session and no CSRF header.
 * `CSRF_EXEMPT_PREFIXES` in `guards.ts` exempts this prefix, because Postmark
 * authenticates with HTTP basic credentials of its own and is not a browser —
 * requiring `x-luma-csrf` here would refuse every real delivery while
 * protecting nothing. The credentials are the access control, and they are
 * compared in constant time inside `@luma/email`.
 *
 * Everything else is in the service. This handler exists to translate a path
 * segment, a header and a body into a call, and a result into a status code.
 */

const streamParamsSchema = z.object({ stream: z.string().min(1).max(64) });

/**
 * A limit well above what Postmark produces, and well below what an attacker
 * would need to be interesting.
 *
 * The global limiter is 300 a minute, which a batch of delivery events after a
 * digest send would exceed — and a rate-limited webhook is a *lost* webhook,
 * because Postmark eventually stops retrying. Bounce data is not recoverable
 * afterwards. This is deliberately generous; the credential check is what
 * stands between the endpoint and the internet, not the limiter.
 */
const WEBHOOK_RATE_LIMIT = { max: 3000, timeWindow: '1 minute' } as const;

export function registerPostmarkRoutes(app: ApiInstance, ctx: ApiContext): void {
  app.post(
    '/postmark/webhooks/:stream',
    {
      config: {
        rateLimit: { ...WEBHOOK_RATE_LIMIT, errorResponseBuilder: rateLimitError },
      },
    },
    async (request, reply) => {
      const params = parseOrThrow(streamParamsSchema, request.params);

      const result = await handlePostmarkWebhook(ctx, {
        stream: params.stream,
        authorizationHeader: request.headers.authorization,
        body: request.body,
      });

      return reply.code(result.status).send(result.body);
    },
  );
}
