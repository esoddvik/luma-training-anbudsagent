import { z } from 'zod';
import { generateToken, hashToken } from './tokens.js';

/**
 * Passwordless magic-link login (spec section 10, ADR-16).
 *
 * Every requirement in spec section 10 maps to something enforced here:
 * short lifetime, single use, rate limiting, and responses that are identical
 * whether or not the address belongs to an account, so the endpoint cannot be
 * used to enumerate customers.
 */

export const MAGIC_LINK_TTL_MINUTES = 15;

/** Per address, and separately per client IP. */
export const MAGIC_LINK_RATE_LIMIT = {
  maxPerAddressPerHour: 5,
  maxPerIpPerHour: 20,
} as const;

/**
 * Normalisation runs before validation, not after.
 *
 * Addresses are routinely pasted with a leading or trailing space, and
 * validating first would reject those at the login form. Lowercasing here also
 * means one address cannot become two accounts through capitalisation.
 */
export const emailSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.email().max(254, 'e-postadressen er for lang'));

export interface MagicLinkRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt?: Date | null;
  createdAt: Date;
}

/** Persistence port. Implemented against the database by the core service. */
export interface MagicLinkStore {
  findByHash(tokenHash: string): Promise<MagicLinkRecord | undefined>;
  /**
   * Marks the token used and returns true only if this call is the one that
   * consumed it. Must be atomic: a conditional update whose row count decides
   * the answer. Two concurrent redemptions must not both succeed.
   */
  consume(id: string, consumedAt: Date): Promise<boolean>;
  countRecentForUser(userId: string, since: Date): Promise<number>;
}

export interface IssuedMagicLink {
  /** Embedded in the emailed URL. Never stored, never logged. */
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export function issueMagicLink(input: {
  pepper: string;
  now: Date;
  ttlMinutes?: number;
}): IssuedMagicLink {
  const { token, tokenHash } = generateToken(input.pepper);
  const ttl = input.ttlMinutes ?? MAGIC_LINK_TTL_MINUTES;
  return {
    token,
    tokenHash,
    expiresAt: new Date(input.now.getTime() + ttl * 60_000),
  };
}

export type RedeemResult =
  | { readonly ok: true; readonly userId: string }
  | { readonly ok: false; readonly reason: 'invalid' | 'expired' | 'already_used' };

/**
 * Redeems a magic-link token.
 *
 * Order matters. Expiry is checked before consumption is attempted, and the
 * atomic `consume` is what actually makes the link single-use: checking
 * `consumedAt` in application code and then updating would leave a window in
 * which two clicks of the same link both succeed.
 */
export async function redeemMagicLink(input: {
  token: string;
  pepper: string;
  store: MagicLinkStore;
  now: Date;
}): Promise<RedeemResult> {
  const record = await input.store.findByHash(hashToken(input.token, input.pepper));
  if (!record) return { ok: false, reason: 'invalid' };
  if (record.consumedAt) return { ok: false, reason: 'already_used' };
  if (record.expiresAt <= input.now) return { ok: false, reason: 'expired' };

  const consumed = await input.store.consume(record.id, input.now);
  if (!consumed) return { ok: false, reason: 'already_used' };

  return { ok: true, userId: record.userId };
}

/**
 * The Norwegian response shown after requesting a login link.
 *
 * Deliberately identical whether or not the address has an account, and
 * whether or not an email was actually sent. Spec section 10 requires generic
 * responses; a "no such user" message would turn the login form into a
 * customer list.
 */
export const MAGIC_LINK_GENERIC_RESPONSE_NB =
  'Hvis adressen er registrert hos oss, har vi sendt en innloggingslenke. Sjekk innboksen din.';

/** Norwegian messages for a link that cannot be redeemed. */
export const MAGIC_LINK_FAILURE_NB: Readonly<
  Record<Exclude<RedeemResult, { ok: true }>['reason'], string>
> = {
  invalid: 'Denne innloggingslenken er ikke gyldig. Be om en ny lenke for å logge inn.',
  expired: 'Denne innloggingslenken har utløpt. Be om en ny lenke for å logge inn.',
  already_used: 'Denne innloggingslenken er allerede brukt. Be om en ny lenke for å logge inn.',
};
