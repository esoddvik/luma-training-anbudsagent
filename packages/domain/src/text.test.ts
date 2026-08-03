import { describe, expect, it } from 'vitest';
import { containsPhrase, findMatchingPhrases, normalizeSearchText, tokenize } from './text.js';

describe('normalizeSearchText', () => {
  it('lowercases', () => {
    expect(normalizeSearchText('Rehabilitering')).toBe('rehabilitering');
  });

  it('folds the Norwegian letters to digraphs rather than stripping them', () => {
    expect(normalizeSearchText('Ålesund')).toBe('aalesund');
    expect(normalizeSearchText('Bærum')).toBe('baerum');
    expect(normalizeSearchText('Grønn')).toBe('groenn');
  });

  it('keeps words distinct that naive diacritic stripping would collapse', () => {
    // NFD folding would turn "mål" into "mal" and make these equal.
    expect(normalizeSearchText('mål')).not.toBe(normalizeSearchText('mal'));
  });

  it('strips diacritics from loanwords', () => {
    expect(normalizeSearchText('resumé')).toBe('resume');
  });

  it('collapses runs of whitespace and trims', () => {
    expect(normalizeSearchText('  drift   og\tvedlikehold \n')).toBe('drift og vedlikehold');
  });

  it('is idempotent', () => {
    const once = normalizeSearchText('Rørlegger på Bryggen');
    expect(normalizeSearchText(once)).toBe(once);
  });
});

describe('tokenize', () => {
  it('splits on punctuation and whitespace', () => {
    expect(tokenize('Rehabilitering av skole, trinn 2')).toEqual([
      'rehabilitering',
      'av',
      'skole',
      'trinn',
      '2',
    ]);
  });

  it('keeps hyphenated compounds together', () => {
    expect(tokenize('ventilasjons-anlegg')).toEqual(['ventilasjons-anlegg']);
  });

  it('returns an empty list for text with no word characters', () => {
    expect(tokenize('--- ,. ')).toEqual([]);
  });
});

describe('containsPhrase', () => {
  const tenderText = 'Rammeavtale for renhold og drift av kommunale bygg i Bærum';

  it('finds a single word', () => {
    expect(containsPhrase(tenderText, 'renhold')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(containsPhrase(tenderText, 'RENHOLD')).toBe(true);
  });

  it('matches across Norwegian character folding in both directions', () => {
    expect(containsPhrase(tenderText, 'bærum')).toBe(true);
    expect(containsPhrase('Rammeavtale i Baerum', 'Bærum')).toBe(true);
  });

  it('matches a contiguous multi-word phrase', () => {
    expect(containsPhrase(tenderText, 'renhold og drift')).toBe(true);
  });

  it('rejects a multi-word phrase whose words are present but not contiguous', () => {
    expect(containsPhrase(tenderText, 'renhold bygg')).toBe(false);
  });

  it('does not match a word fragment', () => {
    // The decisive case: substring matching would let the keyword "hold"
    // match "renhold", and an exclusion keyword would suppress good tenders.
    expect(containsPhrase(tenderText, 'hold')).toBe(false);
  });

  it('does not match a prefix of a longer word', () => {
    expect(containsPhrase('Leveranse av badevakter', 'bad')).toBe(false);
  });

  it('matches a word at the very start and at the very end', () => {
    expect(containsPhrase(tenderText, 'rammeavtale')).toBe(true);
    expect(containsPhrase(tenderText, 'bærum')).toBe(true);
  });

  it('ignores punctuation differences between needle and haystack', () => {
    expect(containsPhrase('Drift, vedlikehold og service', 'drift vedlikehold')).toBe(true);
  });

  it('returns false for an empty needle rather than matching everything', () => {
    expect(containsPhrase(tenderText, '')).toBe(false);
    expect(containsPhrase(tenderText, '   ')).toBe(false);
  });

  it('returns false when the needle is longer than the haystack', () => {
    expect(containsPhrase('renhold', 'renhold og drift av bygg')).toBe(false);
  });
});

describe('findMatchingPhrases', () => {
  it('returns the caller spelling so it can be shown as evidence', () => {
    const found = findMatchingPhrases('Rammeavtale for RENHOLD i Bærum', ['Renhold', 'bærum']);
    expect(found).toEqual(['Renhold', 'bærum']);
  });

  it('omits phrases that are absent', () => {
    expect(findMatchingPhrases('Rammeavtale for renhold', ['renhold', 'asfaltering'])).toEqual([
      'renhold',
    ]);
  });

  it('returns an empty list when nothing matches', () => {
    expect(findMatchingPhrases('Rammeavtale', ['renhold'])).toEqual([]);
  });
});
