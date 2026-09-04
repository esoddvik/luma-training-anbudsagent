import { and, desc, eq } from 'drizzle-orm';
import { isAcceptanceOutstanding, type ConsentSource } from '@luma/domain';
import * as schema from '@luma/db/schema';
import { privacyPolicyVersion, type Database } from './db';
import type { Tx } from './profile-write';

/**
 * Terms acceptance: recording it, and asking whether one is owed.
 *
 * `recordTermsAcceptance` moved here from `registration.ts`, unchanged apart
 * from taking its consent source as a parameter. It has two callers now — the
 * entry door, and the re-acceptance flow that runs when a newer version is
 * published — and a second copy of a function that writes two tables with
 * legal weight is the last thing this area needs.
 */

/**
 * Records the terms acceptance, and mirrors it into the consent log.
 *
 * This is `acceptLegalDocument` from `apps/core/src/services/legal.ts` reduced
 * to the one path registration needs, and it must stay behaviourally identical
 * to it: the same two tables, the same `accepted` status, the same
 * `consent_text_versions` row registered under the document version. Spec
 * section 21 lists `terms_acceptance` as a consent type, and until core's
 * mirror existed `GET /consents` reported `false` for a user who had just
 * accepted — two tables disagreeing about a fact with legal weight. A second
 * entry door that skipped the mirror would reintroduce exactly that split.
 *
 * `source` names where the acceptance happened and defaults to `signup`,
 * which is where the great majority arrive (spec section 9.1 step 7). The
 * re-acceptance flow passes `account_settings` instead: ADR-9 rule 4 makes a source
 * mandatory on every consent event, and recording a re-acceptance as a signup
 * would make the log say a user registered twice.
 *
 * **This does not merge what spec section 20.1 keeps apart.** The consent type
 * written here is `terms_acceptance` and nothing else. Accepting the terms
 * cannot make `marketing_email` true — no code path in this file can write
 * that type — and marketing consent stays voluntary, separate and unticked
 * (spec section 20.2).
 */
export async function recordTermsAcceptance(
  tx: Tx,
  input: {
    userId: string;
    version: string;
    body: string;
    effectiveFrom: Date;
    now: Date;
    ipAddressHash: string | null;
    userAgent: string | null;
    /**
     * ADR-9 rule 4: every consent event names where it came from.
     *
     * Typed from the domain enum rather than a local union, so a value that is
     * not a real consent source fails to compile here rather than at the
     * `INSERT`. The first draft of this used `'settings'`, which is not one.
     */
    source?: ConsentSource;
  },
): Promise<void> {
  const inserted = await tx
    .insert(schema.userLegalAcceptances)
    .values({
      userId: input.userId,
      kind: 'terms',
      version: input.version,
      acceptedAt: input.now,
      ipAddressHash: input.ipAddressHash,
    })
    // Accepting the same version twice is the same fact, and the first
    // timestamp is the one that matters evidentially.
    .onConflictDoNothing({
      target: [
        schema.userLegalAcceptances.userId,
        schema.userLegalAcceptances.kind,
        schema.userLegalAcceptances.version,
      ],
    })
    .returning({ id: schema.userLegalAcceptances.id });

  // Only a genuinely new acceptance is mirrored. A returning user confirming a
  // second profile must not append a second consent event: the log is
  // append-only, so a spurious row can never be cleaned up afterwards, and the
  // sequence *is* the evidence.
  if (inserted.length === 0) return;

  // `consent_events.consent_text_version` has a composite foreign key onto
  // `consent_text_versions`, so a row has to exist there first. For this
  // consent type the "consent text" *is* the document version the user was
  // shown, so it is registered under the same version string with the same
  // body. `onConflictDoNothing` rather than an upsert: an existing row must
  // never be rewritten, because other people's consent events point at it.
  await tx
    .insert(schema.consentTextVersions)
    .values({
      consentType: 'terms_acceptance',
      version: input.version,
      body: input.body,
      effectiveFrom: input.effectiveFrom,
      createdAt: input.now,
    })
    .onConflictDoNothing({
      target: [schema.consentTextVersions.consentType, schema.consentTextVersions.version],
    });

  await tx.insert(schema.consentEvents).values({
    userId: input.userId,
    consentType: 'terms_acceptance',
    // `accepted`, not `granted`. Spec section 20.1 calls this «obligatorisk
    // aksept», and the two words are different in the enum for the same reason
    // they are different in the specification.
    status: 'accepted',
    source: input.source ?? 'signup',
    sourceDetail:
      (input.source ?? 'signup') === 'signup'
        ? `Aksept av bruksvilkår versjon ${input.version} ved registrering.`
        : `Aksept av bruksvilkår versjon ${input.version}.`,
    policyVersion: privacyPolicyVersion() ?? null,
    termsVersion: input.version,
    consentTextVersion: input.version,
    occurredAt: input.now,
    ipAddressHash: input.ipAddressHash,
    userAgent: input.userAgent,
  });
}


/**
 * The terms version in force and whether this user still owes it
 * (spec section 20.1).
 *
 * Returns the body alongside the version so the acceptance page renders
 * exactly the text the user is being asked to accept, rather than fetching it
 * a second time and risking a different answer between the two reads.
 *
 * `null` means nothing is owed — which includes the case where no version is
 * in force at all. `isAcceptanceOutstanding` decides that, in `@luma/domain`,
 * so this and `apps/core`'s `getLegalStatus` cannot answer it differently.
 */
export async function outstandingTerms(
  db: Database,
  userId: string,
): Promise<{ version: string; body: string; effectiveFrom: Date } | null> {
  const [current] = await db
    .select({
      version: schema.legalDocumentVersions.version,
      body: schema.legalDocumentVersions.body,
      effectiveFrom: schema.legalDocumentVersions.effectiveFrom,
    })
    .from(schema.legalDocumentVersions)
    .where(eq(schema.legalDocumentVersions.kind, 'terms'))
    .orderBy(desc(schema.legalDocumentVersions.effectiveFrom))
    .limit(1);

  const [accepted] = await db
    .select({ version: schema.userLegalAcceptances.version })
    .from(schema.userLegalAcceptances)
    .where(
      and(
        eq(schema.userLegalAcceptances.userId, userId),
        eq(schema.userLegalAcceptances.kind, 'terms'),
      ),
    )
    .orderBy(desc(schema.userLegalAcceptances.acceptedAt))
    .limit(1);

  if (!isAcceptanceOutstanding(current?.version ?? null, accepted?.version ?? null)) return null;

  // Non-null whenever the decision above says something is outstanding: a null
  // current version is never outstanding.
  return current!;
}
