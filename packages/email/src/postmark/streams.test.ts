import { describe, expect, it } from 'vitest';
import { TEMPLATE_NAMES, type TemplateName } from '../types.js';
import {
  streamForTemplate,
  streamId,
  streamIdsFromEnv,
  STREAM_KINDS,
  TEMPLATE_STREAM,
  templatesForStream,
  type StreamIds,
  type StreamKind,
} from './streams.js';

/**
 * ADR-0005's first verification item: every template in spec section 25 maps
 * to exactly one stream, and the mapping is exhaustive.
 *
 * The failure this guards against is specific and expensive: a magic login
 * link sent on the marketing stream, suppressed by a campaign complaint, and a
 * user locked out of their account.
 */

/** The mapping restated independently, from the spec rather than from the code. */
const EXPECTED_FROM_SPEC: Record<TemplateName, StreamKind> = {
  // Section 27, "Transactional": magic links, account confirmation, order
  // confirmation, account deletion.
  'auth-magic-link-v1': 'transactional',
  // Section 27 lists "account confirmation" under transactional, and the
  // search-first signup confirmation is exactly that event: proving an address
  // belongs to the person who typed it, before any account exists. A
  // suppression here would stop people creating accounts at all.
  'signup-confirmation-v1': 'transactional',
  'alert-confirmation-v1': 'transactional',
  'order-request-received-v1': 'transactional',
  // Section 28.2 step 2: the billing administrator's notification is the same
  // account-critical event seen from Luma's side.
  'order-admin-notification-v1': 'transactional',
  'paid-access-activated-v1': 'transactional',
  'account-delete-confirmation-v1': 'transactional',
  // Section 27, "Tender notifications": immediate alerts, digests, changes.
  'tender-immediate-v1': 'tender-notifications',
  'tender-daily-digest-v1': 'tender-notifications',
  'tender-weekly-digest-v1': 'tender-notifications',
  'tender-material-change-v1': 'tender-notifications',
};

describe('template to stream mapping', () => {
  it('covers every template in spec section 25', () => {
    expect(Object.keys(TEMPLATE_STREAM).sort()).toEqual([...TEMPLATE_NAMES].sort());
  });

  it('matches the specification, template by template', () => {
    for (const template of TEMPLATE_NAMES) {
      expect(streamForTemplate(template)).toBe(EXPECTED_FROM_SPEC[template]);
    }
  });

  it('assigns exactly one stream per template', () => {
    for (const template of TEMPLATE_NAMES) {
      const streams = STREAM_KINDS.filter((stream) =>
        templatesForStream(stream).includes(template),
      );
      expect(streams).toHaveLength(1);
    }
  });

  it('puts no MVP template on the marketing stream', () => {
    // Spec section 27: luma-marketing carries standalone campaigns, which are
    // not templates. Nothing in section 25 belongs there, and the type
    // `MarketingTemplate` is `never` for the same reason.
    expect(templatesForStream('luma-marketing')).toEqual([]);
  });

  it('keeps the billing administrator notification off marketing (spec 28.2)', () => {
    // The recipient is a role address configured by an operator. It has given
    // no marketing consent, so the marketing stream is not merely wrong but
    // unlawful to use; and a suppression there would stop orders from being
    // noticed at all, with no error anywhere.
    expect(streamForTemplate('order-admin-notification-v1')).toBe('transactional');
    expect(templatesForStream('luma-marketing')).not.toContain('order-admin-notification-v1');
    expect(templatesForStream('tender-notifications')).not.toContain('order-admin-notification-v1');
    expect(templatesForStream('transactional')).toContain('order-admin-notification-v1');
  });

  it('keeps account-critical mail off the tender stream', () => {
    // A user who unsubscribes from tender alerts still has to be able to log in.
    expect(templatesForStream('transactional')).toContain('auth-magic-link-v1');
    expect(templatesForStream('tender-notifications')).not.toContain('auth-magic-link-v1');
  });
});

describe('stream ids come from configuration', () => {
  const ids: StreamIds = streamIdsFromEnv({
    POSTMARK_TRANSACTIONAL_STREAM: 'transactional',
    POSTMARK_TENDER_NOTIFICATION_STREAM: 'tender-notifications',
    POSTMARK_MARKETING_STREAM: 'luma-marketing',
  });

  it('resolves each kind to its configured id', () => {
    expect(streamId('transactional', ids)).toBe('transactional');
    expect(streamId('tender-notifications', ids)).toBe('tender-notifications');
    expect(streamId('luma-marketing', ids)).toBe('luma-marketing');
  });

  it('honours a renamed stream without a code change', () => {
    const renamed = streamIdsFromEnv({
      POSTMARK_TRANSACTIONAL_STREAM: 'outbound-2026',
      POSTMARK_TENDER_NOTIFICATION_STREAM: 'anbudsvarsler',
      POSTMARK_MARKETING_STREAM: 'kampanjer',
    });
    expect(streamId('transactional', renamed)).toBe('outbound-2026');
    expect(streamId('tender-notifications', renamed)).toBe('anbudsvarsler');
  });
});
