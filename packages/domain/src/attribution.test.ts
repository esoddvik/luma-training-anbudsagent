import { describe, expect, it } from 'vitest';
import { UTM_SOURCE, withUtm } from './attribution.js';

describe('withUtm', () => {
  it('tags a bare link with source and medium', () => {
    const url = new URL(withUtm('https://luma-training.com/paafyll', { medium: 'digest' }));
    expect(url.searchParams.get('utm_source')).toBe(UTM_SOURCE);
    expect(url.searchParams.get('utm_medium')).toBe('digest');
  });

  it('adds the campaign when one is given', () => {
    const url = new URL(
      withUtm('https://luma-training.com/paafyll', {
        medium: 'digest',
        campaign: 'paafyll-juni',
      }),
    );
    expect(url.searchParams.get('utm_campaign')).toBe('paafyll-juni');
  });

  it('omits campaign and content when not given', () => {
    const url = new URL(withUtm('https://luma-training.com/kurs', { medium: 'landing' }));
    expect(url.searchParams.has('utm_campaign')).toBe(false);
    expect(url.searchParams.has('utm_content')).toBe(false);
  });

  it('preserves an existing query string', () => {
    const url = new URL(
      withUtm('https://luma-training.com/kurs?dato=2026-09-01', { medium: 'tender_detail' }),
    );
    expect(url.searchParams.get('dato')).toBe('2026-09-01');
    expect(url.searchParams.get('utm_source')).toBe(UTM_SOURCE);
  });

  it('preserves the path and the fragment', () => {
    const tagged = withUtm('https://luma-training.com/kurs/ai#program', { medium: 'digest' });
    const url = new URL(tagged);
    expect(url.pathname).toBe('/kurs/ai');
    expect(url.hash).toBe('#program');
  });

  it('is idempotent: tagging twice equals tagging once', () => {
    const once = withUtm('https://luma-training.com/paafyll', {
      medium: 'digest',
      campaign: 'juni',
    });
    const twice = withUtm(once, { medium: 'digest', campaign: 'juni' });
    expect(twice).toBe(once);
  });

  it('overwrites rather than duplicates a stale utm value', () => {
    const retagged = withUtm('https://luma-training.com/paafyll?utm_medium=old', {
      medium: 'shared_view',
    });
    expect(retagged.match(/utm_medium=/g)).toHaveLength(1);
    expect(new URL(retagged).searchParams.get('utm_medium')).toBe('shared_view');
  });

  it('throws on a malformed url rather than emitting an untracked link', () => {
    expect(() => withUtm('not a url', { medium: 'digest' })).toThrow();
  });
});
