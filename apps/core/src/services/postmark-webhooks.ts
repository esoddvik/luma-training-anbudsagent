import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  consentEvents,
  consentTextVersions,
  emailEvents,
  emailSuppressions,
  notificationCategoryUnsubscribes,
  notificationDeliveries,
  notificationPreferences,
  users,
} from '@luma/db';
import {
  authenticateWebhook,
  deriveIntents,
  idempotencyKey,
  occurredAtOf,
  parseWebhookEvent,
  recipientOf,
  STREAM_KINDS,
  type PostmarkRecordType,
  type PostmarkWebhookEvent,
  type StreamKind,
  type SuppressionCause,
  type WebhookIntent,
} from '@luma/email';
import { jsonValueSchema, type JsonValue } from '@luma/domain';
import type { ApiContext } from './context.js';

/**
 * The Postmark webhook (spec §27, §21, ADR-5, ADR-9).
 *
 * ## What this file is, and what it is not
 *
 * The parsing, validation and *meaning* of a Postmark payload already live in
 * `@luma/email/webhooks`, which is typed, tested and — by ADR-1 — has no
 * database. It turns one webhook body into a validated event plus a list of
 * side-effect **intents**. This module is the persistence around that: it
 * authenticates, asks the package what the event means, and carries the
 * intents out against PostgreSQL.
 *
 * The division is worth stating because it is easy to erode. Nothing here
 * decides *whether* a bounce suppresses an address or which stream it affects.
 * That decision is `deriveIntents`, and it is guarded by
 * `assertNoCrossStreamEffect`. Anything in this file that started inspecting
 * `event.RecordType` to decide a side effect would be a second, unverified
 * copy of that logic.
 *
 * ## Idempotency is a constraint, not a lookup
 *
 * Postmark retries on any non-2xx and redelivers after a timeout. Spec §27
 * requires idempotent processing keyed on `MessageID` plus event type. That is
 * enforced by the unique index `email_events_message_id_event_type_key` and by
 * inserting first: the insert either produces a row or produces nothing, and
 * "nothing" is the duplicate signal. A `SELECT` beforehand would answer
 * correctly and still lose the race against a concurrent redelivery, which is
 * exactly the situation retries create.
 *
 * Everything after that insert therefore runs **once per event**, which is
 * what makes it safe to do the suppression writes synchronously.
 *
 * ## Fast response, deferred slow work
 *
 * §27 asks for a fast answer with slow work queued. Everything a user depends
 * on — the event row, the suppression, a consent withdrawal — is written
 * inside the request, because losing one of those is a data-loss bug that a
 * dropped queue message would make invisible. The genuinely slow part, sending
 * an operational alert to an administrator through Postmark itself, goes to
 * the `DeferredWork` seam on `ApiContext` instead.
 */

/** The `:stream` path segment, which must name one of the three streams. */
export function parseStreamKind(value: string): StreamKind | undefined {
  return STREAM_KINDS.find((kind) => kind === value);
}

/**
 * `StreamKind` uses hyphens (Postmark's own stream ids); the `message_stream`
 * enum uses underscores (PostgreSQL enum labels). One mapping, checked by
 * `satisfies` against the enum's own value union so a renamed label fails the
 * build rather than an insert.
 */
type MessageStreamColumn = (typeof emailSuppressions.messageStream.enumValues)[number];

const STREAM_COLUMN = {
  transactional: 'transactional',
  'tender-notifications': 'tender_notifications',
  'luma-marketing': 'luma_marketing',
} as const satisfies Record<StreamKind, MessageStreamColumn>;

type EmailEventTypeColumn = (typeof emailEvents.eventType.enumValues)[number];
type SuppressionReasonColumn = (typeof emailSuppressions.reason.enumValues)[number];

const EVENT_TYPE_COLUMN = {
  Delivery: 'delivery',
  Bounce: 'bounce',
  SpamComplaint: 'spam_complaint',
  SubscriptionChange: 'subscription_change',
  Open: 'open',
  Click: 'click',
} as const satisfies Record<PostmarkRecordType, EmailEventTypeColumn>;

const SUPPRESSION_REASON_COLUMN = {
  hard_bounce: 'hard_bounce',
  spam_complaint: 'spam_complaint',
  manual_suppression: 'manual',
  recipient_unsubscribe: 'unsubscribe',
} as const satisfies Record<SuppressionCause, SuppressionReasonColumn>;

export type WebhookResult =
  | { readonly status: 401; readonly body: { readonly outcome: 'unauthorized' } }
  | { readonly status: 404; readonly body: { readonly outcome: 'unknown_stream' } }
  | {
      readonly status: 400;
      readonly body: { readonly outcome: 'invalid_payload'; readonly issues: readonly string[] };
    }
  | {
      readonly status: 200;
      readonly body: { readonly outcome: 'accepted' | 'duplicate' };
    };

export interface HandleWebhookInput {
  /** The raw `:stream` path segment. Validated here, not by the route. */
  readonly stream: string;
  readonly authorizationHeader: string | undefined;
  /** The parsed JSON body. Untrusted. */
  readonly body: unknown;
}

export async function handlePostmarkWebhook(
  ctx: ApiContext,
  input: HandleWebhookInput,
): Promise<WebhookResult> {
  const auth = authenticateWebhook(input.authorizationHeader, {
    username: ctx.config.postmarkWebhookUsername,
    password: ctx.config.postmarkWebhookPassword,
  });
  if (!auth.ok) {
    // The reason is logged, never returned: telling a caller whether the
    // username or the password was wrong is an oracle, and the body Postmark
    // reads should say nothing either way.
    ctx.logger.warn({ reason: auth.reason }, 'postmark-webhook avvist');
    return { status: 401, body: { outcome: 'unauthorized' } };
  }

  // Deliberately *after* authentication. An unauthenticated 404 on an unknown
  // stream and an unauthenticated 401 on a real one would together enumerate
  // the stream configuration for anyone who asked.
  const stream = parseStreamKind(input.stream);
  if (!stream) return { status: 404, body: { outcome: 'unknown_stream' } };

  const parsed = parseWebhookEvent(input.body);
  if (!parsed.ok) {
    ctx.logger.warn({ stream, issues: parsed.issues }, 'ugyldig postmark-payload');
    return { status: 400, body: { outcome: 'invalid_payload', issues: parsed.issues } };
  }

  const event = parsed.event;
  // `deriveIntents` takes the stream from the route, never from the payload,
  // and asserts no intent escapes it. A body claiming `MessageStream:
  // "transactional"` on the marketing endpoint changes nothing.
  const intents = deriveIntents(event, stream);

  const inserted = await recordEmailEvent(ctx, event, stream, input.body);
  if (!inserted) {
    ctx.logger.debug({ stream, key: idempotencyKey(event) }, 'postmark-webhook allerede behandlet');
    return { status: 200, body: { outcome: 'duplicate' } };
  }

  await applyIntents(ctx, intents, stream);
  return { status: 200, body: { outcome: 'accepted' } };
}

/**
 * Writes the `email_events` row, or reports that it already existed.
 *
 * Returns `false` on conflict. That is the whole of the deduplication: one
 * statement, decided by the database.
 */
async function recordEmailEvent(
  ctx: ApiContext,
  event: PostmarkWebhookEvent,
  stream: StreamKind,
  rawBody: unknown,
): Promise<boolean> {
  const recipient = normalizeEmail(recipientOf(event));
  const occurredAt = parseOccurredAt(occurredAtOf(event), ctx.now());

  const [userId, deliveryId] = await Promise.all([
    findUserIdByEmail(ctx, recipient),
    findDeliveryId(ctx, event.MessageID),
  ]);

  const rows = await ctx.db
    .insert(emailEvents)
    .values({
      postmarkMessageId: event.MessageID,
      eventType: EVENT_TYPE_COLUMN[event.RecordType],
      messageStream: STREAM_COLUMN[stream],
      recipientEmail: recipient,
      userId: userId ?? null,
      deliveryId: deliveryId ?? null,
      payload: asJsonValue(rawBody),
      occurredAt,
      receivedAt: ctx.now(),
    })
    .onConflictDoNothing({
      target: [emailEvents.postmarkMessageId, emailEvents.eventType],
    })
    .returning({ id: emailEvents.id });

  return rows.length > 0;
}

/**
 * Carries out every intent except the base event row, which is already
 * written.
 *
 * `stream` is passed and re-checked. `deriveIntents` already refuses to widen
 * a suppression, and this is the second check at the point where the widening
 * would actually reach the database. Two checks for one rule, because the rule
 * is "a marketing unsubscribe must never stop a magic link", and the failure
 * mode is a user quietly locked out of their account with no error anywhere.
 */
async function applyIntents(
  ctx: ApiContext,
  intents: readonly WebhookIntent[],
  stream: StreamKind,
): Promise<void> {
  for (const intent of intents) {
    switch (intent.kind) {
      // Already persisted by `recordEmailEvent`.
      case 'record_email_event':
        break;

      // An open or a click *is* the `email_events` row; the payload column
      // keeps `OriginalLink` for the click report in §44.3. There is no second
      // table to write.
      case 'record_engagement':
        break;

      case 'suppress_recipient': {
        assertSameStream(intent.stream, stream);
        await suppressRecipient(ctx, intent.recipient, intent.stream, intent.cause);
        break;
      }

      case 'reactivate_recipient': {
        assertSameStream(intent.stream, stream);
        await reactivateRecipient(ctx, intent.recipient, intent.stream);
        break;
      }

      case 'withdraw_marketing_consent': {
        await withdrawMarketingConsent(ctx, intent.recipient, intent.occurredAt);
        break;
      }

      case 'disable_tender_alerts': {
        await disableTenderAlerts(ctx, intent.recipient);
        break;
      }

      case 'alert_admin': {
        // The one slow thing here: notifying an administrator means another
        // Postmark call, inside a handler Postmark is waiting on.
        await ctx.deferred.enqueue({
          kind: 'postmark.admin_alert',
          severity: intent.severity,
          reason: intent.reason,
          stream,
          recipient: normalizeEmail(intent.recipient),
          ...(intent.detail ? { detail: intent.detail } : {}),
        });
        break;
      }

      default: {
        const unknown: never = intent;
        // Loud, not silent: a new intent kind added in `@luma/email` that this
        // switch does not handle is a side effect that stopped happening.
        ctx.logger.error({ intent: unknown }, 'ukjent webhook-intensjon ble ikke utført');
        break;
      }
    }
  }
}

function assertSameStream(intentStream: StreamKind, routeStream: StreamKind): void {
  if (intentStream === routeStream) return;
  throw new Error(
    `Webhook på strømmen ${routeStream} forsøkte å endre undertrykking på ${intentStream}. ` +
      'Avmelding fra markedsføring skal aldri deaktivere kontokritisk e-post.',
  );
}

/**
 * Suppresses one address on **one** stream.
 *
 * The `messageStream` value comes from the argument and there is no loop over
 * `STREAM_KINDS` anywhere in this function. That is the mechanism behind spec
 * §27's last requirement and ADR-5's reason for existing.
 */
async function suppressRecipient(
  ctx: ApiContext,
  recipient: string,
  stream: StreamKind,
  cause: SuppressionCause,
): Promise<void> {
  const email = normalizeEmail(recipient);
  const now = ctx.now();

  await ctx.db
    .insert(emailSuppressions)
    .values({
      email,
      messageStream: STREAM_COLUMN[stream],
      reason: SUPPRESSION_REASON_COLUMN[cause],
      suppressedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [emailSuppressions.email, emailSuppressions.messageStream],
      set: {
        reason: SUPPRESSION_REASON_COLUMN[cause],
        suppressedAt: now,
        // A previously reactivated address that bounces again is suppressed
        // again, so the reactivation is cleared rather than left to imply the
        // address is usable.
        reactivatedAt: null,
        updatedAt: now,
      },
    });
}

async function reactivateRecipient(
  ctx: ApiContext,
  recipient: string,
  stream: StreamKind,
): Promise<void> {
  const now = ctx.now();
  await ctx.db
    .update(emailSuppressions)
    .set({ reactivatedAt: now, updatedAt: now })
    .where(
      and(
        eq(emailSuppressions.email, normalizeEmail(recipient)),
        eq(emailSuppressions.messageStream, STREAM_COLUMN[stream]),
        isNull(emailSuppressions.reactivatedAt),
      ),
    );
}

/**
 * Appends a `withdrawn` marketing consent event (spec §21, ADR-9).
 *
 * An append, never an update: the trigger installed by migration 0001 would
 * refuse anything else, and correctly so. The event is the evidence.
 *
 * Two conditions make this a no-op rather than a failure, and both are logged:
 * an address Postmark knows and we do not (a forwarded campaign, an address
 * changed since the send), and a missing `consent_text_versions` row. The
 * suppression above has already happened in both cases, so the user stops
 * receiving marketing either way; what is lost is the consent record, and
 * failing the webhook would lose the suppression too and earn a retry storm.
 */
async function withdrawMarketingConsent(
  ctx: ApiContext,
  recipient: string,
  occurredAtIso: string,
): Promise<void> {
  const email = normalizeEmail(recipient);
  const userId = await findUserIdByEmail(ctx, email);
  if (!userId) {
    ctx.logger.info(
      { stream: 'luma-marketing' },
      'avmelding fra ukjent adresse: undertrykt, men ingen samtykkehendelse skrevet',
    );
    return;
  }

  const versions = await ctx.db
    .select({ version: consentTextVersions.version })
    .from(consentTextVersions)
    .where(eq(consentTextVersions.consentType, 'marketing_email'))
    .orderBy(desc(consentTextVersions.effectiveFrom))
    .limit(1);
  const version = versions[0]?.version;
  if (!version) {
    ctx.logger.error(
      {},
      'ingen samtykketekstversjon for marketing_email: tilbaketrekking ble ikke logget',
    );
    return;
  }

  const now = ctx.now();
  await ctx.db.insert(consentEvents).values({
    userId,
    consentType: 'marketing_email',
    status: 'withdrawn',
    source: 'api',
    sourceDetail: 'Postmark: avmelding fra markedsføringsstrømmen.',
    policyVersion: ctx.config.currentPrivacyPolicyVersion,
    termsVersion: ctx.config.currentTermsVersion,
    consentTextVersion: version,
    occurredAt: parseOccurredAt(occurredAtIso, now),
    createdAt: now,
  });
}

/**
 * Stops tender alerts, and touches nothing else (spec §21).
 *
 * In particular it writes no consent event. Unsubscribing from tender alerts
 * is not a withdrawal of marketing consent, and the two switches live in two
 * tables precisely so that this function cannot accidentally operate both.
 */
async function disableTenderAlerts(ctx: ApiContext, recipient: string): Promise<void> {
  const email = normalizeEmail(recipient);
  const userId = await findUserIdByEmail(ctx, email);
  if (!userId) return;

  const now = ctx.now();
  await ctx.db
    .insert(notificationCategoryUnsubscribes)
    .values({
      userId,
      category: 'tender_alerts',
      unsubscribedAt: now,
      source: 'postmark_webhook',
      createdAt: now,
    })
    .onConflictDoNothing({
      target: [notificationCategoryUnsubscribes.userId, notificationCategoryUnsubscribes.category],
    });

  await ctx.db
    .update(notificationPreferences)
    .set({ tenderAlertsEnabled: false, updatedAt: now })
    .where(eq(notificationPreferences.userId, userId));
}

async function findUserIdByEmail(ctx: ApiContext, email: string): Promise<string | undefined> {
  const rows = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return rows[0]?.id;
}

async function findDeliveryId(ctx: ApiContext, messageId: string): Promise<string | undefined> {
  const rows = await ctx.db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.postmarkMessageId, messageId))
    .limit(1);
  return rows[0]?.id;
}

/** `users.email` is stored lowercased by the application (schema: `auth.ts`). */
function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The payload timestamp, or the clock.
 *
 * Postmark's format is ISO 8601 and has been stable for years, but this value
 * is external input that lands in a `timestamptz` column. `new Date('nonsense')`
 * is an `Invalid Date`, which Drizzle sends to PostgreSQL and PostgreSQL
 * rejects — turning a bad character in a third party's payload into a 500 on a
 * webhook that then retries forever.
 */
function parseOccurredAt(value: string, fallback: Date): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

/**
 * The raw body, as something the `jsonb` column will accept.
 *
 * Parsed rather than cast: the value arrives as `unknown` from Fastify, and a
 * `as JsonValue` would be an assertion about data nobody checked.
 */
function asJsonValue(body: unknown): JsonValue | null {
  const parsed = jsonValueSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}
