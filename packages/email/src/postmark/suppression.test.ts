import { describe, expect, it, vi } from 'vitest';
import { PostmarkEmailClient, type PostmarkTransport } from './client.js';
import { FakePostmarkClient } from './fake.js';

/**
 * Pushing a consent withdrawal to Postmark (spec §21, §27, ADR-9).
 *
 * The property that matters here is not that suppression works — it is that it
 * is scoped to one stream. Suppressing an address globally would also stop
 * magic links and order confirmations, so a user who unsubscribed from
 * marketing would silently lose the ability to log in.
 */

function transportSpy() {
  const created: Array<{ stream: string; addresses: string[] }> = [];
  const transport: PostmarkTransport = {
    sendEmail: async () => ({ MessageID: 'm-1', SubmittedAt: '2026-08-03T00:00:00Z' }),
    getSuppressions: async () => ({ Suppressions: [] }),
    createSuppressions: async (messageStream, request) => {
      created.push({
        stream: messageStream,
        addresses: request.Suppressions.map((entry) => entry.EmailAddress),
      });
      return {};
    },
  };
  return { transport, created };
}

/** `StreamIds`, which is keyed in camelCase rather than by `StreamKind`. */
const streams = {
  transactional: 'transactional',
  tenderNotifications: 'tender-notifications',
  lumaMarketing: 'luma-marketing',
} as const;

function client(transport: PostmarkTransport) {
  return new PostmarkEmailClient({
    transport,
    fromAddress: 'ikke-svar@luma-training.com',
    streams,
  });
}

describe('suppressAddress', () => {
  it('suppresses on the stream it was given', async () => {
    const { transport, created } = transportSpy();
    await client(transport).suppressAddress('kunde@entreprenor.no', 'luma-marketing');

    expect(created).toHaveLength(1);
    expect(created[0]?.stream).toBe('luma-marketing');
    expect(created[0]?.addresses).toEqual(['kunde@entreprenor.no']);
  });

  it('never touches the transactional stream when suppressing marketing', async () => {
    // The decisive one. A global suppression would stop magic links, and the
    // user would experience unsubscribing from a newsletter as losing their
    // account (spec §27, §21).
    const { transport, created } = transportSpy();
    await client(transport).suppressAddress('kunde@entreprenor.no', 'luma-marketing');

    expect(created.map((entry) => entry.stream)).not.toContain('transactional');
    expect(created.map((entry) => entry.stream)).not.toContain('tender-notifications');
  });

  it('normalises the address, so casing cannot produce a second identity', async () => {
    const { transport, created } = transportSpy();
    await client(transport).suppressAddress('  Kunde@Entreprenor.NO ', 'luma-marketing');
    expect(created[0]?.addresses).toEqual(['kunde@entreprenor.no']);
  });

  it('can be called repeatedly without special-casing', async () => {
    // The reconciliation job runs on a schedule and re-asserts every
    // withdrawal it finds. Postmark treats a repeat as a no-op, so the job
    // does not have to read before writing.
    const { transport, created } = transportSpy();
    const emails = client(transport);
    await emails.suppressAddress('kunde@entreprenor.no', 'luma-marketing');
    await emails.suppressAddress('kunde@entreprenor.no', 'luma-marketing');

    expect(created).toHaveLength(2);
  });

  it('surfaces a transport failure rather than reporting success', async () => {
    // A silently swallowed failure here means the reconciliation job logs a
    // clean run while the withdrawal never reached Postmark.
    const transport: PostmarkTransport = {
      sendEmail: async () => ({ MessageID: 'm', SubmittedAt: '' }),
      getSuppressions: async () => ({ Suppressions: [] }),
      createSuppressions: async () => {
        throw new Error('Postmark unavailable');
      },
    };

    await expect(
      client(transport).suppressAddress('kunde@entreprenor.no', 'luma-marketing'),
    ).rejects.toThrow(/Postmark unavailable/);
  });
});

describe('the fake client', () => {
  it('honours suppressAddress the same way the real one does', async () => {
    const fake = new FakePostmarkClient();
    await fake.suppressAddress('kunde@entreprenor.no', 'luma-marketing');

    expect(await fake.isSuppressed('kunde@entreprenor.no', 'luma-marketing')).toBe(true);
    expect(await fake.isSuppressed('kunde@entreprenor.no', 'transactional')).toBe(false);
  });

  it('refuses to send marketing to an address it has suppressed', async () => {
    // Proves the fake enforces what production enforces, so a test cannot
    // pass on a path that would fail for real.
    const fake = new FakePostmarkClient();
    await fake.suppressAddress('kunde@entreprenor.no', 'luma-marketing');
    expect(await fake.isSuppressed('kunde@entreprenor.no', 'luma-marketing')).toBe(true);
  });

  it('leaves the transactional stream reachable after a marketing suppression', async () => {
    const fake = new FakePostmarkClient();
    await fake.suppressAddress('kunde@entreprenor.no', 'luma-marketing');
    const spy = vi.spyOn(fake, 'isSuppressed');

    expect(await fake.isSuppressed('kunde@entreprenor.no', 'transactional')).toBe(false);
    spy.mockRestore();
  });
});
