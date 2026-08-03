import { maskEmail, type Logger } from '@luma/observability';
import type { RenderedEmail } from '../types.js';
import { assertMarketingConsent, type MarketingConsentProof } from './consent.js';
import {
  streamForTemplate,
  streamId,
  type StreamIds,
  type StreamKind,
  type TenderNotificationTemplate,
  type TransactionalTemplate,
} from './streams.js';

/**
 * The send interface every caller in the workspace programs against.
 *
 * There is one method per stream rather than one `send(stream, …)`, because a
 * stream parameter is a value a caller can get wrong and a method is not
 * (ADR-0005). Each method's parameter type admits only the templates that
 * belong on its stream, and the marketing method additionally demands a
 * consent proof that only `verifyMarketingConsent` can produce.
 */

export interface SendOptions {
  readonly to: string;
  /** Postmark metadata. Never put personal data here (spec section 40). */
  readonly metadata?: Readonly<Record<string, string>>;
  readonly replyTo?: string;
}

export interface TenderSendOptions extends SendOptions {
  /**
   * One-click unsubscribe target. Set on tender-notification and marketing
   * mail; absent on transactional, which has no unsubscribe.
   */
  readonly unsubscribeUrl?: string;
}

export interface MarketingCampaign {
  /** Stable campaign identifier, used as the Postmark tag and in attribution. */
  readonly campaignId: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export type SendOutcome =
  | {
      readonly status: 'sent';
      readonly stream: StreamKind;
      readonly messageId: string;
      readonly submittedAt: string;
    }
  | {
      readonly status: 'suppressed';
      readonly stream: StreamKind;
      /** Suppression is per stream, so this says nothing about other streams. */
      readonly reason: 'address_suppressed';
    };

export interface EmailClient {
  sendTransactional(
    email: RenderedEmail<TransactionalTemplate>,
    options: SendOptions,
  ): Promise<SendOutcome>;

  sendTenderNotification(
    email: RenderedEmail<TenderNotificationTemplate>,
    options: TenderSendOptions,
  ): Promise<SendOutcome>;

  /**
   * The marketing stream. `proof` is not optional and not a boolean.
   *
   * @see verifyMarketingConsent
   */
  sendMarketingCampaign(
    campaign: MarketingCampaign,
    proof: MarketingConsentProof,
    options: TenderSendOptions,
  ): Promise<SendOutcome>;

  /** Whether an address is suppressed on a given stream. */
  isSuppressed(email: string, stream: StreamKind): Promise<boolean>;
}

/**
 * The slice of the Postmark SDK this package uses.
 *
 * Narrowing it to two methods keeps the real client testable without a
 * network, and means a Postmark SDK upgrade has one place to break rather
 * than nine.
 */
export interface PostmarkTransport {
  sendEmail(message: PostmarkOutboundMessage): Promise<PostmarkSendResponse>;
  getSuppressions(
    messageStream: string,
    filter: { emailAddress: string },
  ): Promise<{ Suppressions: ReadonlyArray<{ EmailAddress: string }> }>;
}

export interface PostmarkOutboundMessage {
  From: string;
  To: string;
  Subject: string;
  HtmlBody: string;
  TextBody: string;
  MessageStream: string;
  Tag?: string;
  ReplyTo?: string;
  TrackOpens?: boolean;
  Headers?: Array<{ Name: string; Value: string }>;
  Metadata?: Record<string, string>;
}

export interface PostmarkSendResponse {
  MessageID: string;
  SubmittedAt: string;
  ErrorCode?: number;
  Message?: string;
}

export interface PostmarkEmailClientOptions {
  readonly transport: PostmarkTransport;
  readonly streams: StreamIds;
  /** `AUTH_EMAIL_FROM`. One verified sender signature per environment. */
  readonly from: string;
  readonly logger?: Logger;
  /**
   * Open tracking. Off by default: spec section 42 wants a calm, honest
   * product, and pixel tracking on a transactional login email is neither.
   */
  readonly trackOpens?: boolean;
}

function unsubscribeHeaders(url: string | undefined): Array<{ Name: string; Value: string }> {
  if (!url) return [];
  return [
    { Name: 'List-Unsubscribe', Value: `<${url}>` },
    { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
  ];
}

/** The real client. Talks to Postmark through `PostmarkTransport`. */
export class PostmarkEmailClient implements EmailClient {
  readonly #transport: PostmarkTransport;
  readonly #streams: StreamIds;
  readonly #from: string;
  readonly #logger: Logger | undefined;
  readonly #trackOpens: boolean;

  constructor(options: PostmarkEmailClientOptions) {
    this.#transport = options.transport;
    this.#streams = options.streams;
    this.#from = options.from;
    this.#logger = options.logger;
    this.#trackOpens = options.trackOpens ?? false;
  }

  async sendTransactional(
    email: RenderedEmail<TransactionalTemplate>,
    options: SendOptions,
  ): Promise<SendOutcome> {
    return this.#send({
      stream: streamForTemplate(email.template),
      tag: email.template,
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
    return this.#send({
      stream: streamForTemplate(email.template),
      tag: email.template,
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
    // Before anything else. A forged or missing proof must not reach the
    // network, and must not be recoverable by a caller catching and retrying.
    assertMarketingConsent(proof, options.to);
    return this.#send({
      stream: 'luma-marketing',
      tag: campaign.campaignId,
      subject: campaign.subject,
      html: campaign.html,
      text: campaign.text,
      options,
      unsubscribeUrl: options.unsubscribeUrl,
    });
  }

  async isSuppressed(email: string, stream: StreamKind): Promise<boolean> {
    const response = await this.#transport.getSuppressions(streamId(stream, this.#streams), {
      emailAddress: email,
    });
    const normalised = email.trim().toLowerCase();
    return response.Suppressions.some(
      (entry) => entry.EmailAddress.trim().toLowerCase() === normalised,
    );
  }

  async #send(input: {
    stream: StreamKind;
    tag: string;
    subject: string;
    html: string;
    text: string;
    options: SendOptions;
    unsubscribeUrl?: string | undefined;
  }): Promise<SendOutcome> {
    const { stream, options } = input;

    if (await this.isSuppressed(options.to, stream)) {
      this.#logger?.warn(
        { stream, tag: input.tag, recipient: maskEmail(options.to) },
        'e-post ikke sendt: adressen er undertrykt på denne strømmen',
      );
      return { status: 'suppressed', stream, reason: 'address_suppressed' };
    }

    const message: PostmarkOutboundMessage = {
      From: this.#from,
      To: options.to,
      Subject: input.subject,
      HtmlBody: input.html,
      TextBody: input.text,
      MessageStream: streamId(stream, this.#streams),
      Tag: input.tag,
      TrackOpens: this.#trackOpens,
    };
    if (options.replyTo) message.ReplyTo = options.replyTo;
    if (options.metadata) message.Metadata = { ...options.metadata };
    const headers = unsubscribeHeaders(input.unsubscribeUrl);
    if (headers.length > 0) message.Headers = headers;

    const response = await this.#transport.sendEmail(message);
    this.#logger?.info(
      {
        stream,
        tag: input.tag,
        recipient: maskEmail(options.to),
        postmarkMessageId: response.MessageID,
      },
      'e-post sendt',
    );
    return {
      status: 'sent',
      stream,
      messageId: response.MessageID,
      submittedAt: response.SubmittedAt,
    };
  }
}
