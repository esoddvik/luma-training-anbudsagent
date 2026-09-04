import { describe, expect, it } from 'vitest';
import { LEGAL_DOCUMENT_SEEDS } from '@luma/content';
import { parseLegalBody, unsupportedLegalMarkup } from './legal-body';

describe('parseLegalBody', () => {
  it('turns a ## line into a heading', () => {
    expect(parseLegalBody('## Om tjenesten')).toEqual([{ type: 'heading', text: 'Om tjenesten' }]);
  });

  it('joins hard-wrapped lines into one paragraph', () => {
    const blocks = parseLegalBody('Første linje\nandre linje.');
    expect(blocks).toEqual([{ type: 'paragraph', text: 'Første linje andre linje.' }]);
  });

  it('splits paragraphs on a blank line', () => {
    const blocks = parseLegalBody('Én.\n\nTo.');
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'Én.' },
      { type: 'paragraph', text: 'To.' },
    ]);
  });

  it('keeps headings and paragraphs in order', () => {
    const blocks = parseLegalBody('## Ansvar\n\nDu er ansvarlig.\n\n## Data\n\nDoffin.');
    expect(blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'paragraph',
    ]);
  });
});

describe('unsupportedLegalMarkup', () => {
  it('names a bulleted list, which this renderer cannot show', () => {
    expect(unsupportedLegalMarkup('- Tjenestens omfang')).toEqual(['- Tjenestens omfang']);
  });

  it('names a numbered list, a quote, a table row and a code fence', () => {
    expect(unsupportedLegalMarkup('1. Ett')).toHaveLength(1);
    expect(unsupportedLegalMarkup('> Sitat')).toHaveLength(1);
    expect(unsupportedLegalMarkup('| a | b |')).toHaveLength(1);
    expect(unsupportedLegalMarkup('```')).toHaveLength(1);
  });

  it('names a heading depth the renderer does not handle', () => {
    expect(unsupportedLegalMarkup('### Underpunkt')).toEqual(['### Underpunkt']);
  });

  it('accepts the two constructs the documents use', () => {
    expect(unsupportedLegalMarkup('## Om tjenesten\n\nEn helt vanlig setning.')).toEqual([]);
  });

  /**
   * The guard that matters.
   *
   * Section 19 lists twelve things the terms should cover, which is the shape
   * of a bulleted list, and the reviewed text does not exist yet. When it
   * arrives carrying markup this renderer cannot show, this test goes red
   * before the page does — rather than the page printing "- Tjenestens omfang"
   * as a sentence with a stray hyphen.
   */
  it('every committed legal body stays inside what the renderer handles', () => {
    for (const seed of LEGAL_DOCUMENT_SEEDS) {
      expect(unsupportedLegalMarkup(seed.body)).toEqual([]);
    }
  });
});
