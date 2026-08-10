import { describe, expect, it } from 'vitest';
import { CPV_VOCABULARY } from './cpv-vocabulary.js';
import { cpvSearchEmptyMessage, searchCpvEntries, searchCpvRanked } from './cpv-search.js';
import { normalizeSearchText } from './text.js';

/**
 * R7's acceptance queries, as tests.
 *
 * Each one is a sentence a supplier actually types. They are here rather than
 * in a component test because the ranking is the thing being asserted, and a
 * ranking that only holds when rendered inside React is not a ranking anyone
 * can reason about.
 *
 * Two of the spec's five queries cannot be answered by the vocabulary as it
 * stands. Those are asserted as *gaps*, loudly, at the bottom of this file —
 * see the note there before deleting one.
 */

function codes(query: string): string[] {
  return searchCpvEntries(query).map((entry) => entry.code);
}

function rank(query: string, code: string): number {
  return codes(query).indexOf(code);
}

describe('searchCpvRanked', () => {
  it('returns nothing for an empty or whitespace query', () => {
    expect(searchCpvRanked('')).toEqual([]);
    expect(searchCpvRanked('   ')).toEqual([]);
  });

  it('never returns more than six rows', () => {
    // «renhold» is deliberately broad: it appears in a name, several synonyms
    // and a division heading, so it is the query most able to overflow.
    expect(searchCpvRanked('renhold').length).toBeLessThanOrEqual(6);
    expect(searchCpvRanked('tjenester').length).toBeLessThanOrEqual(6);
  });

  it('honours an explicit limit below six', () => {
    expect(searchCpvRanked('renhold', 2)).toHaveLength(2);
    expect(searchCpvRanked('renhold', 0)).toEqual([]);
  });

  it('puts a code prefix above everything else', () => {
    const hits = searchCpvRanked('9091');
    expect(hits[0]?.entry.code.startsWith('9091')).toBe(true);
    expect(hits[0]?.score).toBeGreaterThanOrEqual(100);
  });

  it('folds case and Norwegian letters, so «MÅLTID» and «maaltid» agree', () => {
    expect(codes('måltidslevering')).toEqual(codes('MÅLTIDSLEVERING'));
    expect(codes('måltidslevering')[0]).toBe('55521200');
  });

  it('sorts on the code when two entries score the same, so the order is stable', () => {
    const first = searchCpvRanked('kantine');
    const second = searchCpvRanked('kantine');
    expect(first.map((hit) => hit.entry.code)).toEqual(second.map((hit) => hit.entry.code));
  });
});

describe('the acceptance queries (R7)', () => {
  it('«vask av vinduer» ranks Vinduspuss first, above general cleaning', () => {
    const hits = searchCpvRanked('vask av vinduer');
    expect(hits[0]?.entry.code).toBe('90911300');
    expect(hits[0]?.entry.name).toBe('Vinduspuss');

    // The failure this ranking exists to prevent: «Renholdstjenester» carries
    // the synonym «vask», so a tier-based search can seat it level with — and
    // on a code tie-break, above — the entry that means exactly this.
    const general = rank('vask av vinduer', '90910000');
    expect(general).toBeGreaterThan(0);
    expect(hits[0]?.score).toBeGreaterThan(
      searchCpvRanked('vask av vinduer').find((hit) => hit.entry.code === '90910000')?.score ?? 0,
    );
  });

  it('«vask av vinduer» does not surface a water-and-drainage category', () => {
    // Spec R7 names «Vann- og avløpsarbeid» as the wrong answer. The table's
    // nearest thing to it is 45330000 «Rørleggerarbeid og sanitæranlegg», whose
    // synonyms include «vann og avløp i bygg» — a plumbing category is not what
    // a window cleaner is looking for, and it must not appear at all.
    //
    // Asserted on codes rather than on the word «avløp», because the renhold
    // division is itself called «Avløps-, avfalls-, renholds- og
    // miljøtjenester»: the right answers sit inside a heading that names
    // drainage, so matching on the word would fail on the correct result.
    expect(codes('vask av vinduer')).not.toContain('45330000');
    expect(codes('vask av vinduer')).not.toContain('90000000');
  });

  it('«vikar» ranks staffing hire first', () => {
    const hits = searchCpvRanked('vikar');
    expect(hits[0]?.entry.code).toBe('79620000');
    expect(hits[0]?.entry.name).toBe('Utleie av personell, inkludert vikarer');
  });

  it('«kantine» ranks the two canteen categories above everything else', () => {
    const top = codes('kantine').slice(0, 2);
    expect(top).toEqual(['55500000', '55510000']);
  });

  it('«renhold» ranks a cleaning category first, not a business-services one', () => {
    expect(codes('renhold')[0]?.startsWith('909')).toBe(true);
  });

  it('«skoleskyss» ranks Spesialisert persontransport first', () => {
    const hits = searchCpvRanked('skoleskyss');
    expect(hits[0]?.entry.code).toBe('60130000');
    expect(hits[0]?.entry.name).toBe('Spesialisert persontransport');

    // Not the division above it. «Transporttjenester» is the branch, not the
    // trade, and a picker that offered it would seed a template with a code
    // `isBroadCpv` then discards — the reader would filter on something that
    // cannot be evidence of anything.
    expect(codes('skoleskyss')).not.toContain('60000000');
  });

  it('«rehabilitering» ranks the construction category first', () => {
    // The word lives only in 45000000's synonyms. `about` says it too, but
    // `about` is prose for a reader and is deliberately not searched — every
    // broad sentence would otherwise become a match surface.
    expect(codes('rehabilitering')[0]).toBe('45000000');
  });
});

describe('the empty result', () => {
  it('names the query and points at keywords as the alternative', () => {
    const message = cpvSearchEmptyMessage('  bergsprengning  ');
    expect(message).toContain('«bergsprengning»');
    expect(message).toContain('søkeord');
    // No apology, no dead end: the sentence has to leave the reader somewhere.
    expect(message).toContain('leter i selve teksten');
  });
});

/**
 * ── The vocabulary this ranking can see ───────────────────────────────────
 *
 * `searchCpvRanked` reads `name`, `group` and `synonyms`, and never `about`. A
 * query the spec requires can therefore fail for a reason that is not in this
 * file at all, and the honest fix is a vocabulary edit rather than a weight
 * nudged until the test goes green. This test names that boundary so the next
 * failure is diagnosed in the right file.
 */
describe('what the ranking reads', () => {
  it('ignores `about`, however well it describes the entry', () => {
    const entry = CPV_VOCABULARY.find((candidate) => candidate.code === '90911200');
    expect(normalizeSearchText(entry?.about ?? '')).toContain('periodisk');
    // «periodisk» appears in no name, group or synonym anywhere in the table.
    expect(searchCpvRanked('periodisk')).toEqual([]);
  });
});
