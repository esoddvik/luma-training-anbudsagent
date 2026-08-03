import type { RenderedEmail, TemplateName } from '../types.js';
import { assertMarketingConsent, type MarketingConsentProof } from './consent.js';
import type {
  EmailClient,
  MarketingCampaign,
  SendOptions,
  SendOutcome,
  TenderSendOptions,
} from './client.js';
import {
  streamForTemplate,
  type StreamKind,
  type TenderNotificationTemplate,
  type TransactionalTemplate,
} from './streams.js';

/**
 * An in-memory `EmailClient` that records what was sent.
 *
 * Exported from the package so that every other package and every test can
 * assert on email without a network and without a Postmark token. It runs the
 * same consent and suppression checks as the real client - a test double that
 * skips the rules would let exactly the bugs those rules exist to catch pass
 * the suite.
 */

export interface RecordedEmail {
  readonly stream: StreamKind;
  /** The template name, or the campaign id for a marketing send. */
  readonly tag: string;
  readonly template?: TemplateName;
  readonly campaignId?: string;
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly unsubscribeUrl?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly messageId: string;
  readonly sentAt: Date;
}

export class FakePostmarkClient implements EmailClient {
  readonly sent: RecordedEmail[] = [];
  /** Addresses suppressed per stream. Postmark scopes suppression this way. */
  readonly #suppressed = new Map<StreamKind, Set<string>>();
  #counter = 0;
  #now: () => Date;

  constructor(options?: { now?: () => Date }) {
    this.#now = options?.now ?? (() => new Date());
  }

  async sendTransactional(
    email: RenderedEmail<TransactionalTemplate>,
    options: SendOptions,
  ): Promise<SendOutcome> {
    return this.#record({
      stream: streamForTemplate(email.template),
      tag: email.template,
      template: email.template,
      subject: email.subject,
      html: email.html,
      text: email.text,
      options,
    });
  }

  async sendTenderNotification(
    email: RenderedEmail<TenderNotificationTemplate>,
    options: TenderSendOptions,
  ): Promise<SendOutcome> {
    return this.#record({
      stream: streamForTemplate(email.template),
      tag: email.template,
      template: email.template,
      subject: email.subject,
      html: email.html,
      text: email.text,
      options,
      unsubscribeUrl: options.unsubscribeUrl,
    });
  }

  async sendMarketingCampaign(
    campaign: MarketingCampaign,
    proof: MarketingConsentProof,
    options: TenderSendOptions,
  ): Promise<SendOutcome> {
    assertMarketingConsent(proof, options.to);
    return this.#record({
      stream: 'luma-marketing',
      tag: campaign.campaignId,
      campaignId: campaign.campaignId,
      subject: campaign.subject,
      html: campaign.html,
      text: campaign.text,
      options,
      unsubscribeUrl: options.unsubscribeUrl,
    });
  }

  async isSuppressed(email: string, stream: StreamKind): Promise<boolean> {
    return this.#suppressed.get(stream)?.has(normalise(email)) ?? false;
  }

  /** Adds a suppression, as a Postmark bounce or complaint webhook would. */
  suppress(email: string, stream: StreamKind): void {
    const set = this.#suppressed.get(stream) ?? new Set<string>();
    set.add(normalise(email));
    this.#suppressed.set(stream, set);
  }

  /**
   * The `EmailClient` member, as the consent-withdrawal job calls it.
   *
   * Distinct from `suppress` above only in being async: that one is test
   * setup standing in for a bounce webhook, this one is production code
   * pushing a withdrawal to Postmark. Both land in the same per-stream set,
   * so a test can assert either way round.
   */
  async suppressAddress(email: string, stream: StreamKind): Promise<void> {
    this.suppress(email, stream);
  }

  unsuppress(email: string, stream: StreamKind): void {
    this.#suppressed.get(stream)?.delete(normalise(email));
  }

  /** Everything sent on one stream, oldest first. */
  sentOnStream(stream: StreamKind): RecordedEmail[] {
    return this.sent.filter((email) => email.stream === stream);
  }

  sentWithTemplate(template: TemplateName): RecordedEmail[] {
    return this.sent.filter((email) => email.template === template);
  }

  lastSent(): RecordedEmail | undefined {
    return this.sent.at(-1);
  }

  reset(): void {
    this.sent.length = 0;
    this.#suppressed.clear();
    this.#counter = 0;
  }

  async #record(input: {
    stream: StreamKind;
    tag: string;
    template?: TemplateName;
    campaignId?: string;
    subject: string;
    html: string;
    text: string;
    options: SendOptions;
    unsubscribeUrl?: string | undefined;
  }): Promise<SendOutcome> {
    if (await this.isSuppressed(input.options.to, input.stream)) {
      return { status: 'suppressed', stream: input.stream, reason: 'address_suppressed' };
    }
    this.#counter += 1;
    const messageId = `fake-${input.stream}-${this.#counter}`;
    const sentAt = this.#now();
    this.sent.push({
      stream: input.stream,
      tag: input.tag,
      ...(input.template ? { template: input.template } : {}),
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
      to: input.options.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.unsubscribeUrl ? { unsubscribeUrl: input.unsubscribeUrl } : {}),
      ...(input.options.metadata ? { metadata: { ...input.options.metadata } } : {}),
      messageId,
      sentAt,
    });
    return {
      status: 'sent',
      stream: input.stream,
      messageId,
      submittedAt: sentAt.toISOString(),
    };
  }
}

function normalise(email: string): string {
  return email.trim().toLowerCase();
}
