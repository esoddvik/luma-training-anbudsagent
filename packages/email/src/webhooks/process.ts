import type { StreamKind } from '../postmark/streams.js';
import { authenticateWebhook, type WebhookCredentials } from './auth.js';
import { deriveIntents, type WebhookIntent } from './intents.js';
import { idempotencyKey, parseWebhookEvent, type PostmarkWebhookEvent } from './schema.js';

/**
 * One webhook delivery, from raw body to intents.
 *
 * The whole point is that it is fast and side-effect free: authenticate,
 * validate, deduplicate, decide. The caller answers Postmark with `status` and
 * enqueues `intents`. Nothing here touches a database, a queue or the network
 * (spec section 27: "rask respons, kølegg langsom behandling").
 */

/**
 * Deduplication, keyed on Postmark `MessageID` plus event type.
 *
 * Postmark retries on any non-2xx and occasionally redelivers after a
 * timeout, so a webhook handler that is not idempotent double-counts bounces
 * and double-suppresses addresses. The store is an interface because the real
 * one is a table and the test one is a `Set`.
 */
export interface WebhookIdempotencyStore {
  seen(key: string): Promise<boolean>;
  remember(key: string): Promise<void>;
}

export class InMemoryWebhookIdempotencyStore implements WebhookIdempotencyStore {
  readonly #keys = new Set<string>();

  async seen(key: string): Promise<boolean> {
    return this.#keys.has(key);
  }

  async remember(key: string): Promise<void> {
    this.#keys.add(key);
  }

  get size(): number {
    return this.#keys.size;
  }

  clear(): void {
    this.#keys.clear();
  }
}

export type WebhookOutcome =
  | { readonly status: 401; readonly outcome: 'unauthorized'; readonly reason: string }
  | {
      readonly status: 400;
      readonly outcome: 'invalid_payload';
      readonly issues: readonly string[];
    }
  | {
      readonly status: 200;
      readonly outcome: 'duplicate';
      readonly event: PostmarkWebhookEvent;
      readonly idempotencyKey: string;
      readonly intents: readonly [];
    }
  | {
      readonly status: 200;
      readonly outcome: 'accepted';
      readonly event: PostmarkWebhookEvent;
      readonly idempotencyKey: string;
      readonly intents: readonly WebhookIntent[];
    };

export interface ProcessWebhookInput {
  /** The stream the endpoint is mounted on, from the route, never the body. */
  readonly stream: StreamKind;
  readonly authorizationHeader: string | undefined | null;
  readonly credentials: WebhookCredentials;
  /** The parsed JSON body. Untrusted. */
  readonly body: unknown;
  readonly store: WebhookIdempotencyStore;
}

export async function processPostmarkWebhook(input: ProcessWebhookInput): Promise<WebhookOutcome> {
  const auth = authenticateWebhook(input.authorizationHeader, input.credentials);
  if (!auth.ok) {
    return { status: 401, outcome: 'unauthorized', reason: auth.reason };
  }

  const parsed = parseWebhookEvent(input.body);
  if (!parsed.ok) {
    return { status: 400, outcome: 'invalid_payload', issues: parsed.issues };
  }

  const key = idempotencyKey(parsed.event);
  if (await input.store.seen(key)) {
    return {
      status: 200,
      outcome: 'duplicate',
      event: parsed.event,
      idempotencyKey: key,
      intents: [],
    };
  }

  const intents = deriveIntents(parsed.event, input.stream);
  // Remembered only after derivation succeeds: a payload that throws should be
  // retryable, not permanently swallowed by its own idempotency key.
  await input.store.remember(key);

  return { status: 200, outcome: 'accepted', event: parsed.event, idempotencyKey: key, intents };
}
