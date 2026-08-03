import type { ConsentEvent } from '@luma/domain';
import { describe, expect, it, vi } from 'vitest';
import { renderAllTemplates } from '../testing/all-templates.js';
import * as f from '../testing/fixtures.js';
import type { RenderedEmail } from '../types.js';
import {
  PostmarkEmailClient,
  type MarketingCampaign,
  type PostmarkOutboundMessage,
  type PostmarkTransport,
} from './client.js';
import {
  MarketingConsentProof,
  MarketingConsentRequiredError,
  isIssuedProof,
  verifyMarketingConsent,
} from './consent.js';
import { FakePostmarkClient } from './fake.js';
import type { StreamIds } from './streams.js';

const STREAMS: StreamIds = {
  transactional: 'transactional',
  tenderNotifications: 'tender-notifications',
  lumaMarketing: 'luma-marketing',
};

const templates = renderAllTemplates();
const magicLink = templates.find((email) => email.template === 'auth-magic-link-v1');
const dailyDigest = templates.find((email) => email.template === 'tender-daily-digest-v1');
if (!magicLink || !dailyDigest) throw new Error('fixtures did not render');

const MAGIC_LINK = magicLink as RenderedEmail<'auth-magic-link-v1'>;
const DAILY_DIGEST = dailyDigest as RenderedEmail<'tender-daily-digest-v1'>;

const CAMPAIGN: MarketingCampaign = {
  campaignId: 'paafyll-2026-03',
  subject: 'Påfyll i mars: tildelingskriterier som faktisk skiller',
  html: '<p>Fra Luma Training</p>',
  text: 'Fra Luma Training',
};

function fakeTransport(): {
  transport: PostmarkTransport;
  sent: PostmarkOutboundMessage[];
  suppress: (email: string, stream: string) => void;
} {
  const sent: PostmarkOutboundMessage[] = [];
  const suppressions = new Map<string, Set<string>>();
  return {
    sent,
    suppress: (email, stream) => {
      const set = suppressions.get(stream) ?? new Set<string>();
      set.add(email.toLowerCase());
      suppressions.set(stream, set);
    },
    transport: {
      async sendEmail(message) {
        sent.push(message);
        return { MessageID: `pm-${sent.length}`, SubmittedAt: '2026-03-12T08:00:00Z' };
      },
      async getSuppressions(messageStream, filter) {
        const set = suppressions.get(messageStream);
        return set?.has(filter.emailAddress.toLowerCase())
          ? { Suppressions: [{ EmailAddress: filter.emailAddress }] }
          : { Suppressions: [] };
      },
    },
  };
}

function client(transport: PostmarkTransport): PostmarkEmailClient {
  return new PostmarkEmailClient({
    transport,
    streams: STREAMS,
    from: 'anbudsvarsling@luma-training.com',
  });
}

describe('stream routing at send time', () => {
  it('sends a magic link on the transactional stream', async () => {
    const harness = fakeTransport();
    const outcome = await client(harness.transport).sendTransactional(MAGIC_LINK, {
      to: f.RECIPIENT_EMAIL,
    });
    expect(outcome.status).toBe('sent');
    expect(harness.sent[0]?.MessageStream).toBe('transactional');
    expect(harness.sent[0]?.Tag).toBe('auth-magic-link-v1');
  });

  it('sends a digest on the tender-notifications stream, with an unsubscribe header', async () => {
    const harness = fakeTransport();
    await client(harness.transport).sendTenderNotification(DAILY_DIGEST, {
      to: f.RECIPIENT_EMAIL,
      unsubscribeUrl: 'https://anbudsvarsling.luma-training.com/innstillinger?handling=avslutt',
    });
    expect(harness.sent[0]?.MessageStream).toBe('tender-notifications');
    expect(harness.sent[0]?.Headers?.map((header) => header.Name)).toEqual([
      'List-Unsubscribe',
      'List-Unsubscribe-Post',
    ]);
  });

  it('does not let a caller choose the stream', () => {
    // The send methods take a template, never a stream. This is a type-level
    // property; the assertion here is that the runtime object has no such API.
    const instance = client(fakeTransport().transport) as unknown as Record<string, unknown>;
    expect(Object.keys(PostmarkEmailClient.prototype)).not.toContain('sendOnStream');
    expect(instance['sendOnStream']).toBeUndefined();
  });

  it('rejects a digest on the transactional stream at compile time', async () => {
    const harness = fakeTransport();
    const emailClient = client(harness.transport);
    // @ts-expect-error tender-daily-digest-v1 is not a transactional template.
    await emailClient.sendTransactional(DAILY_DIGEST, { to: f.RECIPIENT_EMAIL });
    // @ts-expect-error auth-magic-link-v1 is not a tender-notification template.
    await emailClient.sendTenderNotification(MAGIC_LINK, { to: f.RECIPIENT_EMAIL });
    // Both calls still reach Postmark, because a type error is not a runtime
    // guard. What stops them is that the code does not compile.
    expect(harness.sent).toHaveLength(2);
  });
});

describe('suppression (spec section 27)', () => {
  it('never sends to a suppressed address', async () => {
    const harness = fakeTransport();
    harness.suppress(f.RECIPIENT_EMAIL, 'transactional');
    const outcome = await client(harness.transport).sendTransactional(MAGIC_LINK, {
      to: f.RECIPIENT_EMAIL,
    });
    expect(outcome).toEqual({
      status: 'suppressed',
      stream: 'transactional',
      reason: 'address_suppressed',
    });
    expect(harness.sent).toHaveLength(0);
  });

  it('scopes suppression per stream (ADR-0005)', async () => {
    const harness = fakeTransport();
    harness.suppress(f.RECIPIENT_EMAIL, 'luma-marketing');
    const emailClient = client(harness.transport);

    expect(await emailClient.isSuppressed(f.RECIPIENT_EMAIL, 'luma-marketing')).toBe(true);
    expect(await emailClient.isSuppressed(f.RECIPIENT_EMAIL, 'transactional')).toBe(false);

    const outcome = await emailClient.sendTransactional(MAGIC_LINK, { to: f.RECIPIENT_EMAIL });
    expect(outcome.status).toBe('sent');
  });
});

describe('marketing consent cannot be bypassed', () => {
  const granted: ConsentEvent[] = [f.marketingConsentEvent()];
  const withdrawn: ConsentEvent[] = [
    f.marketingConsentEvent(),
    f.marketingConsentEvent({
      id: '77777777-7777-4777-8777-000000000002',
      status: 'withdrawn',
      occurredAt: new Date('2026-03-01T12:00:00.000Z'),
      createdAt: new Date('2026-03-01T12:00:00.000Z'),
    }),
  ];

  function proofFor(email: string, events: ConsentEvent[] = granted): MarketingConsentProof {
    const verification = verifyMarketingConsent({ email, consentEvents: events });
    if (verification.status !== 'granted') throw new Error('expected consent');
    return verification.proof;
  }

  it('derives consent from the append-only event log', () => {
    expect(verifyMarketingConsent({ email: f.RECIPIENT_EMAIL, consentEvents: [] })).toEqual({
      status: 'never_given',
    });
    expect(
      verifyMarketingConsent({ email: f.RECIPIENT_EMAIL, consentEvents: withdrawn }).status,
    ).toBe('withdrawn');
    expect(
      verifyMarketingConsent({ email: f.RECIPIENT_EMAIL, consentEvents: granted }).status,
    ).toBe('granted');
  });

  it('sends a campaign when a real proof is supplied', async () => {
    const harness = fakeTransport();
    const outcome = await client(harness.transport).sendMarketingCampaign(
      CAMPAIGN,
      proofFor(f.RECIPIENT_EMAIL),
      { to: f.RECIPIENT_EMAIL },
    );
    expect(outcome.status).toBe('sent');
    expect(harness.sent[0]?.MessageStream).toBe('luma-marketing');
    expect(harness.sent[0]?.Tag).toBe(CAMPAIGN.campaignId);
  });

  it('does not compile without a proof', () => {
    const emailClient = client(fakeTransport().transport);
    // Never invoked. It exists so that the compiler checks the call shape:
    // omitting the proof is an error, which `@ts-expect-error` asserts.
    const compileOnly = (): unknown =>
      // @ts-expect-error the proof argument is required.
      emailClient.sendMarketingCampaign(CAMPAIGN, { to: f.RECIPIENT_EMAIL });
    expect(typeof compileOnly).toBe('function');
  });

  it('does not compile with a boolean, and throws when one is forced through', async () => {
    const harness = fakeTransport();
    const emailClient = client(harness.transport);

    await expect(
      emailClient.sendMarketingCampaign(
        CAMPAIGN,
        // @ts-expect-error a truthy value is not a MarketingConsentProof.
        true,
        { to: f.RECIPIENT_EMAIL },
      ),
    ).rejects.toBeInstanceOf(MarketingConsentRequiredError);
    expect(harness.sent).toHaveLength(0);
  });

  it('rejects a hand-made look-alike object', async () => {
    const harness = fakeTransport();
    const forged = {
      email: f.RECIPIENT_EMAIL,
      consentTextVersion: '2026-01-15',
      consentEventId: 'x',
      verifiedAt: new Date(),
    } as unknown as MarketingConsentProof;

    expect(isIssuedProof(forged)).toBe(false);
    await expect(
      client(harness.transport).sendMarketingCampaign(CAMPAIGN, forged, {
        to: f.RECIPIENT_EMAIL,
      }),
    ).rejects.toMatchObject({ reason: 'forged_proof' });
    expect(harness.sent).toHaveLength(0);
  });

  it('rejects an instance conjured past the constructor', async () => {
    const harness = fakeTransport();
    const conjured = Object.create(MarketingConsentProof.prototype) as MarketingConsentProof;
    expect(conjured).toBeInstanceOf(MarketingConsentProof);
    expect(isIssuedProof(conjured)).toBe(false);
    await expect(
      client(harness.transport).sendMarketingCampaign(CAMPAIGN, conjured, {
        to: f.RECIPIENT_EMAIL,
      }),
    ).rejects.toMatchObject({ reason: 'forged_proof' });
  });

  it('cannot be constructed directly', () => {
    expect(
      () =>
        new MarketingConsentProof(
          Symbol('not-the-issuer'),
          f.RECIPIENT_EMAIL,
          '2026-01-15',
          'x',
          new Date(),
        ),
    ).toThrow(/verifyMarketingConsent/);
  });

  it('refuses a proof issued for a different recipient', async () => {
    const harness = fakeTransport();
    await expect(
      client(harness.transport).sendMarketingCampaign(
        CAMPAIGN,
        proofFor('someone.else@example.no'),
        { to: f.RECIPIENT_EMAIL },
      ),
    ).rejects.toMatchObject({ reason: 'recipient_mismatch' });
    expect(harness.sent).toHaveLength(0);
  });

  it('performs no Postmark call at all when consent was withdrawn', async () => {
    const harness = fakeTransport();
    const suppressionSpy = vi.spyOn(harness.transport, 'getSuppressions');
    const verification = verifyMarketingConsent({
      email: f.RECIPIENT_EMAIL,
      consentEvents: withdrawn,
    });
    expect(verification.status).toBe('withdrawn');
    // With no proof to pass, there is nothing to call the send function with.
    await expect(
      client(harness.transport).sendMarketingCampaign(
        CAMPAIGN,
        undefined as unknown as MarketingConsentProof,
        { to: f.RECIPIENT_EMAIL },
      ),
    ).rejects.toMatchObject({ reason: 'missing_proof' });
    expect(harness.sent).toHaveLength(0);
    expect(suppressionSpy).not.toHaveBeenCalled();
  });
});

describe('FakePostmarkClient', () => {
  it('records what was sent, per stream', async () => {
    const fake = new FakePostmarkClient({ now: () => f.FIXED_NOW });
    await fake.sendTransactional(MAGIC_LINK, { to: f.RECIPIENT_EMAIL });
    await fake.sendTenderNotification(DAILY_DIGEST, { to: f.RECIPIENT_EMAIL });

    expect(fake.sent).toHaveLength(2);
    expect(fake.sentOnStream('transactional').map((email) => email.template)).toEqual([
      'auth-magic-link-v1',
    ]);
    expect(fake.sentWithTemplate('tender-daily-digest-v1')).toHaveLength(1);
    expect(fake.lastSent()?.subject).toBe(DAILY_DIGEST.subject);
  });

  it('honours suppression the same way the real client does', async () => {
    const fake = new FakePostmarkClient();
    fake.suppress(f.RECIPIENT_EMAIL, 'tender-notifications');
    const outcome = await fake.sendTenderNotification(DAILY_DIGEST, { to: f.RECIPIENT_EMAIL });
    expect(outcome.status).toBe('suppressed');
    expect(fake.sent).toHaveLength(0);

    // and does not leak across streams
    expect((await fake.sendTransactional(MAGIC_LINK, { to: f.RECIPIENT_EMAIL })).status).toBe(
      'sent',
    );
  });

  it('enforces the consent proof, so tests cannot pass what production would reject', async () => {
    const fake = new FakePostmarkClient();
    await expect(
      fake.sendMarketingCampaign(CAMPAIGN, {} as unknown as MarketingConsentProof, {
        to: f.RECIPIENT_EMAIL,
      }),
    ).rejects.toBeInstanceOf(MarketingConsentRequiredError);
    expect(fake.sent).toHaveLength(0);
  });
});
