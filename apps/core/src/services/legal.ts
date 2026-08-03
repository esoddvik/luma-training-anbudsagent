import { and, desc, eq } from 'drizzle-orm';
import { legalDocumentVersions, userLegalAcceptances } from '@luma/db';
import { legalDocumentKindSchema, type LegalDocumentKind } from '@luma/domain';
import { z } from 'zod';
import { badRequest, parseOrThrow } from '../routes/errors.js';
import { hashIpAddress } from './email-context.js';
import type { Actor, ApiContext } from './context.js';

/**
 * Acceptance of terms and privacy information (spec §19, §20.1, ADR-0011).
 *
 * Insert-only, like consent. An acceptance names the exact version accepted,
 * so publishing a new version does not retroactively change what anyone agreed
 * to; it creates a new outstanding acceptance instead.
 *
 * This is kept separate from `consent_events` on purpose. Spec §20.1 is
 * explicit that accepting the terms is *not* marketing consent, and storing
 * them in one place invites the confusion the spec spends a section
 * preventing.
 */

export const acceptLegalInputSchema = z.object({
  kind: legalDocumentKindSchema,
  /** Omitted means the version currently in force. */
  version: z.string().trim().min(1).optional(),
});

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
    .select({ version: legalDocumentVersions.version })
    .from(legalDocumentVersions)
    .where(
      and(eq(legalDocumentVersions.kind, parsed.kind), eq(legalDocumentVersions.version, version)),
    )
    .limit(1);
  if (known.length === 0) {
    throw badRequest('legal_version_unknown', 'Ukjent versjon av dokumentet.');
  }

  const acceptedAt = ctx.now();
  await ctx.db
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
    });

  return { kind: parsed.kind, version, acceptedAt };
}
