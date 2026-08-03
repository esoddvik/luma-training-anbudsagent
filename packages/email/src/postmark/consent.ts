import { isConsentActive, latestConsentEvent, type ConsentEvent } from '@luma/domain';

/**
 * Proof that marketing consent was verified (spec sections 20.2 and 21).
 *
 * The `luma-marketing` stream requires valid marketing consent. A boolean
 * parameter would satisfy the letter of that and none of its intent: any
 * caller can pass `true`, and the one that eventually does will be a
 * well-meaning refactor at 17:40 on a Friday.
 *
 * So the send function takes a value that only a real consent check can
 * produce. Three things make that hold:
 *
 * 1. `MarketingConsentProof` carries a `private` field, so TypeScript types it
 *    nominally: an object literal with the same shape is not assignable.
 * 2. Its constructor demands a module-private symbol, so the class cannot be
 *    instantiated from outside this file even with `new`.
 * 3. Every instance the factory issues is recorded in a module-private
 *    `WeakSet`, and the send path checks membership. That closes the last
 *    hole, `Object.create(MarketingConsentProof.prototype)`, which would
 *    otherwise pass an `instanceof` check.
 *
 * A cast still compiles - nothing stops `{} as MarketingConsentProof` - but it
 * throws at runtime, which is the behaviour we want from something that
 * bypassed the consent check on purpose.
 */

const ISSUER = Symbol('luma.email.marketing-consent-proof');

const issued = new WeakSet<object>();

export class MarketingConsentProof {
  /** Nominal typing. Never read; its presence is the point. */
  private readonly nominal = 'marketing-consent-proof';

  constructor(
    issuerToken: symbol,
    /** The address the consent was verified for. Checked again at send time. */
    readonly email: string,
    /** Which version of the consent text the user accepted (spec section 21). */
    readonly consentTextVersion: string,
    /** The consent event this proof was derived from, for the audit trail. */
    readonly consentEventId: string,
    readonly verifiedAt: Date,
  ) {
    if (issuerToken !== ISSUER) {
      throw new Error(
        'MarketingConsentProof kan bare opprettes av verifyMarketingConsent(). ' +
          'Markedsføringssamtykke skal alltid utledes fra consent_events.',
      );
    }
    void this.nominal;
  }
}

/** True only for a proof this module issued. */
export function isIssuedProof(value: unknown): value is MarketingConsentProof {
  return value instanceof MarketingConsentProof && issued.has(value);
}

export class MarketingConsentRequiredError extends Error {
  constructor(
    readonly reason: 'missing_proof' | 'forged_proof' | 'recipient_mismatch',
    message: string,
  ) {
    super(message);
    this.name = 'MarketingConsentRequiredError';
  }
}

/**
 * Throws unless `proof` is a genuine proof for `email`.
 *
 * Called on the marketing send path before anything touches the network.
 */
export function assertMarketingConsent(proof: unknown, email: string): MarketingConsentProof {
  if (proof === undefined || proof === null) {
    throw new MarketingConsentRequiredError(
      'missing_proof',
      'Sending på luma-marketing krever verifisert markedsføringssamtykke.',
    );
  }
  if (!isIssuedProof(proof)) {
    throw new MarketingConsentRequiredError(
      'forged_proof',
      'Samtykkebeviset er ikke utstedt av verifyMarketingConsent().',
    );
  }
  if (proof.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
    throw new MarketingConsentRequiredError(
      'recipient_mismatch',
      'Samtykkebeviset gjelder en annen e-postadresse enn mottakeren.',
    );
  }
  return proof;
}

export type MarketingConsentVerification =
  | { readonly status: 'granted'; readonly proof: MarketingConsentProof }
  | { readonly status: 'never_given' }
  | { readonly status: 'withdrawn'; readonly withdrawnAt: Date };

/**
 * Derives current marketing consent from the append-only consent log
 * (ADR-0009) and, when it is in force, issues the proof.
 *
 * This is the only function in the package that can produce a
 * `MarketingConsentProof`.
 */
export function verifyMarketingConsent(input: {
  email: string;
  consentEvents: readonly ConsentEvent[];
  now?: Date;
}): MarketingConsentVerification {
  const latest = latestConsentEvent(input.consentEvents, 'marketing_email');
  if (!latest) return { status: 'never_given' };

  if (!isConsentActive(input.consentEvents, 'marketing_email')) {
    return { status: 'withdrawn', withdrawnAt: latest.occurredAt };
  }

  const proof = new MarketingConsentProof(
    ISSUER,
    input.email,
    latest.consentTextVersion,
    latest.id,
    input.now ?? new Date(),
  );
  issued.add(proof);
  return { status: 'granted', proof };
}
