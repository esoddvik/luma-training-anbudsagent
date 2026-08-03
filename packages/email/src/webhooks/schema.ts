import { z } from 'zod';

/**
 * Postmark webhook payloads (spec section 27).
 *
 * Validated with Zod because they are external input (spec section 49) and
 * because a webhook body is the one place where a provider can change a field
 * without telling anyone. Each schema is *loose*: unknown properties are kept
 * rather than rejected, so a new Postmark field does not turn into a 400 and a
 * silently lost delivery event, while the fields we act on stay strict.
 */

const looseBase = {
  MessageID: z.string().min(1),
  /** Postmark omits this on very old payloads; treated as unknown when absent. */
  MessageStream: z.string().optional(),
  Tag: z.string().optional(),
  Metadata: z.record(z.string(), z.string()).optional(),
};

export const deliveryEventSchema = z.looseObject({
  RecordType: z.literal('Delivery'),
  ...looseBase,
  Recipient: z.string().min(1),
  DeliveredAt: z.string().min(1),
  Details: z.string().optional(),
});

/**
 * Bounce and spam complaint share Postmark's bounce shape. `Type` is the
 * interesting field: `HardBounce` and `SpamNotification` suppress, a
 * `SoftBounce` or `Transient` does not.
 */
const bounceShape = {
  ...looseBase,
  ID: z.number().optional(),
  Type: z.string().min(1),
  TypeCode: z.number().optional(),
  Name: z.string().optional(),
  Email: z.string().min(1),
  From: z.string().optional(),
  Subject: z.string().optional(),
  Description: z.string().optional(),
  Details: z.string().optional(),
  BouncedAt: z.string().min(1),
  Inactive: z.boolean().optional(),
  CanActivate: z.boolean().optional(),
  DumpAvailable: z.boolean().optional(),
};

export const bounceEventSchema = z.looseObject({
  RecordType: z.literal('Bounce'),
  ...bounceShape,
});

export const spamComplaintEventSchema = z.looseObject({
  RecordType: z.literal('SpamComplaint'),
  ...bounceShape,
});

export const subscriptionChangeEventSchema = z.looseObject({
  RecordType: z.literal('SubscriptionChange'),
  ...looseBase,
  Recipient: z.string().min(1),
  ChangedAt: z.string().min(1),
  Origin: z.string().optional(),
  SuppressSending: z.boolean(),
  SuppressionReason: z.string().nullable().optional(),
});

export const openEventSchema = z.looseObject({
  RecordType: z.literal('Open'),
  ...looseBase,
  Recipient: z.string().min(1),
  ReceivedAt: z.string().min(1),
  FirstOpen: z.boolean().optional(),
});

export const clickEventSchema = z.looseObject({
  RecordType: z.literal('Click'),
  ...looseBase,
  Recipient: z.string().min(1),
  ReceivedAt: z.string().min(1),
  OriginalLink: z.string().optional(),
  ClickLocation: z.string().optional(),
});

export const postmarkWebhookEventSchema = z.discriminatedUnion('RecordType', [
  deliveryEventSchema,
  bounceEventSchema,
  spamComplaintEventSchema,
  subscriptionChangeEventSchema,
  openEventSchema,
  clickEventSchema,
]);

export type PostmarkWebhookEvent = z.infer<typeof postmarkWebhookEventSchema>;
export type PostmarkRecordType = PostmarkWebhookEvent['RecordType'];

export type ParseWebhookResult =
  | { readonly ok: true; readonly event: PostmarkWebhookEvent }
  | { readonly ok: false; readonly issues: readonly string[] };

/** Parses an untrusted body. Never throws. */
export function parseWebhookEvent(body: unknown): ParseWebhookResult {
  const result = postmarkWebhookEventSchema.safeParse(body);
  if (result.success) return { ok: true, event: result.data };
  return {
    ok: false,
    issues: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  };
}

/**
 * The recipient address, whichever field this record type carries it in.
 *
 * Postmark calls it `Recipient` on delivery, subscription and engagement
 * events, and `Email` on bounces and complaints.
 */
export function recipientOf(event: PostmarkWebhookEvent): string {
  switch (event.RecordType) {
    case 'Bounce':
    case 'SpamComplaint':
      return event.Email;
    case 'Delivery':
    case 'SubscriptionChange':
    case 'Open':
    case 'Click':
      return event.Recipient;
    default: {
      const unknown: never = event;
      throw new Error(`Ukjent Postmark-hendelsestype: ${JSON.stringify(unknown)}`);
    }
  }
}

/** When the event happened, per the payload rather than per the clock. */
export function occurredAtOf(event: PostmarkWebhookEvent): string {
  switch (event.RecordType) {
    case 'Delivery':
      return event.DeliveredAt;
    case 'Bounce':
    case 'SpamComplaint':
      return event.BouncedAt;
    case 'SubscriptionChange':
      return event.ChangedAt;
    case 'Open':
    case 'Click':
      return event.ReceivedAt;
    default: {
      const unknown: never = event;
      throw new Error(`Ukjent Postmark-hendelsestype: ${JSON.stringify(unknown)}`);
    }
  }
}

/**
 * The idempotency key (spec section 27, ADR-0005): Postmark `MessageID` plus
 * the event type.
 *
 * Note the consequence, which the specification chooses deliberately: a second
 * open or a second click on the same message collapses onto the first. Repeat
 * engagement is therefore not counted. If section 44's click reporting later
 * needs repeat clicks, this key is the thing to widen, not the store.
 */
export function idempotencyKey(event: PostmarkWebhookEvent): string {
  return `${event.RecordType}:${event.MessageID}`;
}
