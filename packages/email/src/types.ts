import type {
  AlertProfile,
  CreateOrderInput,
  MatchResult,
  NotificationPreferences,
  OrderStatus,
  Tender,
  TenderChangeEvent,
  UtmMedium,
} from '@luma/domain';
import type { PromotionBlock } from './promotion.js';

/**
 * The nine MVP templates (spec section 25).
 *
 * The names are the contract with Postmark: they identify the stream
 * (`postmark/streams.ts`), they are the Postmark `Tag`, and they version the
 * template so a copy rewrite becomes `-v2` rather than a silent change.
 */
export const TEMPLATE_NAMES = [
  'auth-magic-link-v1',
  'alert-confirmation-v1',
  'tender-immediate-v1',
  'tender-daily-digest-v1',
  'tender-weekly-digest-v1',
  'tender-material-change-v1',
  'order-request-received-v1',
  'paid-access-activated-v1',
  'account-delete-confirmation-v1',
] as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

/**
 * What every template function returns. Both parts, always.
 *
 * The template name is a type parameter rather than a plain field, which is
 * what lets `postmark/streams.ts` refuse a digest on the transactional stream
 * at compile time instead of at runtime (ADR-0005).
 */
export interface RenderedEmail<T extends TemplateName = TemplateName> {
  readonly template: T;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/**
 * Who the mail is from, in the customer-facing sense.
 *
 * Required rather than defaulted: spec section 25 requires sender and contact
 * information in the footer, and a hard-coded postal address in a library is
 * the kind of detail that goes stale silently.
 */
export interface SenderIdentity {
  readonly name: string;
  readonly postalAddress: string;
  readonly contactEmail: string;
}

/**
 * Everything a footer link needs.
 *
 * Only the base URLs are passed in; the individual paths are built in
 * `links.ts` so that the UTM rule from spec section 44.2 lives in one place
 * and cannot be forgotten at a call site.
 */
export interface LinkContext {
  /** `APP_URL`. The root of the web app. */
  readonly appUrl: string;
  /** `LUMA_PRIVACY_POLICY_URL` (spec section 18). Never hard-coded. */
  readonly privacyUrl: string;
  /** `TENDER_SERVICE_TERMS_URL` (spec section 19). */
  readonly termsUrl: string;
  /**
   * One-click token for the unsubscribe and pause links, when the caller has
   * one. Without it the links land on the settings page behind login.
   */
  readonly actionToken?: string;
  /** The surface, used as `utm_medium` (spec section 44.2). */
  readonly medium: UtmMedium;
}

/** Context shared by every template. */
export interface BaseEmailContext {
  readonly recipientEmail: string;
  readonly sender: SenderIdentity;
  readonly links: LinkContext;
  /** Rendering is a pure function of its input, including the clock. */
  readonly now: Date;
}

/** One tender as it appears in an email (spec section 25). */
export interface TenderCardItem {
  readonly tender: Tender;
  readonly match: MatchResult;
}

/** One changed tender in the "endringer i lagrede anbud" section. */
export interface TenderChangeItem {
  readonly tender: Tender;
  readonly changes: readonly TenderChangeEvent[];
}

/** Shared by the digests and the immediate alert. */
export interface TenderEmailContext extends BaseEmailContext {
  readonly profileName: string;
  readonly preferences: NotificationPreferences;
  /**
   * The already-selected promotion, or null.
   *
   * Selection happens before rendering (ADR-0006, point 4) so that the
   * renderer cannot reach into match data. The renderer additionally refuses
   * to draw the block when the preference is off, which makes the off switch
   * a property of two independent layers rather than one.
   */
  readonly promotion: PromotionBlock | null;
}

export interface DigestContext extends TenderEmailContext {
  /** Active competitions, already ranked. Rendering never reorders. */
  readonly competitions: readonly TenderCardItem[];
  /** Planned procurements, rendered in their own labelled section. */
  readonly plannedProcurements: readonly TenderCardItem[];
  readonly savedTenderChanges: readonly TenderChangeItem[];
  /** Start of the period the digest covers, used in the heading. */
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

export interface ImmediateAlertContext extends TenderEmailContext {
  readonly item: TenderCardItem;
}

export interface MaterialChangeContext extends TenderEmailContext {
  readonly item: TenderChangeItem;
}

export interface MagicLinkContext extends BaseEmailContext {
  readonly magicLinkUrl: string;
  readonly validForMinutes: number;
}

export interface AlertConfirmationContext extends BaseEmailContext {
  readonly profile: AlertProfile;
}

export interface OrderReceivedContext extends BaseEmailContext {
  readonly order: CreateOrderInput;
  readonly status: OrderStatus;
}

export interface PaidAccessActivatedContext extends BaseEmailContext {
  readonly productName: string;
  /** Where the activated product lives. A Luma URL, so it carries UTM. */
  readonly accessUrl: string;
}

export interface AccountDeletedContext extends BaseEmailContext {
  readonly deletedAt: Date;
}
