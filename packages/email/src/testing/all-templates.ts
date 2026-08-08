import type { NotificationPreferences } from '@luma/domain';
import type { PromotionBlock } from '../promotion.js';
import { toPromotionBlock } from '../promotion.js';
import {
  renderAccountDeleted,
  renderAlertConfirmation,
  renderDailyDigest,
  renderImmediateAlert,
  renderMagicLink,
  renderMaterialChange,
  renderOrderAdminNotification,
  renderOrderReceived,
  renderPaidAccessActivated,
  renderSignupConfirmation,
  renderWeeklyDigest,
} from '../render/templates/index.js';
import type { DigestContext, LinkContext, RenderedEmail, TemplateName } from '../types.js';
import * as f from './fixtures.js';

/**
 * Renders every MVP template from the shared fixtures.
 *
 * Having one function produce the whole set is what makes the cross-cutting
 * assertions cheap: the forbidden-phrasing scan, the link-parity check and the
 * "is this actually Norwegian" review all run over every template without
 * anyone having to remember to add the next one to three separate lists.
 * Adding a template here is what puts it under all of them at once.
 */

export interface RenderAllOptions {
  readonly preferences?: NotificationPreferences;
  readonly promotion?: PromotionBlock | null;
}

function linksFor(medium: LinkContext['medium']): LinkContext {
  return { ...f.LINK_CONTEXT, medium };
}

export function digestContext(options?: RenderAllOptions): DigestContext {
  return {
    recipientEmail: f.RECIPIENT_EMAIL,
    sender: f.SENDER,
    links: linksFor('digest'),
    now: f.FIXED_NOW,
    profileName: f.ALERT_PROFILE.name,
    preferences: options?.preferences ?? f.PREFERENCES_PROMOTION_ON,
    promotion:
      options?.promotion === undefined
        ? toPromotionBlock(f.PAAFYLL_RECOMMENDATION, 'digest')
        : options.promotion,
    competitions: f.COMPETITION_ITEMS,
    plannedProcurements: f.PLANNED_ITEMS,
    savedTenderChanges: [f.CHANGE_ITEM],
    periodStart: new Date('2026-03-11T07:00:00.000Z'),
    periodEnd: new Date('2026-03-12T07:00:00.000Z'),
  };
}

export function renderAllTemplates(options?: RenderAllOptions): RenderedEmail<TemplateName>[] {
  const preferences = options?.preferences ?? f.PREFERENCES_PROMOTION_ON;
  const promotion =
    options?.promotion === undefined
      ? toPromotionBlock(f.PAAFYLL_RECOMMENDATION, 'digest')
      : options.promotion;

  const base = {
    recipientEmail: f.RECIPIENT_EMAIL,
    sender: f.SENDER,
    now: f.FIXED_NOW,
  } as const;

  return [
    renderMagicLink({
      ...base,
      links: linksFor('landing'),
      // The query-parameter form `login.ts` actually builds through
      // `appUrlFor`, not a path-style token. The previous fixture used a path
      // and quietly made the UTM check in `templates.test.ts` assert against a
      // URL shape this product never sends.
      magicLinkUrl:
        'https://luma-training.com/anbudsvarsling/logg-inn/bekreft?token=9f2c41a8b7de4c0fa1b23c8d5e6f7a09&retur=%2Foversikt',
      validForMinutes: 15,
    }),
    // Both variants, because the branch on `hasExistingAccount` is the only
    // conditional in an account-critical template and the cross-cutting scans
    // (forbidden phrasing, link parity, Norwegian-only) have to see each side.
    renderSignupConfirmation({
      ...base,
      links: linksFor('landing'),
      confirmUrl:
        'https://luma-training.com/anbudsvarsling/registrering/bekreft?token=3c1f8a20d94b4e17ac5d6b8f0e2a7c31',
      validForMinutes: 60,
      hasExistingAccount: false,
      profileName: f.ALERT_PROFILE.name,
    }),
    renderSignupConfirmation({
      ...base,
      links: linksFor('landing'),
      confirmUrl:
        'https://luma-training.com/anbudsvarsling/registrering/bekreft?token=7b40e5c2a1d84f96b3e0c7a5d2f18e64',
      validForMinutes: 60,
      hasExistingAccount: true,
      profileName: f.ALERT_PROFILE.name,
    }),
    renderAlertConfirmation({
      ...base,
      links: linksFor('digest'),
      profile: f.ALERT_PROFILE,
    }),
    renderImmediateAlert({
      ...base,
      links: linksFor('immediate'),
      profileName: f.ALERT_PROFILE.name,
      preferences,
      promotion: promotion ? { ...promotion } : null,
      item: f.COMPETITION_ITEMS[0] as (typeof f.COMPETITION_ITEMS)[number],
    }),
    renderDailyDigest(digestContext({ ...(options ?? {}) })),
    renderWeeklyDigest(digestContext({ ...(options ?? {}) })),
    renderMaterialChange({
      ...base,
      links: linksFor('immediate'),
      profileName: f.ALERT_PROFILE.name,
      preferences,
      promotion: promotion ? { ...promotion } : null,
      item: f.CHANGE_ITEM,
    }),
    renderOrderReceived({
      ...base,
      links: linksFor('landing'),
      order: f.ORDER_INPUT,
      status: 'received',
    }),
    // The one email in the set whose recipient is not the customer.
    renderOrderAdminNotification({
      ...base,
      recipientEmail: f.BILLING_ADMIN_EMAIL,
      links: linksFor('landing'),
      order: f.ORDER_INPUT,
      orderId: f.ORDER_REQUEST_ID,
      status: 'received',
      adminOrderUrl: f.ADMIN_ORDER_URL,
    }),
    renderPaidAccessActivated({
      ...base,
      links: linksFor('landing'),
      productName: f.ORDER_INPUT.productName,
      accessUrl: 'https://luma-training.com/paafyll/min-tilgang',
    }),
    renderAccountDeleted({
      ...base,
      links: linksFor('landing'),
      deletedAt: new Date('2026-03-12T07:45:00.000Z'),
    }),
  ];
}
