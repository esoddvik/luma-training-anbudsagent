import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_IN_UPGRADE_COPY,
  hasProduct,
  isEntitlementActive,
  PRODUCT_CODES,
  upgradeError,
  UPGRADE_REFUSAL_NB,
  type Entitlement,
} from './entitlements.js';

const NOW = new Date('2026-08-09T12:00:00Z');

function entitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    productCode: 'pluss',
    grantedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2027-01-01T00:00:00Z'),
    revokedAt: null,
    ...overrides,
  };
}

describe('isEntitlementActive', () => {
  it('is active inside its window', () => {
    expect(isEntitlementActive(entitlement(), NOW)).toBe(true);
  });

  it('lapses on expiry', () => {
    expect(
      isEntitlementActive(entitlement({ expiresAt: new Date('2026-08-01T00:00:00Z') }), NOW),
    ).toBe(false);
  });

  it('treats the expiry instant as over, not as the last valid moment', () => {
    // An off-by-one here is a day of access nobody paid for, or a day fewer
    // than they did. Pinned rather than left to the comparison operator.
    expect(isEntitlementActive(entitlement({ expiresAt: NOW }), NOW)).toBe(false);
    expect(isEntitlementActive(entitlement({ expiresAt: new Date(NOW.getTime() + 1) }), NOW)).toBe(
      true,
    );
  });

  it('never lapses when there is no expiry', () => {
    // A course purchase granting permanent access is a real case, which is why
    // the renewal report filters on "expires_at is not null" rather than
    // reading a null as long expired.
    expect(isEntitlementActive(entitlement({ expiresAt: null }), NOW)).toBe(true);
  });

  it('lets revocation beat an expiry that has not arrived', () => {
    // A refund or a chargeback must take access away now, not next January.
    const revoked = entitlement({ revokedAt: new Date('2026-06-01T00:00:00Z') });
    expect(isEntitlementActive(revoked, NOW)).toBe(false);
  });

  it('ignores a revocation dated in the future', () => {
    // An administrator scheduling the end of access has not ended it yet.
    const later = entitlement({ revokedAt: new Date('2026-12-01T00:00:00Z') });
    expect(isEntitlementActive(later, NOW)).toBe(true);
  });
});

describe('hasProduct', () => {
  it('is false for a user with no entitlements at all', () => {
    expect(hasProduct([], 'pluss', NOW)).toBe(false);
  });

  it('does not let one product unlock another', () => {
    // The failure this guards is the reason entitlements are rows keyed by
    // product rather than a boolean on the user.
    const other = entitlement({ productCode: 'noe-annet' });
    expect(hasProduct([other], 'pluss', NOW)).toBe(false);
  });

  it('ignores a lapsed grant even when a live one exists for something else', () => {
    const lapsed = entitlement({ expiresAt: new Date('2026-02-01T00:00:00Z') });
    const otherLive = entitlement({ productCode: 'noe-annet', expiresAt: null });
    expect(hasProduct([lapsed, otherLive], 'pluss', NOW)).toBe(false);
  });
});

describe('the upgrade refusal', () => {
  const refusal = upgradeError({
    productCode: 'pluss',
    appUrl: 'https://x.example/anbudsvarsling',
  });

  it('is one short honest sentence with somewhere to go', () => {
    expect(refusal.message).toBe(UPGRADE_REFUSAL_NB);
    expect(refusal.error).toBe('upgrade_required');
    expect(refusal.upgradeUrl).toContain('/bestillinger/ny?produkt=pluss');
  });

  /**
   * Spec v3 section 4.3: the two revenue streams are never bundled and never
   * mentioned in each other's upgrade paths. They cross-sell only in the
   * digest footer's promotion ladder, where each has its own block.
   */
  it('never mentions Påfyll, and never pressures', () => {
    const rendered = JSON.stringify(refusal).toLowerCase();
    for (const phrase of FORBIDDEN_IN_UPGRADE_COPY) {
      expect(rendered).not.toContain(phrase);
    }
  });

  it('would catch copy that started selling', () => {
    // The scan above proves nothing unless it can fail. This is the same check
    // against copy that breaks the rule.
    const bad = JSON.stringify({
      message: 'Oppgrader nå — siste sjanse! Se også Påfyll.',
    }).toLowerCase();
    const caught = FORBIDDEN_IN_UPGRADE_COPY.filter((phrase) => bad.includes(phrase));
    expect(caught.length).toBeGreaterThan(0);
  });

  it('tolerates an app URL with a trailing slash', () => {
    const trailing = upgradeError({ productCode: 'pluss', appUrl: 'https://x.example/app/' });
    expect(trailing.upgradeUrl).not.toContain('//bestillinger');
  });

  it('names a product code the system actually knows', () => {
    expect(PRODUCT_CODES).toContain(refusal.productCode);
    expect(refusal.productName).toBe('Anbudsvarsling Pluss');
  });
});
