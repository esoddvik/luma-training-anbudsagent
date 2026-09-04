import { describe, expect, it } from 'vitest';
import type { LegalDocumentSeed } from '@luma/content';
import { computeLegalDocumentDrift, type LegalVersionRowish } from './legal-documents';

/**
 * What a terms sync would do, decided without a database.
 *
 * The sibling of `admin-service-templates.ts`'s comparison, and deliberately
 * weaker in the one way that matters: a differing body on a published version
 * is a conflict to report, never an update to apply.
 */

const seed = (over: Partial<LegalDocumentSeed> = {}): LegalDocumentSeed => ({
  kind: 'terms',
  version: '2026-03',
  body: 'Vilkår for tjenesten.',
  isPlaceholder: false,
  effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
  ...over,
});

const row = (over: Partial<LegalVersionRowish> = {}): LegalVersionRowish => ({
  kind: 'terms',
  version: '2026-03',
  body: 'Vilkår for tjenesten.',
  ...over,
});

describe('computeLegalDocumentDrift', () => {
  it('reports a seed with no row as insertable', () => {
    const report = computeLegalDocumentDrift([], [seed()]);
    expect(report.insertable.map((entry) => entry.version)).toEqual(['2026-03']);
    expect(report.conflicts).toEqual([]);
  });

  it('reports nothing when the row already matches', () => {
    const report = computeLegalDocumentDrift([row()], [seed()]);
    expect(report.insertable).toEqual([]);
    expect(report.conflicts).toEqual([]);
    expect(report.unseeded).toEqual([]);
  });

  /**
   * The case this module exists for. An acceptance carries a foreign key onto
   * `(kind, version)`; rewriting a published body would change what people
   * already agreed to, so a differing body is reported and refused.
   */
  it('reports an edited published body as a conflict, not an update', () => {
    const report = computeLegalDocumentDrift([row({ body: 'Gammel tekst.' })], [seed()]);
    expect(report.insertable).toEqual([]);
    expect(report.conflicts).toEqual([{ kind: 'terms', version: '2026-03' }]);
  });

  it('reports a row with no seed without proposing to remove it', () => {
    const report = computeLegalDocumentDrift([row({ version: '2025-09' })], [seed()]);
    expect(report.unseeded).toEqual([{ kind: 'terms', version: '2025-09' }]);
    expect(report.insertable.map((entry) => entry.version)).toEqual(['2026-03']);
  });

  it('keeps the two kinds apart', () => {
    const report = computeLegalDocumentDrift([row({ kind: 'privacy' })], [seed({ kind: 'terms' })]);
    expect(report.insertable.map((entry) => entry.kind)).toEqual(['terms']);
    expect(report.unseeded).toEqual([{ kind: 'privacy', version: '2026-03' }]);
  });
});
