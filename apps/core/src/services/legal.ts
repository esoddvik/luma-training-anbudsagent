import { and, desc, eq } from 'drizzle-orm';
import {
  consentEvents,
  consentTextVersions,
  legalDocumentVersions,
  userLegalAcceptances,
} from '@luma/db';
import {
  consentSourceSchema,
  legalDocumentKindSchema,
  type ConsentType,
  type LegalDocumentKind,
} from '@luma/domain';
import { z } from 'zod';
import { badRequest, parseOrThrow } from '../routes/errors.js';
import { hashIpAddress } from './email-context.js';
import type { Actor, ApiContext } from './context.js';

/**
 * Acceptance of terms and privacy information (spec §19, §20.1, §21, ADR-0011).
 *
 * Insert-only, like consent. An acceptance names the exact version accepted,
 * so publishing a new version does not retroactively change what anyone agreed
 * to; it creates a new outstanding acceptance instead.
 *
 * ## Why an acceptance also writes a consent event
 *
 * `user_legal_acceptances` is the record of *which document version* somebody
 * accepted, and it stays. But spec §21 lists `terms_acceptance` and
 * `privacy_acknowledgement` as consent types in `consent_events`, and until
 * this mirror existed `GET /consents` reported `terms_acceptance: false` for a
 * user who had just accepted the terms. Two tables disagreeing about a fact
 * with legal weight is worse than either arrangement on its own.
 *
 * So an acceptance now writes both: the acceptance row, and one
 * `consent_events` row with status `accepted`.
 *
 * **This does not merge the two ideas that §20.1 keeps apart.** The consent
 * type is `terms_acceptance` or `privacy_acknowledgement` — never
 * `marketing_email`. Accepting the terms cannot make `marketing_email` true,
 * because no code path here can write that type, and marketing consent remains
 * voluntary, separate and unticked by default (§20.2). The integration test
 * `accepting the terms grants no marketing consent` is the assertion.
 */

export const acceptLegalInputSchema = z.object({
  kind: legalDocumentKindSchema,
  /** Omitted means the version currently in force. */
  version: z.string().trim().min(1).optional(),
  /**
   * Where the acceptance happened, recorded on the mirrored consent event.
   * Defaults to `signup`: §9.1 step 7 is where the great majority of these
   * arrive, and a source is mandatory on every consent event (ADR-9 rule 4).
   */
  source: consentSourceSchema.default('signup'),
});

/**
 * The consent type each legal document maps to (spec §21).
 *
 * A total mapping rather than a lookup that can return undefined: adding a
 * third `legal_document_kind` should fail to compile here rather than silently
 * stop mirroring.
 */
const CONSENT_TYPE_FOR_KIND = {
  terms: 'terms_acceptance',
  privacy: 'privacy_acknowledgement',
} as const satisfies Record<LegalDocumentKind, ConsentType>;

export interface LegalStatusItem {
  readonly kind: LegalDocumentKind;
  readonly currentVersion: string | null;
  readonly acceptedVersion: string | null;
  readonly acceptedAt: Date | null;
  /** True when the user has not accepted the version now in force. */
  readonly outstanding: boolean;
  /** Blocks public launch while true (spec §51 item 8). */
  readonly isPlaceholder: boolean;
}

async function currentVersionRow(ctx: ApiContext, kind: LegalDocumentKind) {
  const rows = await ctx.db
    .select()
    .from(legalDocumentVersions)
    .where(eq(legalDocumentVersions.kind, kind))
    .orderBy(desc(legalDocumentVersions.effectiveFrom))
    .limit(1);
  return rows[0];
}

export async function getLegalStatus(
  ctx: ApiContext,
  actor: Actor,
): Promise<readonly LegalStatusItem[]> {
  const kinds: readonly LegalDocumentKind[] = ['terms', 'privacy'];
  const accepted = await ctx.db
    .select()
    .from(userLegalAcceptances)
    .where(eq(userLegalAcceptances.userId, actor.userId))
    .orderBy(desc(userLegalAcceptances.acceptedAt));

  return Promise.all(
    kinds.map(async (kind) => {
      const current = await currentVersionRow(ctx, kind);
      const mine = accepted.find((row) => row.kind === kind);
      return {
        kind,
        currentVersion: current?.version ?? null,
        acceptedVersion: mine?.version ?? null,
        acceptedAt: mine?.acceptedAt ?? null,
        outstanding: Boolean(current) && mine?.version !== current?.version,
        isPlaceholder: current?.isPlaceholder ?? true,
      };
    }),
  );
}

export interface AcceptLegalInput {
  readonly body: unknown;
  readonly ipAddress?: string;
}

export async function acceptLegalDocument(
  ctx: ApiContext,
  actor: Actor,
  input: AcceptLegalInput,
): Promise<{ kind: LegalDocumentKind; version: string; acceptedAt: Date }> {
  const parsed = parseOrThrow(acceptLegalInputSchema, input.body);

  const version = parsed.version ?? (await currentVersionRow(ctx, parsed.kind))?.version;
  if (!version) {
    throw badRequest('legal_version_missing', 'Vi mangler en gjeldende versjon av dokumentet.');
  }

  // The acceptance has a composite foreign key onto the version. Checking
  // first turns "you accepted something that does not exist" into a Norwegian
  // 400 rather than a leaked constraint name.
  const known = await ctx.db
    .select()
    .from(legalDocumentVersions)
    .where(
      and(eq(legalDocumentVersions.kind, parsed.kind), eq(legalDocumentVersions.version, version)),
    )
    .limit(1);
  const documentVersion = known[0];
  if (!documentVersion) {
    throw badRequest('legal_version_unknown', 'Ukjent versjon av dokumentet.');
  }

  const acceptedAt = ctx.now();
  const inserted = await ctx.db
    .insert(userLegalAcceptances)
    .values({
      userId: actor.userId,
      kind: parsed.kind,
      version,
      acceptedAt,
      ipAddressHash: hashIpAddress(input.ipAddress, ctx.config.authSecret),
    })
    // Accepting the same version twice is the same fact, and the first
    // timestamp is the one that matters evidentially.
    .onConflictDoNothing({
      target: [
        userLegalAcceptances.userId,
        userLegalAcceptances.kind,
        userLegalAcceptances.version,
      ],
    })
    .returning({ id: userLegalAcceptances.id });

  // Only a genuinely new acceptance is mirrored. Re-posting the same version —
  // a double-clicked button, a replayed form — must not append a second
  // consent event: the log is append-only, so a spurious row can never be
  // cleaned up afterwards, and the sequence *is* the evidence.
  if (inserted.length > 0) {
    await mirrorIntoConsentLog(ctx, {
      userId: actor.userId,
      kind: parsed.kind,
      version,
      body: documentVersion.body,
      effectiveFrom: documentVersion.effectiveFrom,
      source: parsed.source,
      occurredAt: acceptedAt,
      ipAddress: input.ipAddress,
    });
  }

  return { kind: parsed.kind, version, acceptedAt };
}

interface MirrorInput {
  readonly userId: string;
  readonly kind: LegalDocumentKind;
  readonly version: string;
  readonly body: string;
  readonly effectiveFrom: Date;
  readonly source: z.infer<typeof consentSourceSchema>;
  readonly occurredAt: Date;
  readonly ipAddress?: string;
}

/**
 * Appends the `accepted` consent event for a legal acceptance (spec §21).
 *
 * `consent_events.consent_text_version` has a composite foreign key onto
 * `consent_text_versions`, so a row has to exist there first. For these two
 * consent types the "consent text" *is* the document version the user was
 * shown, so it is registered under the same version string with the same body.
 * That keeps ADR-9 rule 3 honest — the literal wording is captured by
 * reference — without asking an operator to remember to seed a parallel table
 * every time the terms are republished.
 *
 * `onConflictDoNothing` rather than an upsert: an existing row must never be
 * rewritten, because other people's consent events already point at it.
 */
async function mirrorIntoConsentLog(ctx: ApiContext, input: MirrorInput): Promise<void> {
  const consentType = CONSENT_TYPE_FOR_KIND[input.kind];
  const now = ctx.now();

  await ctx.db
    .insert(consentTextVersions)
    .values({
      consentType,
      version: input.version,
      body: input.body,
      effectiveFrom: input.effectiveFrom,
      createdAt: now,
    })
    .onConflictDoNothing({
      target: [consentTextVersions.consentType, consentTextVersions.version],
    });

  await ctx.db.insert(consentEvents).values({
    userId: input.userId,
    consentType,
    // `accepted`, not `granted`. §20.1 calls this «obligatorisk aksept», and
    // the two words are different in the enum for the same reason they are
    // different in the specification.
    status: 'accepted',
    source: input.source,
    sourceDetail: `Aksept av ${input.kind === 'terms' ? 'bruksvilkår' : 'personvernerklæring'} versjon ${input.version}.`,
    policyVersion: ctx.config.currentPrivacyPolicyVersion,
    termsVersion: ctx.config.currentTermsVersion,
    consentTextVersion: input.version,
    occurredAt: input.occurredAt,
    ipAddressHash: hashIpAddress(input.ipAddress, ctx.config.authSecret),
    createdAt: now,
  });
}
