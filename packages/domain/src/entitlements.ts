import { z } from 'zod';

/**
 * Paid access and the upgrade boundary (IDE Agent Spec v3, sections 4 and 7.2).
 *
 * Pure: no I/O, no database, no clock read that is not passed in. The point is
 * that "does this person have Pluss" and "what do we say when they do not" are
 * decided by one function each, in one place, testable without a database —
 * because the same two questions are asked from the web app, the API and the
 * MCP server, and three copies of the answer is how a paywall becomes
 * accidentally porous in one of them.
 */

/**
 * Product codes. Plain strings in the database; this is the closed set the
 * code knows about.
 *
 * `pluss` is Anbudsvarsling Pluss. **Påfyll is deliberately absent**, and that
 * absence is load-bearing rather than an oversight: spec v3 section 4.3 makes
 * the two separate revenue streams that are never bundled and never mentioned
 * in each other's upgrade paths. Påfyll access is not modelled here because
 * this table must not become the place someone conflates them.
 */
export const PRODUCT_CODES = ['pluss'] as const;
export const productCodeSchema = z.enum(PRODUCT_CODES);
export type ProductCode = z.infer<typeof productCodeSchema>;

/** Customer-facing product name. Norwegian, per ADR-0012. */
export const PRODUCT_NAMES: Readonly<Record<ProductCode, string>> = {
  pluss: 'Anbudsvarsling Pluss',
};

export interface Entitlement {
  readonly productCode: string;
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
}

/**
 * Whether an entitlement is live at a given instant.
 *
 * Revocation beats expiry, and both are checked against a supplied `now`
 * rather than a clock read, so a test can put the boundary anywhere and an
 * admin preview can ask "what will this look like on the 1st".
 *
 * A null `expiresAt` never lapses. That is intentional — a course purchase may
 * grant permanent access — and it is why the renewal report filters on
 * `expiresAt IS NOT NULL` rather than treating null as "expired long ago".
 */
export function isEntitlementActive(entitlement: Entitlement, now: Date): boolean {
  if (entitlement.revokedAt !== null && entitlement.revokedAt <= now) return false;
  if (entitlement.expiresAt === null) return true;
  return entitlement.expiresAt > now;
}

export function hasProduct(
  entitlements: readonly Entitlement[],
  productCode: ProductCode,
  now: Date,
): boolean {
  return entitlements.some(
    (entitlement) =>
      entitlement.productCode === productCode && isEntitlementActive(entitlement, now),
  );
}

/**
 * The refusal a free user gets when they reach a paid feature
 * (IDE Agent Spec v3, section 4.3).
 *
 * Four rules, and each exists because the obvious alternative is worse:
 *
 * 1. **One short, honest sentence.** Not a pitch. The person asked for a
 *    document and is being told no; padding that with benefit copy is how a
 *    product surface starts feeling like an advertisement.
 * 2. **A link, so the refusal is actionable.** A dead end teaches people the
 *    feature is broken rather than paid.
 * 3. **Påfyll is never mentioned.** Section 4.3 is explicit. The two streams
 *    cross-sell only in the digest footer's promotion ladder, where each has
 *    its own block and neither is dressed as the other. An upgrade refusal
 *    that name-drops the other product is exactly the conflation the separate
 *    streams exist to prevent.
 * 4. **In MCP it is a structured tool error, never prose in a data result.**
 *    A model reading marketing copy out of what it believes is tender data
 *    will repeat it to the user as fact. `upgradeError` is the shape; the
 *    tools return it in the error channel.
 */
export const UPGRADE_REFUSAL_NB = 'Dette krever Anbudsvarsling Pluss.';

export interface UpgradeRequired {
  readonly error: 'upgrade_required';
  readonly productCode: ProductCode;
  readonly productName: string;
  readonly message: string;
  readonly upgradeUrl: string;
}

export function upgradeError(input: { productCode: ProductCode; appUrl: string }): UpgradeRequired {
  return {
    error: 'upgrade_required',
    productCode: input.productCode,
    productName: PRODUCT_NAMES[input.productCode],
    message: UPGRADE_REFUSAL_NB,
    // The order flow, not a marketing page: the next step is submitting an
    // order request, which is how this product is actually bought (ADR-0010).
    upgradeUrl: `${input.appUrl.replace(/\/$/, '')}/bestillinger/ny?produkt=${input.productCode}`,
  };
}

/**
 * Phrases an upgrade refusal must never contain.
 *
 * Asserted by a test over the rendered refusal rather than trusted to review.
 * `Påfyll` is rule 3 above. The others are the register spec section 42
 * forbids everywhere in this product — urgency and pressure — which an
 * upgrade prompt is the single most likely place to acquire.
 */
export const FORBIDDEN_IN_UPGRADE_COPY = [
  'påfyll',
  'kun i dag',
  'siste sjanse',
  'ikke gå glipp',
  'oppgrader nå',
] as const;
