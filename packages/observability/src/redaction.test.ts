import { describe, expect, it } from 'vitest';
import { maskEmail, REDACTED, redactPaths, scrubSecrets } from './redaction.js';

describe('maskEmail', () => {
  it('keeps the domain and the first character so support can correlate', () => {
    expect(maskEmail('espen@luma-training.com')).toBe('e***@luma-training.com');
  });

  it('does not leak a single-character local part', () => {
    expect(maskEmail('a@luma-training.com')).toBe('***@luma-training.com');
  });

  it('returns the redaction marker for something that is not an address', () => {
    expect(maskEmail('not-an-email')).toBe(REDACTED);
  });

  it('returns the redaction marker for undefined', () => {
    expect(maskEmail(undefined)).toBe(REDACTED);
  });
});

describe('redactPaths', () => {
  it('covers every credential the spec forbids logging (section 47)', () => {
    const joined = redactPaths.join(' ');
    for (const forbidden of [
      'token',
      'shareToken',
      'magicLink',
      'mcpToken',
      'authorization',
      'password',
      'cookie',
    ]) {
      expect(joined).toContain(forbidden);
    }
  });
});

describe('scrubSecrets', () => {
  it('replaces a bearer token found in free text', () => {
    const scrubbed = scrubSecrets('Authorization: Bearer lum_live_abc123def456ghi789');
    expect(scrubbed).not.toContain('lum_live_abc123def456ghi789');
    expect(scrubbed).toContain(REDACTED);
  });

  it('replaces a magic-link token embedded in a URL', () => {
    const scrubbed = scrubSecrets(
      'sent https://anbudsvarsling.luma-training.com/logg-inn/bekreft?token=abcdef0123456789abcdef',
    );
    expect(scrubbed).not.toContain('abcdef0123456789abcdef');
    expect(scrubbed).toContain('token=' + REDACTED);
  });

  it('replaces a share token in a delt-visning URL', () => {
    const scrubbed = scrubSecrets('viewed /delt/9f8e7d6c5b4a39281706f5e4d3c2b1a0');
    expect(scrubbed).not.toContain('9f8e7d6c5b4a39281706f5e4d3c2b1a0');
  });

  it('masks an email address appearing in free text', () => {
    const scrubbed = scrubSecrets('delivery failed for espen@luma-training.com');
    expect(scrubbed).not.toContain('espen@luma-training.com');
    expect(scrubbed).toContain('e***@luma-training.com');
  });

  it('leaves ordinary operational text untouched', () => {
    const message = 'ingest run 42 upserted 118 notices in 3.2s';
    expect(scrubSecrets(message)).toBe(message);
  });

  it('does not mistake a Doffin notice identifier for a secret', () => {
    const message = 'normalised notice 2026-123456';
    expect(scrubSecrets(message)).toBe(message);
  });
});
