import { describe, expect, it } from 'vitest';
import {
  currentLegalDocumentSeed,
  LEGAL_DOCUMENT_SEEDS,
  legalDocumentSeedSchema,
} from './legal-documents.js';

describe('legal document seeds', () => {
  it('every seed satisfies its schema', () => {
    for (const seed of LEGAL_DOCUMENT_SEEDS) {
      expect(() => legalDocumentSeedSchema.parse(seed)).not.toThrow();
    }
  });

  it('has exactly one terms version and it is the placeholder', () => {
    const terms = LEGAL_DOCUMENT_SEEDS.filter((seed) => seed.kind === 'terms');
    expect(terms).toHaveLength(1);
    expect(terms[0]!.isPlaceholder).toBe(true);
  });

  // Spec section 6: all customer-facing text is Norwegian bokmål. A body
  // written in English would reach a legal page, which is the worst place
  // for it.
  it('is written in Norwegian', () => {
    for (const seed of LEGAL_DOCUMENT_SEEDS) {
      expect(seed.body).toMatch(/[æøå]/i);
    }
  });

  it('carries no two seeds with the same kind and version', () => {
    const keys = LEGAL_DOCUMENT_SEEDS.map((seed) => `${seed.kind}:${seed.version}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('picks the newest effective date as the one in force', () => {
    const seeds = [
      {
        kind: 'terms' as const,
        version: 'gammel',
        body: 'Gammel vilkårstekst.',
        isPlaceholder: false,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        kind: 'terms' as const,
        version: 'ny',
        body: 'Ny vilkårstekst.',
        isPlaceholder: false,
        effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
      },
    ];
    expect(currentLegalDocumentSeed('terms', seeds)?.version).toBe('ny');
  });

  it('has no document in force for a kind it carries no seed for', () => {
    expect(currentLegalDocumentSeed('privacy')).toBeUndefined();
  });
});
