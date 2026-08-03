import { and, desc, eq } from 'drizzle-orm';
import { consentEvents, consentTextVersions } from '@luma/db';
import {
  consentSourceSchema,
  consentTypeSchema,
  isConsentActive,
  latestConsentEvent,
  type ConsentEvent,
  type ConsentType,
} from '@luma/domain';
import { z } from 'zod';
import { badRequest, parseOrThrow } from '../routes/errors.js';
import { hashIpAddress } from './email-context.js';
import type { Actor, ApiContext } from './context.js';

/**
 * Consent recording (spec §20, §21, ADR-0009).
 *
 * **Nothing in this file updates or deletes a row.** Granting inserts. So does
 * withdrawing. So does re-granting. Under GDPR, consent is a claim about a past
 * event that the controller must be able to demonstrate, and an `UPDATE`
 * destroys exactly the evidence that claim rests on.
 *
 * The second rule, from §21 and repeated in §3, is separation: withdrawing
 * marketing consent must not touch tender alerts, and unsubscribing from
 * tender alerts must not withdraw marketing consent. That is why this module
 * writes only `consent_events` and never reaches into
 * `notification_preferences`.
 */

export const recordConsentInputSchema = z.object({
  consentType: consentTypeSchema,
  /** Only the two a user can choose. `superseded` is a system transition. */
  status: z.enum(['granted', 'withdrawn', 'accepted']),
  source: consentSourceSchema.default('account_settings'),
  sourceDetail: z.string().trim().max(500).optional(),
  /** Omitted means "the version currently in force" for that consent type. */
  consentTextVersion: z.string().trim().min(1).optional(),
});

export interface ConsentEventView {
  readonly id: string;
  readonly consentType: ConsentType;
  readonly status: string;
  readonly source: string;
  readonly consentTextVersion: string;
  readonly occurredAt: Date;
}

export interface ConsentStateView {
  readonly current: Readonly<Record<ConsentType, boolean>>;
  readonly history: readonly ConsentEventView[];
}

/** Every consent event for the caller, plus the derived current state. */
export async function getConsentState(ctx: ApiContext, actor: Actor): Promise<ConsentStateView> {
  const events = await loadConsentEvents(ctx, actor.userId);

  return {
    current: {
      marketing_email: isConsentActive(events, 'marketing_email'),
      privacy_acknowledgement: isConsentActive(events, 'privacy_acknowledgement'),
      terms_acceptance: isConsentActive(events, 'terms_acceptance'),
    },
    history: events
      .slice()
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .map((event) => ({
        id: event.id,
        consentType: event.consentType,
        status: event.status,
        source: event.source,
        consentTextVersion: event.consentTextVersion,
        occurredAt: event.occurredAt,
      })),
  };
}

export async function loadConsentEvents(ctx: ApiContext, userId: string): Promise<ConsentEvent[]> {
  const rows = await ctx.db
    .select()
    .from(consentEvents)
    .where(eq(consentEvents.userId, userId))
    .orderBy(desc(consentEvents.occurredAt));

  return rows.map((row) => {
    const event: ConsentEvent = {
      id: row.id,
      userId,
      consentType: row.consentType,
      status: row.status,
      source: row.source,
      consentTextVersion: row.consentTextVersion,
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
    };
    if (row.sourceDetail) event.sourceDetail = row.sourceDetail;
    if (row.policyVersion) event.policyVersion = row.policyVersion;
    if (row.termsVersion) event.termsVersion = row.termsVersion;
    if (row.ipAddressHash) event.ipAddressHash = row.ipAddressHash;
    if (row.userAgent) event.userAgent = row.userAgent;
    return event;
  });
}

/** The consent text version currently in force, newest effective first. */
async function currentTextVersion(
  ctx: ApiContext,
  consentType: ConsentType,
): Promise<string | undefined> {
  const rows = await ctx.db
    .select({ version: consentTextVersions.version })
    .from(consentTextVersions)
    .where(eq(consentTextVersions.consentType, consentType))
    .orderBy(desc(consentTextVersions.effectiveFrom))
    .limit(1);
  return rows[0]?.version;
}

export interface RecordConsentInput {
  readonly body: unknown;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

/**
 * Appends one consent event.
 *
 * The text version is resolved and checked before the insert. The column has a
 * composite foreign key onto `consent_text_versions`, so an unknown version
 * would otherwise surface as a database error — which spec §39 forbids
 * exposing and which would tell the user nothing useful anyway.
 */
export async function recordConsent(
  ctx: ApiContext,
  actor: Actor,
  input: RecordConsentInput,
): Promise<ConsentEventView> {
  const parsed = parseOrThrow(recordConsentInputSchema, input.body);
  const now = ctx.now();

  const version = parsed.consentTextVersion ?? (await currentTextVersion(ctx, parsed.consentType));
  if (!version) {
    throw badRequest(
      'consent_text_version_missing',
      'Vi mangler en gjeldende samtykketekst for denne typen. Prøv igjen senere.',
    );
  }

  const known = await ctx.db
    .select({ version: consentTextVersions.version })
    .from(consentTextVersions)
    .where(
      and(
        eq(consentTextVersions.consentType, parsed.consentType),
        eq(consentTextVersions.version, version),
      ),
    )
    .limit(1);
  if (known.length === 0) {
    throw badRequest('consent_text_version_unknown', 'Ukjent versjon av samtykketeksten.');
  }

  const inserted = await ctx.db
    .insert(consentEvents)
    .values({
      userId: actor.userId,
      consentType: parsed.consentType,
      status: parsed.status,
      source: parsed.source,
      sourceDetail: parsed.sourceDetail ?? null,
      policyVersion: ctx.config.currentPrivacyPolicyVersion,
      termsVersion: ctx.config.currentTermsVersion,
      consentTextVersion: version,
      occurredAt: now,
      ipAddressHash: hashIpAddress(input.ipAddress, ctx.config.authSecret),
      userAgent: input.userAgent ?? null,
      createdAt: now,
    })
    .returning({ id: consentEvents.id });

  const id = inserted[0]?.id;
  if (!id) throw new Error('insert returned no consent event id');

  // Withdrawal must reach Postmark's marketing suppression list (§21, ADR-9).
  // Enqueuing that reconciliation is the `consent.sync` job's business; the
  // API records the fact and leaves the side effect to the worker, so a
  // Postmark outage cannot make a withdrawal fail.
  ctx.logger.info(
    { consentType: parsed.consentType, status: parsed.status, source: parsed.source },
    'samtykkehendelse registrert',
  );

  return {
    id,
    consentType: parsed.consentType,
    status: parsed.status,
    source: parsed.source,
    consentTextVersion: version,
    occurredAt: now,
  };
}

/** Whether the user currently holds marketing consent. */
export async function hasMarketingConsent(ctx: ApiContext, userId: string): Promise<boolean> {
  return isConsentActive(await loadConsentEvents(ctx, userId), 'marketing_email');
}

/** The event the current marketing state was derived from, for the settings UI. */
export async function latestMarketingConsent(
  ctx: ApiContext,
  userId: string,
): Promise<ConsentEvent | undefined> {
  return latestConsentEvent(await loadConsentEvents(ctx, userId), 'marketing_email');
}
