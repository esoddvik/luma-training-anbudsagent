import {
  clearedSessionCookieOptions,
  sessionCookieOptions,
  MAGIC_LINK_GENERIC_RESPONSE_NB,
  MAGIC_LINK_RATE_LIMIT,
  SESSION_COOKIE_NAME,
} from '@luma/auth';
import { z } from 'zod';
import { logout, logoutAllSessions, redeemLoginToken, requestMagicLink } from '../services/auth.js';
import { actorOf, clientIp, userAgentOf } from './guards.js';
import { parseOrThrow, rateLimitError } from './errors.js';
import type { ApiInstance } from './types.js';
import type { ApiContext } from '../services/context.js';

/**
 * `/api/v1/auth/*` (spec §10).
 *
 * The routes are thin on purpose. Every decision that matters — whether the
 * address exists, whether the link is still valid, how many links one address
 * may have — is in `services/auth.ts`, and the only thing done here that is
 * genuinely a transport concern is setting the cookie.
 */

export const requestLinkSchema = z.object({ email: z.string().min(3).max(320) });
export const redeemSchema = z.object({ token: z.string().min(20).max(200) });

export function registerAuthRoutes(app: ApiInstance, ctx: ApiContext): void {
  app.post(
    '/auth/request-link',
    {
      config: {
        // Per client address, on top of the per-email budget the service
        // enforces against the database (spec §10). Neither is sufficient
        // alone: this one does nothing against a botnet, and that one does
        // nothing against a single host walking an address list.
        rateLimit: {
          max: MAGIC_LINK_RATE_LIMIT.maxPerIpPerHour,
          timeWindow: '1 hour',
          errorResponseBuilder: rateLimitError,
        },
      },
    },
    async (request, reply) => {
      const body = parseOrThrow(requestLinkSchema, request.body);
      await requestMagicLink(ctx, {
        email: body.email,
        ...(clientIp(request) ? { ipAddress: clientIp(request) } : {}),
        ...(userAgentOf(request) ? { userAgent: userAgentOf(request) } : {}),
      });

      // 202 and the same sentence, always. The response says nothing about
      // whether the address is registered (§10).
      return reply.code(202).send({ message: MAGIC_LINK_GENERIC_RESPONSE_NB });
    },
  );

  app.post(
    '/auth/redeem',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 hour',
          errorResponseBuilder: rateLimitError,
        },
      },
    },
    async (request, reply) => {
      const body = parseOrThrow(redeemSchema, request.body);
      const session = await redeemLoginToken(ctx, {
        token: body.token,
        ...(clientIp(request) ? { ipAddress: clientIp(request) } : {}),
        ...(userAgentOf(request) ? { userAgent: userAgentOf(request) } : {}),
      });

      return reply
        .setCookie(
          SESSION_COOKIE_NAME,
          session.token,
          sessionCookieOptions({ isProduction: ctx.config.isProduction }),
        )
        .code(200)
        .send({
          user: {
            id: session.actor.userId,
            email: session.actor.email,
            role: session.actor.role,
          },
          expiresAt: session.expiresAt,
        });
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    const actor = actorOf(request);
    await logout(ctx, actor);
    return reply
      .clearCookie(
        SESSION_COOKIE_NAME,
        clearedSessionCookieOptions({ isProduction: ctx.config.isProduction }),
      )
      .code(200)
      .send({ message: 'Du er logget ut.' });
  });

  app.post('/auth/logout-all', async (request, reply) => {
    const actor = actorOf(request);
    const revoked = await logoutAllSessions(ctx, actor);
    return reply
      .clearCookie(
        SESSION_COOKIE_NAME,
        clearedSessionCookieOptions({ isProduction: ctx.config.isProduction }),
      )
      .code(200)
      .send({ message: 'Du er logget ut av alle enheter.', revokedSessions: revoked });
  });
}
