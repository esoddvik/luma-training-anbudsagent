import { createHash } from 'node:crypto';
import { headers } from 'next/headers';

/**
 * Who the caller appears to be, in the only two forms this app records.
 *
 * Extracted because there are now two entry doors — logging in and signing up —
 * and both need the same two facts, hashed the same way, against the same
 * pepper. Before this file, `clientAddress` lived in `login-actions.ts` and
 * `hashIpAddress` lived in `login.ts`, and the registration path would have
 * needed both. Two copies of a rate-limit identity function is not a style
 * problem: if they ever disagreed, the per-IP budget would silently become two
 * separate budgets and the limit would be twice what it claims to be.
 *
 * `apps/core` has its own `hashIpAddress` in `services/email-context.ts` and it
 * computes the same digest from the same pepper, deliberately. That one is not
 * merged into this file because this module imports `next/headers`, which is
 * not available in the Fastify runtime. The parity is asserted by a test rather
 * than by a shared import.
 */

/**
 * A stable, non-reversible identifier for a client address.
 *
 * Spec section 40 requires data minimisation, so no table stores an address.
 * The pepper is `AUTH_SECRET`: the same address therefore hashes differently in
 * every environment, and a database dump cannot be joined back against a
 * visitor log or against a dump from another environment.
 */
export function hashIpAddress(ip: string | undefined, pepper: string): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`${pepper}:${ip}`, 'utf8').digest('hex');
}

export interface ClientIdentity {
  readonly ip?: string;
  readonly userAgent?: string;
}

/**
 * The client address, as far as the platform will say.
 *
 * `x-forwarded-for` is a client-settable header everywhere except behind a
 * proxy that overwrites it, which Vercel does. It is used for a rate-limit
 * budget and nothing else, and it is hashed before it is stored, so a forged
 * value costs the forger their own budget rather than anyone else's.
 */
export async function clientIdentity(): Promise<ClientIdentity> {
  const list = await headers();
  const forwarded = list.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || list.get('x-real-ip')?.trim() || undefined;
  const userAgent = list.get('user-agent') ?? undefined;
  return { ...(ip ? { ip } : {}), ...(userAgent ? { userAgent } : {}) };
}
