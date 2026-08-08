import { cookies } from 'next/headers';
import { and, desc, eq, gte, isNull, type SQL } from 'drizzle-orm';
import {
  emailSchema,
  generateToken,
  hashToken,
  issueSession,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
} from '@luma/auth';
import { appUrlFor, renderSignupConfirmation } from '@luma/email';
import * as schema from '@luma/db/schema';
import { BASE_PATH } from '@/lib/site';
import { authPepper, getWebDb, privacyPolicyVersion, type Database } from './db';
import { hashIpAddress } from './client-identity';
import { appUrl, baseEmailContext, getWebEmailClient } from './email';
import {
  parseDraftProfile,
  safeDraftReturnPath,
  serialiseDraftProfile,
  type DraftProfile,
} from './draft-profile';
import { writeCriteria, type Tx } from './profile-write';

/**
 * The search-first entry door (IDE Agent Spec v3, section 3.1).
 *
 * Registration used to be the first thing that happened. Now it is the last:
 * an anonymous visitor picks a service template, sees real notices, and only
 * then leaves an address. By the time this module runs, the person already has
 * a profile in mind and the only questions left are "is this address yours" and
 * "do you accept the terms".
 *
 * ## The one property this module exists to hold
 *
 * **The caller cannot tell whether the address already has an account.** Not
 * from the message, not from the shape of the result, not from the redirect,
 * and — as far as `MIN_RESPONSE_MS` reaches — not from how long it took. Spec
 * section 10 requires this of the login form and the reasoning is identical
 * here, with one thing added: this form is *public and indexed*, sitting at the
 * end of a funnel designed to attract exactly the people whose competitors
 * would most like a customer list. A registration form that answers "that
 * address is taken" is a customer list with a submit button.
 *
 * ## Why both branches send an email, and why that is the easy part
 *
 * `login.ts` sends nothing to an unknown address, and documents at length why
 * that is right *there*: a login link for an account that does not exist cannot
 * work, and creating one on redemption would manufacture a user with no terms
 * acceptance behind it. Registration inverts both facts. Creating the account
 * is the whole point, and the acceptance is collected before the email goes
 * out, so both branches have something true to say.
 *
 * That makes the timing story much better than the login form's, and it is
 * worth being precise about why rather than just asserting it. The expensive,
 * loud operation is the Postmark round trip. On the login form only one branch
 * makes it, so the padding in `login.ts` is doing real work against a real
 * difference. Here *both* branches make it, so the two paths are the same
 * shape: same database reads, same insert, same HTTPS call. The floor below is
 * therefore a second line of defence rather than the primary one.
 */

/**
 * How long a confirmation link lives.
 *
 * Deliberately longer than the magic link's fifteen minutes. A login link is
 * clicked by someone sitting at the login screen; a signup confirmation is
 * clicked by someone who has just been interrupted, and an expired link here
 * costs the whole funnel rather than one retry. An hour is still far short of
 * the window in which an abandoned address is worth anything to anyone.
 */
export const SIGNUP_TTL_MINUTES = 60;

/** Per address, and separately per client IP. Mirrors `MAGIC_LINK_RATE_LIMIT`. */
export const SIGNUP_RATE_LIMIT = {
  maxPerAddressPerHour: 5,
  maxPerIpPerHour: 20,
} as const;

/** Where the emailed link lands. Must match the route under `app/`. */
const SIGNUP_CONFIRM_PATH = '/registrering/bekreft';

const HOUR_MS = 3_600_000;

/**
 * The floor on how long a submission takes, in milliseconds.
 *
 * See the note above on why this is a second line of defence here rather than
 * the primary one: both branches make the same Postmark round trip, so the
 * difference this is smoothing is a single indexed `SELECT` on `users`.
 *
 * Stated honestly, because the weaker version of the claim is the dangerous
 * one: this narrows the channel, it does not delete it. A Postmark call slower
 * than the floor still finishes late. Closing it completely means moving the
 * send off the request path entirely — a queue, which the web app does not
 * have. Recorded rather than papered over, exactly as `login.ts` records it.
 */
const MIN_RESPONSE_MS = 400;

async function padTo(startedAt: number, floorMs: number): Promise<void> {
  const remaining = floorMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

export interface RequestSignupInput {
  readonly email: string;
  readonly draft: DraftProfile;
  /** Which service template the visitor came through, for the funnel. */
  readonly serviceTemplateSlug?: string | undefined;
  readonly returnPath?: string | undefined;
  readonly ipAddress?: string | undefined;
  readonly userAgent?: string | undefined;
}

/**
 * The generic Norwegian answer. One sentence, one meaning, both branches.
 *
 * It says an email is on its way and nothing else. It must never grow a clause
 * that only makes sense for one of the two cases — "welcome back", "check your
 * inbox to finish creating your account" — because either would answer the
 * question this whole module refuses to answer.
 */
export const SIGNUP_GENERIC_RESPONSE_NB =
  'Hvis adressen kan brukes, har vi sendt en e-post med en lenke for å bekrefte. Sjekk innboksen.';

export type RequestSignupResult =
  | {
      readonly ok: true;
      /** Always `SIGNUP_GENERIC_RESPONSE_NB`. Never varies. */
      readonly message: string;
      /**
       * Whether the address already had an account. **For tests and logs
       * only.** No caller may branch on it when producing anything a requester
       * can observe — not the message, not the redirect, not the status code.
       * It exists so the integration test can assert the two cases are
       * indistinguishable, which is impossible to check without knowing which
       * case you are in.
       */
      readonly hadExistingAccount: boolean;
    }
  | { readonly ok: false; readonly reason: 'rate_limited' };

export async function requestSignupConfirmation(
  input: RequestSignupInput,
): Promise<RequestSignupResult> {
  const startedAt = Date.now();
  const result = await issueOrNot(input);
  // The rate-limited answer is deliberately distinguishable — it has to be, it
  // asks the user to wait — but it says nothing about whether the address is
  // registered, because the budget is checked before the account is looked up.
  await padTo(startedAt, MIN_RESPONSE_MS);
  return result;
}

async function issueOrNot(input: RequestSignupInput): Promise<RequestSignupResult> {
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) {
    // A malformed address gets the generic answer too. "That is not an email
    // address" is harmless in itself, but the branch is not: it is one more
    // observable difference between inputs, and the form's `type="email"`
    // already catches the honest typo in browsers that run JavaScript.
    return { ok: true, message: SIGNUP_GENERIC_RESPONSE_NB, hadExistingAccount: false };
  }

  const email = parsed.data;
  const db = getWebDb();
  const pepper = authPepper();
  const now = new Date();
  const since = new Date(now.getTime() - HOUR_MS);
  const ipHash = hashIpAddress(input.ipAddress, pepper);

  // Per address and per client, because neither budget is sufficient alone:
  // the address budget does nothing against one host walking an address list,
  // and the client budget does nothing against a botnet hammering one address.
  const recentForAddress = await countSince(db, eq(schema.pendingSignups.email, email), since);
  if (recentForAddress >= SIGNUP_RATE_LIMIT.maxPerAddressPerHour) {
    return { ok: false, reason: 'rate_limited' };
  }

  if (ipHash) {
    const recentForIp = await countSince(
      db,
      eq(schema.pendingSignups.requestIpHash, ipHash),
      since,
    );
    if (recentForIp >= SIGNUP_RATE_LIMIT.maxPerIpPerHour) {
      return { ok: false, reason: 'rate_limited' };
    }
  }

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  const hasExistingAccount = Boolean(user);

  const issued = generateToken(pepper);
  const expiresAt = new Date(now.getTime() + SIGNUP_TTL_MINUTES * 60_000);
  const safeReturn = safeDraftReturnPath(input.returnPath);

  await db.insert(schema.pendingSignups).values({
    email,
    // Only the hash is stored. The token itself exists in the sent email and
    // in this function's local scope, and nowhere else (spec section 47).
    tokenHash: issued.tokenHash,
    draftProfile: serialiseDraftProfile(input.draft),
    serviceTemplateSlug: input.serviceTemplateSlug ?? null,
    returnPath: safeReturn ?? null,
    requestedAt: now,
    expiresAt,
    requestIpHash: ipHash,
    userAgent: input.userAgent ?? null,
  });

  // `appUrlFor`, not `new URL(path, appUrl())`. The app is served under
  // `/anbudsvarsling` on Luma Training's domain, so `APP_URL` carries that
  // prefix, and resolving a leading-slash path against it throws the prefix
  // away — sending the confirmation link to the marketing site's 404 page with
  // nothing logged anywhere. `appUrlFor`'s own test is the guard on it.
  const confirmUrl = appUrlFor(appUrl(), SIGNUP_CONFIRM_PATH, {
    token: issued.token,
    ...(safeReturn ? { retur: safeReturn } : {}),
  });

  const rendered = renderSignupConfirmation({
    ...baseEmailContext(email, now),
    confirmUrl,
    validForMinutes: SIGNUP_TTL_MINUTES,
    // The one value in the whole request that varies with whether the address
    // is known, and it varies only inside the recipient's own inbox.
    hasExistingAccount,
    profileName: input.draft.name,
  });

  // Transactional stream, always. A confirmation on the marketing stream would
  // be silenced by an unrelated spam complaint and stop the person creating an
  // account at all (ADR-0005).
  await getWebEmailClient().sendTransactional(rendered, { to: email });

  return {
    ok: true,
    message: SIGNUP_GENERIC_RESPONSE_NB,
    hadExistingAccount: hasExistingAccount,
  };
}

/** Counts pending-signup rows matching a predicate since a point in time. */
async function countSince(db: Database, predicate: SQL, since: Date): Promise<number> {
  const rows = await db
    .select({ id: schema.pendingSignups.id })
    .from(schema.pendingSignups)
    .where(and(predicate, gte(schema.pendingSignups.requestedAt, since)));
  return rows.length;
}

export type ConfirmSignupResult =
  | {
      readonly ok: true;
      readonly userId: string;
      readonly profileId: string;
      /** Where to send them next, already sanitised. */
      readonly returnPath: string | undefined;
    }
  | {
      readonly ok: false;
      readonly reason: 'invalid' | 'expired' | 'already_used' | 'draft_invalid' | 'no_terms';
      readonly message: string;
    };

/** Every failure says the same thing: ask for a new link. */
export const CONFIRM_FAILURE_NB = {
  invalid: 'Lenken er ikke gyldig. Sett opp varslingen på nytt, så sender vi en ny lenke.',
  expired: 'Lenken har gått ut. Sett opp varslingen på nytt, så sender vi en ny lenke.',
  already_used: 'Lenken er allerede brukt. Logg inn for å se varslingsprofilen din.',
  draft_invalid: 'Vi klarte ikke å lese kriteriene. Sett opp varslingen på nytt.',
  no_terms: 'Tjenesten mangler gjeldende bruksvilkår. Prøv igjen senere.',
} as const;

/**
 * Redeems a confirmation token: creates the account, records the acceptance,
 * writes the profile, and establishes the session. All or nothing.
 *
 * ## Why this is one transaction
 *
 * Four writes have to happen together, and every partial outcome is a bug with
 * a name:
 *
 * - user without acceptance — the record spec section 20.1 exists to make
 *   impossible: an account whose holder never agreed to anything.
 * - acceptance without user — an orphaned legal record naming nobody.
 * - user without profile — the person confirmed an address to get alerts and
 *   arrives at an empty dashboard, with no way to recover what they built.
 * - profile without criteria — a profile that matches everything, which is the
 *   worst of the four, because it looks like it worked and then floods them.
 *
 * The claim on the pending row is inside the same transaction, which is what
 * makes a double-click safe: the conditional update either wins or the whole
 * transaction rolls back, so two concurrent clicks cannot produce two accounts.
 *
 * ## What the draft is *not* trusted for
 *
 * `active` is forced to `false` regardless of what the draft says. It is the
 * one field a stored draft could carry that would have an effect the user did
 * not ask for at confirmation time — a profile that starts sending immediately
 * — and paused-on-create is an explicit launch decision (IDE Agent Spec v3,
 * section 3.2), not a default worth inheriting from data.
 */
export async function confirmSignup(token: string | undefined): Promise<ConfirmSignupResult> {
  if (!token) {
    return { ok: false, reason: 'invalid', message: CONFIRM_FAILURE_NB.invalid };
  }

  const db = getWebDb();
  const pepper = authPepper();
  const now = new Date();
  const tokenHash = hashToken(token, pepper);

  const [row] = await db
    .select()
    .from(schema.pendingSignups)
    .where(eq(schema.pendingSignups.tokenHash, tokenHash))
    .limit(1);

  if (!row) return { ok: false, reason: 'invalid', message: CONFIRM_FAILURE_NB.invalid };
  if (row.consumedAt) {
    return { ok: false, reason: 'already_used', message: CONFIRM_FAILURE_NB.already_used };
  }
  if (row.expiresAt <= now) {
    return { ok: false, reason: 'expired', message: CONFIRM_FAILURE_NB.expired };
  }

  const draft = parseDraftProfile(row.draftProfile);
  if (!draft.ok) {
    return { ok: false, reason: 'draft_invalid', message: CONFIRM_FAILURE_NB.draft_invalid };
  }

  // Resolved before the transaction opens: without a terms version in force
  // there is no lawful way to create the account at all (spec section 20.1),
  // and finding that out mid-transaction would mean rolling back work that
  // was never going to be allowed.
  const [termsVersion] = await db
    .select({
      version: schema.legalDocumentVersions.version,
      body: schema.legalDocumentVersions.body,
      effectiveFrom: schema.legalDocumentVersions.effectiveFrom,
    })
    .from(schema.legalDocumentVersions)
    .where(eq(schema.legalDocumentVersions.kind, 'terms'))
    .orderBy(desc(schema.legalDocumentVersions.effectiveFrom))
    .limit(1);

  if (!termsVersion) {
    return { ok: false, reason: 'no_terms', message: CONFIRM_FAILURE_NB.no_terms };
  }

  const outcome = await db.transaction(async (tx) => {
    // The claim. A conditional update whose row count decides the answer, for
    // the same reason `databaseMagicLinkStore.consume` is written that way:
    // reading `consumed_at` and then updating leaves a window in which two
    // requests both succeed, and that window is not hypothetical — mail
    // scanners routinely fetch a link moments before the recipient clicks it.
    const claimed = await tx
      .update(schema.pendingSignups)
      .set({ consumedAt: now })
      .where(and(eq(schema.pendingSignups.id, row.id), isNull(schema.pendingSignups.consumedAt)))
      .returning({ id: schema.pendingSignups.id });

    if (claimed.length !== 1) return { claimed: false } as const;

    const userId = await findOrCreateUser(tx, { email: row.email, now });
    await recordTermsAcceptance(tx, {
      userId,
      version: termsVersion.version,
      body: termsVersion.body,
      effectiveFrom: termsVersion.effectiveFrom,
      now,
      ipAddressHash: row.requestIpHash,
      userAgent: row.userAgent,
    });
    const profileId = await createProfileFromDraft(tx, { userId, draft: draft.draft });

    return { claimed: true, userId, profileId } as const;
  });

  if (!outcome.claimed) {
    return { ok: false, reason: 'already_used', message: CONFIRM_FAILURE_NB.already_used };
  }

  await establishSession(db, outcome.userId, now);

  return {
    ok: true,
    userId: outcome.userId,
    profileId: outcome.profileId,
    returnPath: safeDraftReturnPath(row.returnPath ?? undefined),
  };
}

/**
 * Finds the account or creates it.
 *
 * `emailVerifiedAt` is set on creation, and that is the point of the whole
 * round trip: the person proved the address is theirs by clicking a link sent
 * to it. An existing user's verification timestamp is left alone rather than
 * refreshed — it records when the address was first proven, and moving it
 * forward would destroy that fact for no gain.
 */
async function findOrCreateUser(tx: Tx, input: { email: string; now: Date }): Promise<string> {
  const [existing] = await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, input.email))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await tx
    .insert(schema.users)
    .values({
      email: input.email,
      emailVerifiedAt: input.now,
    })
    .returning({ id: schema.users.id });

  if (!created) throw new Error('Kunne ikke opprette brukeren.');
  return created.id;
}

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
 * `signup` is the source, which is what it is: spec section 9.1 step 7.
 *
 * **This does not merge what spec section 20.1 keeps apart.** The consent type
 * written here is `terms_acceptance` and nothing else. Accepting the terms
 * cannot make `marketing_email` true — no code path in this file can write
 * that type — and marketing consent stays voluntary, separate and unticked
 * (spec section 20.2).
 */
async function recordTermsAcceptance(
  tx: Tx,
  input: {
    userId: string;
    version: string;
    body: string;
    effectiveFrom: Date;
    now: Date;
    ipAddressHash: string | null;
    userAgent: string | null;
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
    source: 'signup',
    sourceDetail: `Aksept av bruksvilkår versjon ${input.version} ved registrering.`,
    policyVersion: privacyPolicyVersion() ?? null,
    termsVersion: input.version,
    consentTextVersion: input.version,
    occurredAt: input.now,
    ipAddressHash: input.ipAddressHash,
    userAgent: input.userAgent,
  });
}

async function createProfileFromDraft(
  tx: Tx,
  input: { userId: string; draft: DraftProfile },
): Promise<string> {
  const { draft } = input;
  const [created] = await tx
    .insert(schema.alertProfiles)
    .values({
      userId: input.userId,
      name: draft.name,
      description: draft.description ?? null,
      // Forced, never inherited from the draft. See the note on `confirmSignup`.
      active: false,
      serviceTemplateId: draft.serviceTemplateId ?? null,
      includePlannedProcurements: draft.includePlannedProcurements,
      estimatedValueMinNok: draft.estimatedValueMinNok ?? null,
      estimatedValueMaxNok: draft.estimatedValueMaxNok ?? null,
      deadlineMinimumDays: draft.deadlineMinimumDays ?? null,
      frequency: draft.frequency,
      digestHourLocal: draft.digestHourLocal,
      timezone: draft.timezone,
      minimumMatchScore: draft.minimumMatchScore,
      noticeTypes: [...draft.noticeTypes],
      procedureTypes: [...draft.procedureTypes],
    })
    .returning({ id: schema.alertProfiles.id });

  if (!created) throw new Error('Kunne ikke opprette varslingsprofilen.');
  await writeCriteria(tx, created.id, draft);
  return created.id;
}

/** Issues the session and sets the cookie, identically to `completeLogin`. */
async function establishSession(db: Database, userId: string, now: Date): Promise<void> {
  const session = issueSession({ pepper: authPepper(), now });

  await db.insert(schema.sessions).values({
    userId,
    tokenHash: session.tokenHash,
    expiresAt: session.expiresAt,
    lastUsedAt: now,
  });

  const jar = await cookies();
  jar.set(
    SESSION_COOKIE_NAME,
    session.token,
    // Scoped to the base path, for the reason `completeLogin` records: this app
    // shares `luma-training.com` with the marketing site, so a cookie at `/`
    // would be sent with every request for every page of that site.
    sessionCookieOptions({
      isProduction: process.env.NODE_ENV === 'production',
      path: BASE_PATH,
    }),
  );
}
