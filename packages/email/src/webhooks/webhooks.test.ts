import { describe, expect, it } from 'vitest';
import type { StreamKind } from '../postmark/streams.js';
import { authenticateWebhook, basicAuthHeader, type WebhookCredentials } from './auth.js';
import { assertNoCrossStreamEffect, deriveIntents, type WebhookIntent } from './intents.js';
import { InMemoryWebhookIdempotencyStore, processPostmarkWebhook } from './process.js';
import { idempotencyKey, parseWebhookEvent, recipientOf } from './schema.js';

const CREDENTIALS: WebhookCredentials = {
  username: 'postmark-hook',
  password: 'et-langt-og-tilfeldig-passord-1234567890',
};

const RECIPIENT = 'ingrid.nordvik@nordvikbygg.no';

const delivery = {
  RecordType: 'Delivery',
  ServerID: 1234,
  MessageStream: 'tender-notifications',
  MessageID: '883953f4-6105-42a2-a16a-77a8eac79483',
  Recipient: RECIPIENT,
  Tag: 'tender-daily-digest-v1',
  DeliveredAt: '2026-03-12T08:01:12Z',
  Details: 'smtp;250 2.0.0 OK',
};

const hardBounce = {
  RecordType: 'Bounce',
  ID: 42,
  Type: 'HardBounce',
  TypeCode: 1,
  Name: 'Hard bounce',
  MessageID: 'c1b2a3d4-0000-0000-0000-000000000001',
  MessageStream: 'transactional',
  Tag: 'auth-magic-link-v1',
  Description: 'The server was unable to deliver your message.',
  Email: RECIPIENT,
  From: 'anbudsvarsling@luma-training.com',
  BouncedAt: '2026-03-12T08:02:00Z',
  Inactive: true,
  CanActivate: true,
};

const spamComplaint = {
  ...hardBounce,
  RecordType: 'SpamComplaint',
  Type: 'SpamComplaint',
  MessageID: 'c1b2a3d4-0000-0000-0000-000000000002',
  MessageStream: 'luma-marketing',
  Tag: 'paafyll-2026-03',
};

const marketingUnsubscribe = {
  RecordType: 'SubscriptionChange',
  MessageID: 'c1b2a3d4-0000-0000-0000-000000000003',
  ServerID: 1234,
  MessageStream: 'luma-marketing',
  ChangedAt: '2026-03-12T08:03:00Z',
  Recipient: RECIPIENT,
  Origin: 'Recipient',
  SuppressSending: true,
  SuppressionReason: null,
  Tag: 'paafyll-2026-03',
};

const tenderUnsubscribe = {
  ...marketingUnsubscribe,
  MessageID: 'c1b2a3d4-0000-0000-0000-000000000004',
  MessageStream: 'tender-notifications',
  Tag: 'tender-daily-digest-v1',
};

const clickEvent = {
  RecordType: 'Click',
  MessageID: 'c1b2a3d4-0000-0000-0000-000000000005',
  MessageStream: 'tender-notifications',
  Recipient: RECIPIENT,
  ReceivedAt: '2026-03-12T09:00:00Z',
  OriginalLink: 'https://anbudsvarsling.luma-training.com/anbud/22222222?utm_source=anbudsvarsling',
  ClickLocation: 'HTML',
  Tag: 'tender-daily-digest-v1',
};

async function process(
  body: unknown,
  stream: StreamKind,
  store = new InMemoryWebhookIdempotencyStore(),
) {
  return processPostmarkWebhook({
    stream,
    authorizationHeader: basicAuthHeader(CREDENTIALS),
    credentials: CREDENTIALS,
    body,
    store,
  });
}

describe('webhook authentication (spec section 27)', () => {
  it('accepts the configured credentials', () => {
    expect(authenticateWebhook(basicAuthHeader(CREDENTIALS), CREDENTIALS)).toEqual({ ok: true });
  });

  it('rejects a missing header', () => {
    expect(authenticateWebhook(undefined, CREDENTIALS)).toEqual({
      ok: false,
      reason: 'missing_header',
    });
  });

  it('rejects a malformed header', () => {
    expect(authenticateWebhook('Bearer abc', CREDENTIALS).ok).toBe(false);
    expect(authenticateWebhook('Basic', CREDENTIALS).ok).toBe(false);
    expect(
      authenticateWebhook(`Basic ${Buffer.from('nocolon').toString('base64')}`, CREDENTIALS),
    ).toEqual({ ok: false, reason: 'malformed_header' });
  });

  it('rejects wrong credentials, including a password that is a prefix of the real one', () => {
    expect(
      authenticateWebhook(
        basicAuthHeader({ ...CREDENTIALS, password: 'et-langt-og-tilfeldig-passord' }),
        CREDENTIALS,
      ),
    ).toEqual({ ok: false, reason: 'bad_credentials' });
    expect(
      authenticateWebhook(basicAuthHeader({ username: 'someone', password: '' }), CREDENTIALS).ok,
    ).toBe(false);
  });

  it('answers 401 before parsing the body', async () => {
    const outcome = await processPostmarkWebhook({
      stream: 'tender-notifications',
      authorizationHeader: 'Basic ' + Buffer.from('a:b').toString('base64'),
      credentials: CREDENTIALS,
      body: { nonsense: true },
      store: new InMemoryWebhookIdempotencyStore(),
    });
    expect(outcome.status).toBe(401);
  });
});

describe('payload validation', () => {
  it('parses each supported record type', () => {
    for (const body of [delivery, hardBounce, spamComplaint, marketingUnsubscribe, clickEvent]) {
      const parsed = parseWebhookEvent(body);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(recipientOf(parsed.event)).toBe(RECIPIENT);
    }
  });

  it('keeps unknown Postmark fields instead of rejecting the delivery', () => {
    const parsed = parseWebhookEvent({ ...delivery, SomeNewFieldPostmarkAdded: 'x' });
    expect(parsed.ok).toBe(true);
  });

  it('rejects an unknown record type with 400', async () => {
    const outcome = await process({ RecordType: 'Telepathy' }, 'tender-notifications');
    expect(outcome.status).toBe(400);
  });

  it('rejects a payload missing a field we act on', async () => {
    const { MessageID: _ignored, ...withoutId } = delivery;
    const outcome = await process(withoutId, 'tender-notifications');
    expect(outcome.status).toBe(400);
  });
});

describe('idempotency (spec section 27)', () => {
  it('keys on MessageID plus event type', () => {
    const parsed = parseWebhookEvent(delivery);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(idempotencyKey(parsed.event)).toBe(`Delivery:${delivery.MessageID}`);
  });

  it('processes a redelivered payload exactly once', async () => {
    const store = new InMemoryWebhookIdempotencyStore();
    const first = await process(delivery, 'tender-notifications', store);
    const second = await process(delivery, 'tender-notifications', store);

    expect(first.outcome).toBe('accepted');
    expect(second.outcome).toBe('duplicate');
    expect(second.status).toBe(200);
    expect(second.intents).toEqual([]);
    expect(store.size).toBe(1);
  });

  it('treats a different event type on the same message as a new event', async () => {
    const store = new InMemoryWebhookIdempotencyStore();
    await process(delivery, 'tender-notifications', store);
    const open = await process(
      {
        RecordType: 'Open',
        MessageID: delivery.MessageID,
        MessageStream: 'tender-notifications',
        Recipient: RECIPIENT,
        ReceivedAt: '2026-03-12T09:30:00Z',
        FirstOpen: true,
      },
      'tender-notifications',
      store,
    );
    expect(open.outcome).toBe('accepted');
    expect(store.size).toBe(2);
  });
});

function kinds(intents: readonly WebhookIntent[]): string[] {
  return intents.map((intent) => intent.kind);
}

describe('suppression and category handling', () => {
  it('suppresses on a hard bounce and escalates when it is account-critical', async () => {
    const outcome = await process(hardBounce, 'transactional');
    expect(outcome.status).toBe(200);
    if (outcome.outcome !== 'accepted') throw new Error('expected acceptance');
    expect(kinds(outcome.intents)).toEqual([
      'record_email_event',
      'suppress_recipient',
      'alert_admin',
    ]);
    expect(outcome.intents).toContainEqual({
      kind: 'suppress_recipient',
      recipient: RECIPIENT,
      stream: 'transactional',
      cause: 'hard_bounce',
    });
  });

  it('does not suppress on a soft bounce', async () => {
    const outcome = await process(
      { ...hardBounce, Type: 'SoftBounce', MessageID: 'soft-1' },
      'tender-notifications',
    );
    if (outcome.outcome !== 'accepted') throw new Error('expected acceptance');
    expect(kinds(outcome.intents)).toEqual(['record_email_event']);
  });

  it('suppresses and warns on a spam complaint', async () => {
    const outcome = await process(spamComplaint, 'luma-marketing');
    if (outcome.outcome !== 'accepted') throw new Error('expected acceptance');
    expect(kinds(outcome.intents)).toContain('suppress_recipient');
    expect(outcome.intents).toContainEqual({
      kind: 'alert_admin',
      severity: 'warning',
      reason: 'spam_complaint',
      recipient: RECIPIENT,
    });
  });

  it('reactivates when Postmark reports the suppression lifted', async () => {
    const outcome = await process(
      { ...marketingUnsubscribe, MessageID: 'resub-1', SuppressSending: false },
      'luma-marketing',
    );
    if (outcome.outcome !== 'accepted') throw new Error('expected acceptance');
    expect(kinds(outcome.intents)).toEqual(['record_email_event', 'reactivate_recipient']);
  });

  it('records engagement without any suppression effect', async () => {
    const outcome = await process(clickEvent, 'tender-notifications');
    if (outcome.outcome !== 'accepted') throw new Error('expected acceptance');
    expect(kinds(outcome.intents)).toEqual(['record_email_event', 'record_engagement']);
  });
});

/**
 * The rule ADR-0005 exists for, and spec section 27's last requirement:
 * "ikke deaktiver kontokritisk e-post ved avmelding fra markedsføring".
 */
describe('a marketing unsubscribe never touches account-critical email', () => {
  it('suppresses only on luma-marketing and withdraws only marketing consent', async () => {
    const outcome = await process(marketingUnsubscribe, 'luma-marketing');
    if (outcome.outcome !== 'accepted') throw new Error('expected acceptance');

    const suppressions = outcome.intents.filter((intent) => intent.kind === 'suppress_recipient');
    expect(suppressions).toEqual([
      {
        kind: 'suppress_recipient',
        recipient: RECIPIENT,
        stream: 'luma-marketing',
        cause: 'recipient_unsubscribe',
      },
    ]);

    expect(kinds(outcome.intents)).toContain('withdraw_marketing_consent');
    expect(kinds(outcome.intents)).not.toContain('disable_tender_alerts');
    // Nothing here can stop a magic link or a tender alert.
    for (const intent of outcome.intents) {
      if (intent.kind === 'suppress_recipient') {
        expect(intent.stream).toBe('luma-marketing');
      }
    }
  });

  it('conversely, a tender-alert unsubscribe leaves marketing consent alone', async () => {
    const outcome = await process(tenderUnsubscribe, 'tender-notifications');
    if (outcome.outcome !== 'accepted') throw new Error('expected acceptance');
    expect(kinds(outcome.intents)).toContain('disable_tender_alerts');
    expect(kinds(outcome.intents)).not.toContain('withdraw_marketing_consent');
    expect(
      outcome.intents.every(
        (intent) =>
          intent.kind !== 'suppress_recipient' || intent.stream === 'tender-notifications',
      ),
    ).toBe(true);
  });

  it('escalates rather than silently suppressing account-critical mail', async () => {
    const outcome = await process(
      { ...marketingUnsubscribe, MessageID: 'tx-unsub-1', MessageStream: 'transactional' },
      'transactional',
    );
    if (outcome.outcome !== 'accepted') throw new Error('expected acceptance');
    expect(kinds(outcome.intents)).toContain('alert_admin');
    expect(kinds(outcome.intents)).not.toContain('withdraw_marketing_consent');
  });

  it('CAN FAIL: the cross-stream guard rejects an effect on another stream', () => {
    const smuggled: WebhookIntent[] = [
      {
        kind: 'suppress_recipient',
        recipient: RECIPIENT,
        stream: 'transactional',
        cause: 'spam_complaint',
      },
    ];
    expect(() => assertNoCrossStreamEffect(smuggled, 'luma-marketing')).toThrow(
      /kontokritisk e-post/,
    );
    expect(() => assertNoCrossStreamEffect(smuggled, 'transactional')).not.toThrow();
  });
});

describe('the endpoint stream wins over the payload', () => {
  it('ignores a MessageStream in the body that disagrees with the route', async () => {
    const outcome = await process(
      { ...spamComplaint, MessageStream: 'transactional', MessageID: 'liar-1' },
      'luma-marketing',
    );
    if (outcome.outcome !== 'accepted') throw new Error('expected acceptance');
    for (const intent of outcome.intents) {
      if (intent.kind === 'suppress_recipient') expect(intent.stream).toBe('luma-marketing');
    }
  });
});

describe('no side effects performed here', () => {
  it('returns intents for the queue rather than doing the work', async () => {
    const outcome = await process(hardBounce, 'transactional');
    if (outcome.outcome !== 'accepted') throw new Error('expected acceptance');
    expect(deriveIntents).toBeTypeOf('function');
    // Every intent is data: serialisable, and safe to hand to a queue job.
    expect(() => JSON.stringify(outcome.intents)).not.toThrow();
  });
});
