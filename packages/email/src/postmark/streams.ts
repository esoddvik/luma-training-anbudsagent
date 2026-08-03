import type { CoreEnv } from '@luma/config';
import { TEMPLATE_NAMES, type TemplateName } from '../types.js';

/**
 * The three Postmark message streams (spec section 27, ADR-0005).
 *
 * The split exists to stop one failure: a spam complaint on a marketing
 * campaign suppressing the recipient's address, after which the next magic
 * login link silently never arrives and the user is locked out of a service
 * they never meant to leave.
 *
 * So the mapping below is not a convenience. It is the mechanism. A caller
 * names a template, never a stream, and the type of each send function admits
 * only the templates that belong on its stream.
 */
export const STREAM_KINDS = ['transactional', 'tender-notifications', 'luma-marketing'] as const;
export type StreamKind = (typeof STREAM_KINDS)[number];

/**
 * Template to stream. Exhaustive by construction: `satisfies` fails the build
 * if a template in spec section 25 has no entry.
 */
export const TEMPLATE_STREAM = {
  'auth-magic-link-v1': 'transactional',
  'alert-confirmation-v1': 'transactional',
  'order-request-received-v1': 'transactional',
  'paid-access-activated-v1': 'transactional',
  'account-delete-confirmation-v1': 'transactional',
  'tender-immediate-v1': 'tender-notifications',
  'tender-daily-digest-v1': 'tender-notifications',
  'tender-weekly-digest-v1': 'tender-notifications',
  'tender-material-change-v1': 'tender-notifications',
} as const satisfies Record<TemplateName, StreamKind>;

export type TemplateStreamMap = typeof TEMPLATE_STREAM;

/** The templates that belong on a given stream, as a type. */
export type TemplatesForStream<S extends StreamKind> = {
  [K in TemplateName]: TemplateStreamMap[K] extends S ? K : never;
}[TemplateName];

export type TransactionalTemplate = TemplatesForStream<'transactional'>;
export type TenderNotificationTemplate = TemplatesForStream<'tender-notifications'>;
/**
 * Deliberately `never`: no template in spec section 25 is a marketing
 * campaign. Marketing goes out through `sendMarketingCampaign`, which needs a
 * consent proof, so there is no way to reach the marketing stream with a
 * transactional template even by mistake.
 */
export type MarketingTemplate = TemplatesForStream<'luma-marketing'>;

export function streamForTemplate(template: TemplateName): StreamKind {
  return TEMPLATE_STREAM[template];
}

/** Every template on a stream, at runtime. Used by the mapping test. */
export function templatesForStream(stream: StreamKind): TemplateName[] {
  return TEMPLATE_NAMES.filter((template) => TEMPLATE_STREAM[template] === stream);
}

/**
 * The configured Postmark stream ids.
 *
 * Names come from configuration so a stream can be renamed or swapped without
 * a code change (ADR-0005). The mapping from kind to configured id is the
 * only place the two vocabularies meet.
 */
export interface StreamIds {
  readonly transactional: string;
  readonly tenderNotifications: string;
  readonly lumaMarketing: string;
}

type PostmarkStreamEnv = Pick<
  CoreEnv,
  | 'POSTMARK_TRANSACTIONAL_STREAM'
  | 'POSTMARK_TENDER_NOTIFICATION_STREAM'
  | 'POSTMARK_MARKETING_STREAM'
>;

export function streamIdsFromEnv(env: PostmarkStreamEnv): StreamIds {
  return {
    transactional: env.POSTMARK_TRANSACTIONAL_STREAM,
    tenderNotifications: env.POSTMARK_TENDER_NOTIFICATION_STREAM,
    lumaMarketing: env.POSTMARK_MARKETING_STREAM,
  };
}

export function streamId(kind: StreamKind, ids: StreamIds): string {
  switch (kind) {
    case 'transactional':
      return ids.transactional;
    case 'tender-notifications':
      return ids.tenderNotifications;
    case 'luma-marketing':
      return ids.lumaMarketing;
    default: {
      const unknown: never = kind;
      throw new Error(`Ukjent Postmark-strøm: ${String(unknown)}`);
    }
  }
}
