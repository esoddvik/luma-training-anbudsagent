import { describe, expect, it } from 'vitest';
import { detectChanges, isNotifiable, type ComparableTender } from './change-detection.js';

function tender(overrides: Partial<ComparableTender> = {}): ComparableTender {
  return {
    title: 'Rammeavtale for renhold',
    description: 'Oppdragsgiver skal inngå rammeavtale for daglig renhold av kommunale bygg.',
    buyerName: 'Bærum kommune',
    noticeCategory: 'competition',
    status: 'open',
    deadlineAt: new Date('2026-09-01T10:00:00Z'),
    estimatedValueMinNok: 4_000_000,
    procedureType: 'open',
    cpvCodes: ['90910000'],
    ...overrides,
  };
}

describe('detectChanges', () => {
  it('reports nothing when nothing changed', () => {
    expect(detectChanges(tender(), tender())).toEqual([]);
  });

  it('reports a moved deadline, in Norwegian, with the new date', () => {
    const changes = detectChanges(
      tender(),
      tender({ deadlineAt: new Date('2026-09-15T10:00:00Z') }),
    );
    expect(changes[0]?.kind).toBe('deadline_changed');
    expect(changes[0]?.summary).toBe('Fristen er utsatt til 2026-09-15.');
  });

  it('distinguishes a postponed deadline from one brought forward', () => {
    const earlier = detectChanges(
      tender(),
      tender({ deadlineAt: new Date('2026-08-15T10:00:00Z') }),
    );
    expect(earlier[0]?.summary).toContain('endret til');
    expect(earlier[0]?.summary).not.toContain('utsatt');
  });

  it('reports a removed deadline rather than treating it as unchanged', () => {
    const changes = detectChanges(tender(), tender({ deadlineAt: null }));
    expect(changes[0]?.summary).toBe('Fristen er fjernet fra kunngjøringen.');
  });

  it('reports a cancellation and stops looking at anything else', () => {
    // Once the competition is gone, a changed CPV code is noise. Reporting
    // five changes when one of them is "avlyst" buries the one that matters.
    const changes = detectChanges(
      tender(),
      tender({ status: 'cancelled', title: 'Endret tittel', cpvCodes: ['90911200'] }),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe('cancelled');
    expect(changes[0]?.summary).toBe('Konkurransen er avlyst.');
  });

  it('reports a planned procurement becoming a live competition', () => {
    // The transition the whole planned-procurement feature exists for.
    const changes = detectChanges(
      tender({ noticeCategory: 'planned', deadlineAt: null }),
      tender({ noticeCategory: 'competition' }),
    );
    expect(changes.map((c) => c.kind)).toContain('planned_became_competition');
  });

  it('reports a changed title', () => {
    const changes = detectChanges(tender(), tender({ title: 'Rammeavtale for renhold og drift' }));
    expect(changes.map((c) => c.kind)).toContain('title_changed');
  });

  it('ignores a trivial description edit', () => {
    // Buyers routinely fix a typo. A notification for that teaches users to
    // ignore the notifications that matter.
    const before = tender();
    const after = tender({ description: `${before.description!.slice(0, -1)}.` });
    expect(detectChanges(before, after).map((c) => c.kind)).not.toContain('description_changed');
  });

  it('reports a substantially rewritten description', () => {
    const changes = detectChanges(
      tender(),
      tender({ description: 'Helt nytt omfang: oppdraget gjelder nå vaktmestertjenester.' }),
    );
    expect(changes.map((c) => c.kind)).toContain('description_changed');
  });

  it('reports a description that was removed entirely', () => {
    const changes = detectChanges(tender(), tender({ description: null }));
    expect(changes.map((c) => c.kind)).toContain('description_changed');
  });

  it('reports changed CPV codes', () => {
    const changes = detectChanges(tender(), tender({ cpvCodes: ['90910000', '90911200'] }));
    expect(changes.map((c) => c.kind)).toContain('cpv_changed');
  });

  it('does not report CPV codes that were merely reordered', () => {
    // The source does not guarantee array order, and a reorder is not a change.
    const before = tender({ cpvCodes: ['90910000', '90911200'] });
    const after = tender({ cpvCodes: ['90911200', '90910000'] });
    expect(detectChanges(before, after)).toEqual([]);
  });

  it('reports a changed buyer', () => {
    const changes = detectChanges(tender(), tender({ buyerName: 'Asker kommune' }));
    expect(changes[0]?.summary).toBe('Oppdragsgiver er endret til Asker kommune.');
  });

  it('reports a changed value with Norwegian number formatting', () => {
    const changes = detectChanges(tender(), tender({ estimatedValueMinNok: 8_000_000 }));
    const change = changes.find((c) => c.kind === 'value_changed');
    expect(change?.summary).toMatch(/Anslått verdi er endret til/);
    expect(change?.currentValue).toContain('kr');
  });

  it('reports a value that appeared where there was none', () => {
    const changes = detectChanges(
      tender({ estimatedValueMinNok: null }),
      tender({ estimatedValueMinNok: 4_000_000 }),
    );
    const change = changes.find((c) => c.kind === 'value_changed');
    expect(change?.previousValue).toBe('ikke oppgitt');
  });

  it('reports a changed procedure', () => {
    const changes = detectChanges(tender(), tender({ procedureType: 'neg-wo-call' }));
    expect(changes.map((c) => c.kind)).toContain('procedure_changed');
  });

  it('treats a null and an undefined procedure as the same', () => {
    const changes = detectChanges(
      tender({ procedureType: null }),
      tender({ procedureType: undefined }),
    );
    expect(changes.map((c) => c.kind)).not.toContain('procedure_changed');
  });

  it('puts the deadline first when several things changed at once', () => {
    // Ordering is the product decision: the digest shows the first reason.
    const changes = detectChanges(
      tender(),
      tender({ deadlineAt: new Date('2026-10-01T10:00:00Z'), title: 'Ny tittel' }),
    );
    expect(changes[0]?.kind).toBe('deadline_changed');
  });

  it('writes every summary in Norwegian', () => {
    const changes = detectChanges(
      tender(),
      tender({
        deadlineAt: new Date('2026-10-01T10:00:00Z'),
        title: 'Ny tittel',
        buyerName: 'Asker kommune',
        cpvCodes: ['45000000'],
      }),
    );
    expect(changes.length).toBeGreaterThan(3);
    for (const change of changes) {
      expect(change.summary).not.toMatch(/\b(the|changed to|deadline|has been)\b/i);
      expect(change.summary.endsWith('.')).toBe(true);
    }
  });
});

describe('isNotifiable', () => {
  it('is false when nothing changed', () => {
    expect(isNotifiable([])).toBe(false);
  });

  it('is true when something material changed', () => {
    expect(isNotifiable(detectChanges(tender(), tender({ status: 'closed' })))).toBe(true);
  });
});
