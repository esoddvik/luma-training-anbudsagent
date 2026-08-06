import { describe, expect, it } from 'vitest';
import {
  isLumaUrl,
  LUMA_BASE_URL,
  lumaUrl,
  UTM_SOURCE,
  withLumaUtm,
  type LumaUtmOptions,
} from './luma-links';

const web: LumaUtmOptions = { medium: 'landingsside' };

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('withLumaUtm', () => {
  it('always sets utm_source=anbudsvarsling (spec 44.2)', () => {
    expect(params(withLumaUtm('https://luma-training.com/kurs', web)).get('utm_source')).toBe(
      UTM_SOURCE,
    );
    expect(UTM_SOURCE).toBe('anbudsvarsling');
  });

  it('sets utm_medium from the surface', () => {
    const tagged = withLumaUtm('https://luma-training.com/kurs', { medium: 'epost' });
    expect(params(tagged).get('utm_medium')).toBe('epost');
  });

  it('sets utm_campaign only when a campaign is given', () => {
    expect(params(withLumaUtm('https://luma-training.com/kurs', web)).has('utm_campaign')).toBe(
      false,
    );
    expect(
      params(
        withLumaUtm('https://luma-training.com/kurs', {
          medium: 'epost',
          campaign: 'vinn-flere-anbud-med-ai',
        }),
      ).get('utm_campaign'),
    ).toBe('vinn-flere-anbud-med-ai');
  });

  it('ignores empty campaign and content strings', () => {
    const tagged = withLumaUtm('https://luma-training.com/kurs', {
      medium: 'epost',
      campaign: '',
      content: '',
    });
    expect(params(tagged).has('utm_campaign')).toBe(false);
    expect(params(tagged).has('utm_content')).toBe(false);
  });

  it('preserves an existing query string', () => {
    const tagged = withLumaUtm('https://luma-training.com/kurs?type=webinar&sted=oslo', web);
    const q = params(tagged);
    expect(q.get('type')).toBe('webinar');
    expect(q.get('sted')).toBe('oslo');
    expect(q.get('utm_source')).toBe(UTM_SOURCE);
  });

  it('preserves the fragment', () => {
    const tagged = withLumaUtm('https://luma-training.com/kurs#paamelding', web);
    expect(new URL(tagged).hash).toBe('#paamelding');
    expect(params(tagged).get('utm_source')).toBe(UTM_SOURCE);
  });

  it('preserves the path, port and protocol', () => {
    const tagged = withLumaUtm('http://localhost:3000/kurs/ai', web);
    const parsed = new URL(tagged);
    expect(parsed.protocol).toBe('http:');
    expect(parsed.host).toBe('localhost:3000');
    expect(parsed.pathname).toBe('/kurs/ai');
  });

  it('is idempotent — tagging twice never double-appends', () => {
    const once = withLumaUtm('https://luma-training.com/kurs', {
      medium: 'epost',
      campaign: 'paafyll',
    });
    const twice = withLumaUtm(once, { medium: 'epost', campaign: 'paafyll' });
    expect(twice).toBe(once);
    expect(params(twice).getAll('utm_source')).toEqual([UTM_SOURCE]);
  });

  it('replaces rather than duplicates pre-existing UTM parameters', () => {
    const tagged = withLumaUtm(
      'https://luma-training.com/kurs?utm_source=nyhetsbrev&utm_medium=annet&utm_campaign=gammel',
      { medium: 'mcp', campaign: 'ny' },
    );
    const q = params(tagged);
    expect(q.getAll('utm_source')).toEqual([UTM_SOURCE]);
    expect(q.getAll('utm_medium')).toEqual(['mcp']);
    expect(q.getAll('utm_campaign')).toEqual(['ny']);
  });

  it('collapses repeated UTM keys that URLSearchParams.set alone would leave behind', () => {
    const tagged = withLumaUtm(
      'https://luma-training.com/kurs?utm_source=a&utm_source=b&utm_source=c',
      web,
    );
    expect(params(tagged).getAll('utm_source')).toEqual([UTM_SOURCE]);
  });

  it('drops a stale utm_campaign when the new call has none', () => {
    const tagged = withLumaUtm('https://luma-training.com/kurs?utm_campaign=gammel', web);
    expect(params(tagged).has('utm_campaign')).toBe(false);
  });

  it('percent-encodes campaign values', () => {
    const tagged = withLumaUtm('https://luma-training.com/kurs', {
      medium: 'epost',
      campaign: 'påfyll & kurs',
    });
    expect(tagged).toContain('utm_campaign=p%C3%A5fyll+%26+kurs');
    expect(params(tagged).get('utm_campaign')).toBe('påfyll & kurs');
  });

  it.each(['/kurs', 'kurs', '', 'luma-training.com/kurs'])(
    'rejects the relative URL %o',
    (input) => {
      expect(() => withLumaUtm(input, web)).toThrow(/absolutt URL/);
    },
  );

  it.each(['mailto:hei@luma-training.com', 'javascript:alert(1)', 'ftp://luma-training.com'])(
    'rejects the non-http scheme %o',
    (input) => {
      expect(() => withLumaUtm(input, web)).toThrow(/http/);
    },
  );
});

describe('lumaUrl', () => {
  it('builds an absolute tagged URL from a path', () => {
    const url = new URL(lumaUrl('kurs/vinn-flere-anbud-med-ai', { medium: 'landingsside' }));
    expect(url.origin).toBe(new URL(LUMA_BASE_URL).origin);
    expect(url.pathname).toBe('/kurs/vinn-flere-anbud-med-ai');
    expect(url.searchParams.get('utm_source')).toBe(UTM_SOURCE);
  });

  it('normalises leading slashes so paths cannot double up', () => {
    const withSlash = lumaUrl('/kurs', web);
    const withoutSlash = lumaUrl('kurs', web);
    const withManySlashes = lumaUrl('///kurs', web);
    expect(withSlash).toBe(withoutSlash);
    expect(withManySlashes).toBe(withoutSlash);
    expect(new URL(withSlash).pathname).toBe('/kurs');
  });

  it('handles the site root', () => {
    expect(new URL(lumaUrl('', web)).pathname).toBe('/');
    expect(new URL(lumaUrl('/', web)).pathname).toBe('/');
  });
});

describe('isLumaUrl', () => {
  it.each([
    'https://luma-training.com',
    'https://www.luma-training.com/kurs',
    'https://luma-training.com/anbudsvarsling/oversikt',
    // Still a subdomain case, because `mcp.luma-training.com` is one.
    'https://mcp.luma-training.com/mcp',
  ])('accepts %o', (url) => {
    expect(isLumaUrl(url)).toBe(true);
  });

  it.each([
    'https://doffin.no',
    'https://luma-training.com.evil.example',
    'https://notluma-training.com',
    'ikke-en-url',
  ])('rejects %o', (url) => {
    expect(isLumaUrl(url)).toBe(false);
  });
});
