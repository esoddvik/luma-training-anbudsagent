import { z } from 'zod';

/**
 * Consent and legal acceptance (spec sections 20 and 21).
 *
 * Consent is an append-only event log, never a boolean on the user row
 * (ADR-9). Withdrawal is a new event; history is never overwritten. Current
 * status is always derived from the latest event of a given type.
 */

export const consentTypeSchema = z.enum([
  'marketing_email',
  'privacy_acknowledgement',
  'terms_acceptance',
]);
export type ConsentType = z.infer<typeof consentTypeSchema>;

export const consentStatusSchema = z.enum(['granted', 'withdrawn', 'accepted', 'superseded']);
export type ConsentStatus = z.infer<typeof consentStatusSchema>;

export const consentSourceSchema = z.enum([
  'signup',
  'account_settings',
  'checkout',
  'invoice_request',
  'course_registration',
  'newsletter_registration',
  'admin_recorded',
  'imported',
  'api',
]);
export type ConsentSource = z.infer<typeof consentSourceSchema>;

export const consentEventSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  consentType: consentTypeSchema,
  status: consentStatusSchema,
  source: consentSourceSchema,
  sourceDetail: z.string().max(500).optional(),
  policyVersion: z.string().optional(),
  termsVersion: z.string().optional(),
  /** The exact version of the text the user saw. Never inferred later. */
  consentTextVersion: z.string().min(1),
  occurredAt: z.date(),
  /** Hashed, not stored raw: spec section 40 requires data minimisation. */
  ipAddressHash: z.string().optional(),
  userAgent: z.string().max(500).optional(),
  createdAt: z.date(),
});
export type ConsentEvent = z.infer<typeof consentEventSchema>;

/** The statuses that mean consent is currently in force. */
const ACTIVE_STATUSES: ReadonlySet<ConsentStatus> = new Set<ConsentStatus>(['granted', 'accepted']);

/**
 * Derives whether a consent type is currently held, from the full event log.
 *
 * Ordering is by `occurredAt`, not insertion order, because an administrator
 * may record a historical consent after the fact (spec section 21 allows
 * `admin_recorded` and `imported` sources). Ties fall back to `createdAt` so
 * two events at the same instant still resolve deterministically.
 */
export function isConsentActive(
  events: readonly ConsentEvent[],
  consentType: ConsentType,
): boolean {
  const latest = latestConsentEvent(events, consentType);
  return latest !== undefined && ACTIVE_STATUSES.has(latest.status);
}

export function latestConsentEvent(
  events: readonly ConsentEvent[],
  consentType: ConsentType,
): ConsentEvent | undefined {
  return events
    .filter((event) => event.consentType === consentType)
    .sort(
      (a, b) =>
        a.occurredAt.getTime() - b.occurredAt.getTime() ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    )
    .at(-1);
}

/**
 * Legal documents (spec section 19) are versioned, and every acceptance
 * records which version was accepted (ADR-11).
 */
export const legalDocumentKindSchema = z.enum(['terms', 'privacy']);
export type LegalDocumentKind = z.infer<typeof legalDocumentKindSchema>;

export const legalDocumentVersionSchema = z.object({
  id: z.uuid(),
  kind: legalDocumentKindSchema,
  version: z.string().min(1),
  /** Norwegian bokmål. Markdown. */
  body: z.string().min(1),
  /** Blocks public launch while true (spec section 51 item 8). */
  isPlaceholder: z.boolean(),
  effectiveFrom: z.date(),
  createdAt: z.date(),
});
export type LegalDocumentVersion = z.infer<typeof legalDocumentVersionSchema>;

export const userLegalAcceptanceSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  kind: legalDocumentKindSchema,
  version: z.string().min(1),
  acceptedAt: z.date(),
  ipAddressHash: z.string().optional(),
});
export type UserLegalAcceptance = z.infer<typeof userLegalAcceptanceSchema>;

/**
 * Notification preferences (spec section 22).
 *
 * `includeLumaPromotionsInTenderEmails` is a content setting for the tender
 * emails, not marketing consent. Turning it off must never stop the tender
 * alerts, and withdrawing marketing consent must never stop them either
 * (spec section 3).
 */
export const notificationPreferencesSchema = z.object({
  tenderAlertsEnabled: z.boolean().default(true),
  immediateAlertsEnabled: z.boolean().default(false),
  digestEnabled: z.boolean().default(true),
  includeLumaPromotionsInTenderEmails: z.boolean().default(true),
  marketingEmailConsent: z.boolean().default(false),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

/** The Norwegian consent text (spec section 20.2). Versioned alongside the value. */
export const MARKETING_CONSENT_TEXT_NB =
  'Ja, jeg ønsker å motta nyheter, faglig innhold og informasjon om kurs og andre tjenester fra Luma Training på e-post. Jeg kan trekke tilbake samtykket når som helst.';

/** The Norwegian explanation of the promotion content setting (spec section 22). */
export const PROMOTION_SETTING_TEXT_NB =
  'Anbudsvarslene kan inneholde en tydelig merket seksjon med informasjon om kurs og faglig innhold fra Luma Training. Du kan slå av denne delen når som helst uten å stoppe anbudsvarslene.';
