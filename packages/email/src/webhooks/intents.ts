import type { StreamKind } from '../postmark/streams.js';
import {
  occurredAtOf,
  recipientOf,
  type PostmarkRecordType,
  type PostmarkWebhookEvent,
} from './schema.js';

/**
 * What a webhook event means, expressed as intents for the caller to carry out.
 *
 * This package has no database (ADR-0001 keeps the boundary), so nothing here
 * writes. The HTTP layer answers Postmark immediately and hands the intents to
 * the `postmark.webhook.process` queue job, which is what spec section 27
 * means by "respond fast, queue slow work".
 *
 * The rule this file exists to enforce is the one in spec section 21 and
 * ADR-0005: **unsubscribing from marketing must not disable account-critical
 * email.** Every suppression intent names exactly one stream, the stream the
 * event arrived on, and no derivation ever widens it. A marketing unsubscribe
 * produces a marketing suppression and a marketing consent withdrawal, and
 * nothing else. `assertNoCrossStreamEffect` re-checks that at runtime.
 */

export type SuppressionCause =
  'hard_bounce' | 'spam_complaint' | 'manual_suppression' | 'recipient_unsubscribe';

export type WebhookIntent =
  /** Always emitted. The row that makes admin (spec section 45) possible. */
  | {
      readonly kind: 'record_email_event';
      readonly recordType: PostmarkRecordType;
      readonly messageId: string;
      readonly stream: StreamKind;
      readonly recipient: string;
      readonly occurredAt: string;
      readonly tag?: string;
      readonly detail?: string;
    }
  | {
      readonly kind: 'suppress_recipient';
      readonly recipient: string;
      /** Exactly one stream. Suppression is never widened. */
      readonly stream: StreamKind;
      readonly cause: SuppressionCause;
    }
  | {
      readonly kind: 'reactivate_recipient';
      readonly recipient: string;
      readonly stream: StreamKind;
    }
  /** Marketing consent withdrawn through Postmark's unsubscribe (spec 21). */
  | {
      readonly kind: 'withdraw_marketing_consent';
      readonly recipient: string;
      readonly occurredAt: string;
    }
  /** The user stopped tender alerts. Marketing consent is untouched. */
  | {
      readonly kind: 'disable_tender_alerts';
      readonly recipient: string;
      readonly occurredAt: string;
    }
  | {
      readonly kind: 'alert_admin';
      readonly severity: 'warning' | 'critical';
      readonly reason:
        'transactional_delivery_failure' | 'spam_complaint' | 'transactional_suppression';
      readonly recipient: string;
      readonly detail?: string;
    }
  | {
      readonly kind: 'record_engagement';
      readonly engagement: 'open' | 'click';
      readonly recipient: string;
      readonly messageId: string;
      readonly stream: StreamKind;
      readonly occurredAt: string;
      readonly url?: string;
    };

/** Postmark bounce types that mean the address is permanently unusable. */
const PERMANENT_BOUNCE_TYPES: ReadonlySet<string> = new Set([
  'HardBounce',
  'BadEmailAddress',
  'ManuallyDeactivated',
  'Blocked',
  'SpamNotification',
]);

function baseEvent(event: PostmarkWebhookEvent, stream: StreamKind): WebhookIntent {
  const tag = event.Tag;
  return {
    kind: 'record_email_event',
    recordType: event.RecordType,
    messageId: event.MessageID,
    stream,
    recipient: recipientOf(event),
    occurredAt: occurredAtOf(event),
    ...(tag ? { tag } : {}),
  };
}

/**
 * Derives the side effects of one event on one stream.
 *
 * `stream` is the stream the webhook endpoint is mounted on, not a value read
 * out of the payload. A payload cannot talk its way onto another stream.
 */
export function deriveIntents(event: PostmarkWebhookEvent, stream: StreamKind): WebhookIntent[] {
  const recipient = recipientOf(event);
  const occurredAt = occurredAtOf(event);
  const intents: WebhookIntent[] = [baseEvent(event, stream)];

  switch (event.RecordType) {
    case 'Delivery':
      break;

    case 'Bounce': {
      if (PERMANENT_BOUNCE_TYPES.has(event.Type)) {
        intents.push({
          kind: 'suppress_recipient',
          recipient,
          stream,
          cause: 'hard_bounce',
        });
        if (stream === 'transactional') {
          // ADR-0005: a hard bounce on account-critical mail is an
          // account-level problem, surfaced rather than silently swallowed.
          intents.push({
            kind: 'alert_admin',
            severity: 'critical',
            reason: 'transactional_delivery_failure',
            recipient,
            ...(event.Description ? { detail: event.Description } : {}),
          });
        }
      }
      break;
    }

    case 'SpamComplaint': {
      intents.push({
        kind: 'suppress_recipient',
        recipient,
        stream,
        cause: 'spam_complaint',
      });
      intents.push({
        kind: 'alert_admin',
        severity: stream === 'transactional' ? 'critical' : 'warning',
        reason: 'spam_complaint',
        recipient,
      });
      break;
    }

    case 'SubscriptionChange': {
      if (!event.SuppressSending) {
        intents.push({ kind: 'reactivate_recipient', recipient, stream });
        break;
      }

      intents.push({
        kind: 'suppress_recipient',
        recipient,
        stream,
        cause: causeFromSuppressionReason(event.SuppressionReason),
      });

      // The whole point of the three-stream split. A marketing unsubscribe
      // withdraws marketing consent and touches nothing else; a tender-alert
      // unsubscribe stops tender alerts and leaves marketing consent alone;
      // and a transactional suppression is a support problem, not a
      // preference, so it is escalated rather than acted on.
      if (stream === 'luma-marketing') {
        intents.push({ kind: 'withdraw_marketing_consent', recipient, occurredAt });
      } else if (stream === 'tender-notifications') {
        intents.push({ kind: 'disable_tender_alerts', recipient, occurredAt });
      } else {
        intents.push({
          kind: 'alert_admin',
          severity: 'critical',
          reason: 'transactional_suppression',
          recipient,
        });
      }
      break;
    }

    case 'Open': {
      intents.push({
        kind: 'record_engagement',
        engagement: 'open',
        recipient,
        messageId: event.MessageID,
        stream,
        occurredAt,
      });
      break;
    }

    case 'Click': {
      intents.push({
        kind: 'record_engagement',
        engagement: 'click',
        recipient,
        messageId: event.MessageID,
        stream,
        occurredAt,
        ...(event.OriginalLink ? { url: event.OriginalLink } : {}),
      });
      break;
    }

    default: {
      const unknown: never = event;
      throw new Error(`Ukjent Postmark-hendelsestype: ${JSON.stringify(unknown)}`);
    }
  }

  assertNoCrossStreamEffect(intents, stream);
  return intents;
}

function causeFromSuppressionReason(reason: string | null | undefined): SuppressionCause {
  switch (reason) {
    case 'HardBounce':
      return 'hard_bounce';
    case 'SpamComplaint':
      return 'spam_complaint';
    case 'ManualSuppression':
      return 'manual_suppression';
    default:
      return 'recipient_unsubscribe';
  }
}

/**
 * Fails loudly if a derivation ever produced an effect on a stream other than
 * the one the event arrived on.
 *
 * Called from `deriveIntents` itself rather than only from tests, because the
 * failure it guards against - a marketing complaint suppressing a user's
 * magic links - is one where a silent bug locks people out of their accounts.
 */
export function assertNoCrossStreamEffect(
  intents: readonly WebhookIntent[],
  stream: StreamKind,
): void {
  for (const intent of intents) {
    if (
      (intent.kind === 'suppress_recipient' || intent.kind === 'reactivate_recipient') &&
      intent.stream !== stream
    ) {
      throw new Error(
        `Webhook på strømmen ${stream} forsøkte å endre undertrykking på ${intent.stream}. ` +
          'Avmelding fra markedsføring skal aldri deaktivere kontokritisk e-post.',
      );
    }
  }
}
