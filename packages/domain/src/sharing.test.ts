import { describe, expect, it } from 'vitest';
import {
  evaluateShareAccess,
  FORBIDDEN_SHARE_FIELDS,
  sharedTenderViewSchema,
  type TenderShare,
} from './sharing.js';

const now = new Date('2026-06-01T12:00:00Z');

function share(overrides: Partial<TenderShare> = {}): TenderShare {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    tenderId: '00000000-0000-4000-8000-000000000002',
    createdByUserId: '00000000-0000-4000-8000-000000000003',
    token: 'a'.repeat(43),
    expiresAt: new Date('2026-07-01T12:00:00Z'),
    viewCount: 0,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  };
}

describe('evaluateShareAccess', () => {
  it('allows an active, unexpired link', () => {
    expect(evaluateShareAccess(share(), now)).toEqual({ kind: 'ok' });
  });

  it('reports a missing token as not found', () => {
    expect(evaluateShareAccess(undefined, now)).toEqual({ kind: 'not_found' });
  });

  it('reports an expired link', () => {
    const expired = share({ expiresAt: new Date('2026-05-01T12:00:00Z') });
    expect(evaluateShareAccess(expired, now)).toEqual({ kind: 'expired' });
  });

  it('treats the exact expiry instant as expired', () => {
    expect(evaluateShareAccess(share({ expiresAt: now }), now)).toEqual({ kind: 'expired' });
  });

  it('reports a revoked link', () => {
    const revoked = share({ revokedAt: new Date('2026-05-15T00:00:00Z') });
    expect(evaluateShareAccess(revoked, now)).toEqual({ kind: 'revoked' });
  });

  it('reports revocation even when the link has not expired', () => {
    const revoked = share({
      revokedAt: new Date('2026-05-15T00:00:00Z'),
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    });
    expect(evaluateShareAccess(revoked, now).kind).toBe('revoked');
  });
});

describe('shared view privacy', () => {
  const view = {
    title: 'Rammeavtale renhold',
    buyerName: 'Bærum kommune',
    noticeCategory: 'competition' as const,
    status: 'open' as const,
    cpvCodes: ['90910000'],
    regions: ['NO082'],
    publishedAt: new Date('2026-05-01'),
    sourceUrl: 'https://doffin.no/notices/1',
    lastSyncedAt: new Date('2026-06-01'),
    matchReasonTypes: ['cpv' as const, 'geography' as const],
  };

  it('accepts a payload with only public fields', () => {
    expect(sharedTenderViewSchema.parse(view)).toBeDefined();
  });

  it('strips any field not declared on the schema', () => {
    // The decisive property: even if a caller passes the sharer's id, Zod's
    // default object behaviour drops it rather than passing it through.
    const parsed = sharedTenderViewSchema.parse({
      ...view,
      createdByUserId: '00000000-0000-4000-8000-000000000003',
      email: 'espen@luma-training.com',
      score: 87,
    });
    expect(parsed).not.toHaveProperty('createdByUserId');
    expect(parsed).not.toHaveProperty('email');
    expect(parsed).not.toHaveProperty('score');
  });

  it('declares none of the forbidden fields in its own shape', () => {
    const declared = Object.keys(sharedTenderViewSchema.shape);
    for (const forbidden of FORBIDDEN_SHARE_FIELDS) {
      expect(declared).not.toContain(forbidden);
    }
  });

  it('carries reason kinds without the profile values behind them', () => {
    const parsed = sharedTenderViewSchema.parse(view);
    expect(parsed.matchReasonTypes).toEqual(['cpv', 'geography']);
    expect(JSON.stringify(parsed)).not.toContain('renhold-keyword');
  });
});
