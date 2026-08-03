import { describe, expect, it } from 'vitest';
import { ToolError } from './errors.js';
import {
  decodeCursor,
  encodeCursor,
  limitNoteNb,
  nextCursor,
  resolveLimit,
  slicePage,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from './pagination.js';

describe('resolveLimit', () => {
  it('defaults to the page size a model can actually read back', () => {
    expect(resolveLimit(undefined)).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('caps an absurd request instead of scanning the table', () => {
    expect(resolveLimit(10_000)).toBe(MAX_PAGE_LIMIT);
  });

  it('clamps a nonsensical low value rather than returning an empty page', () => {
    expect(resolveLimit(0)).toBe(1);
    expect(resolveLimit(-5)).toBe(1);
  });

  it('passes a reasonable request through untouched', () => {
    expect(resolveLimit(7)).toBe(7);
  });
});

describe('limitNoteNb', () => {
  it('explains the cap in Norwegian when it bit', () => {
    const note = limitNoteNb(10_000);
    expect(note).toContain('10000');
    expect(note).toContain(String(MAX_PAGE_LIMIT));
    expect(note).toContain('nesteCursor');
  });

  it('says nothing when the caller stayed inside the cap', () => {
    expect(limitNoteNb(20)).toBeNull();
    expect(limitNoteNb(undefined)).toBeNull();
  });
});

describe('the cursor codec', () => {
  it('round-trips an offset', () => {
    expect(decodeCursor(encodeCursor(40))).toBe(40);
  });

  it('is opaque rather than a bare number', () => {
    expect(encodeCursor(40)).not.toBe('40');
  });

  it('treats an absent cursor as the first page', () => {
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor('')).toBe(0);
  });

  it('rejects a malformed cursor with a Norwegian message', () => {
    expect(() => decodeCursor('tull')).toThrowError(ToolError);
    try {
      decodeCursor('tull');
    } catch (error) {
      expect((error as ToolError).code).toBe('invalid_input');
      expect((error as ToolError).message).toContain('Ugyldig cursor');
    }
  });

  it('rejects a cursor carrying a negative or non-integer offset', () => {
    expect(() => decodeCursor(encodeCursor(-1))).toThrowError(ToolError);
    const fractional = Buffer.from(JSON.stringify({ o: 1.5 }), 'utf8').toString('base64url');
    expect(() => decodeCursor(fractional)).toThrowError(ToolError);
  });
});

describe('nextCursor', () => {
  it('is null on the last page', () => {
    expect(nextCursor(0, 3, false)).toBeNull();
  });

  it('points past the page just served', () => {
    expect(decodeCursor(nextCursor(20, 20, true) ?? undefined)).toBe(40);
  });
});

describe('slicePage', () => {
  const items = [1, 2, 3, 4, 5];

  it('reports more when rows remain', () => {
    expect(slicePage(items, 0, 2)).toEqual({ items: [1, 2], hasMore: true });
  });

  it('reports no more on the final page', () => {
    expect(slicePage(items, 4, 2)).toEqual({ items: [5], hasMore: false });
  });

  it('returns an empty final page past the end', () => {
    expect(slicePage(items, 10, 2)).toEqual({ items: [], hasMore: false });
  });
});
