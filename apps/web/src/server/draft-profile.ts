import { alertProfileInputSchema, type AlertProfileInput } from '@luma/domain';
import { safeReturnPath } from '@/lib/return-path';

/**
 * The profile an anonymous visitor assembles before they have an account
 * (IDE Agent Spec v3, sections 3.1 and 3.2).
 *
 * A draft is not a profile. It has no owner, it is not matched against
 * anything, and it may never be written into `alert_profiles` until somebody
 * has confirmed the address and accepted the terms. What it has to be is
 * *convertible*: the moment the confirmation link is clicked, the draft becomes
 * a real profile with no further questions asked, so anything the profile
 * tables will reject has to be rejected here instead.
 *
 * `alertProfileInputSchema` is that check, and it is deliberately the same
 * schema the authenticated API validates against — "the subset a user may
 * submit; the server owns ids and timestamps" is exactly the description of a
 * draft. Validating against a bespoke looser schema would let a draft exist
 * that cannot become a profile, and the failure would land at confirmation
 * time, after the email, where the user can do nothing about it.
 */

export type DraftProfile = AlertProfileInput;

/**
 * Where the draft is stored between the search surface and the confirmation.
 *
 * `jsonb`, so it round-trips through the database as plain JSON. Dates are the
 * reason this needs saying: `alertProfileInputSchema` omits `createdAt` and
 * `updatedAt`, so the draft carries no `Date` at all and survives
 * `JSON.stringify` unchanged. A future field of type `z.date()` would break
 * that silently, which is what `parseDraftProfile` failing loudly is for.
 */
export function serialiseDraftProfile(draft: DraftProfile): unknown {
  return JSON.parse(JSON.stringify(draft)) as unknown;
}

export type ParsedDraft =
  | { readonly ok: true; readonly draft: DraftProfile }
  | { readonly ok: false; readonly reason: string };

/**
 * Validates a stored draft on the way *out*, not on the way in.
 *
 * Rows outlive deploys. A draft written on Monday is confirmed on Tuesday,
 * possibly against a schema that changed in between, and a row that was valid
 * when it was written can be invalid when it is read. Checking here means that
 * failure is one user's confirmation returning a Norwegian error, rather than a
 * constraint violation halfway through the transaction that creates their
 * account.
 */
export function parseDraftProfile(value: unknown): ParsedDraft {
  const parsed = alertProfileInputSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.issues.map((issue) => issue.path.join('.')).join(', '),
    };
  }
  return { ok: true, draft: parsed.data };
}

/**
 * Builds a draft from a service template plus an optional region.
 *
 * The defaults here are the ones spec section 11 and ADR-17 already settled for
 * onboarding, restated in one place so the anonymous surface and the signed-in
 * form cannot drift apart:
 *
 * - `active: false`. A profile starts paused whichever door it came through.
 *   Spec section 9.1 previews (step 11) and adjusts (step 12) before activating
 *   (step 13), and IDE Agent Spec v3 section 3.2 keeps paused-on-create at
 *   launch explicitly, to be revisited against funnel data rather than guessed
 *   at now.
 * - `includePlannedProcurements: true`, per the spec change log item 33.
 * - Daily at 07:00 Europe/Oslo, matching the column defaults in `profiles.ts`.
 */
export function draftFromTemplate(input: {
  templateName: string;
  cpvInclude: readonly string[];
  keywordsInclude: readonly string[];
  regionsInclude?: readonly string[];
  serviceTemplateId?: string;
}): DraftProfile {
  return {
    name: input.templateName,
    active: false,
    ...(input.serviceTemplateId ? { serviceTemplateId: input.serviceTemplateId } : {}),
    cpvInclude: [...input.cpvInclude],
    cpvExclude: [],
    keywordsInclude: [...input.keywordsInclude],
    keywordsExclude: [],
    regionsInclude: [...(input.regionsInclude ?? [])],
    // Always empty: the source exposes no municipality field. See
    // docs/spec-deviations.md — this is not a missing ingest step.
    municipalitiesInclude: [],
    buyerInclude: [],
    buyerExclude: [],
    noticeTypes: [],
    includePlannedProcurements: true,
    procedureTypes: [],
    frequency: 'daily',
    digestHourLocal: 7,
    timezone: 'Europe/Oslo',
    minimumMatchScore: 0,
  };
}

/**
 * The `retur` slug, sanitised.
 *
 * Re-exported through this module rather than imported directly by
 * `registration.ts` so that every value which travels the draft's path is
 * sanitised by the same function. The slug ends up in an email that a person
 * will click, so an open redirect smuggled through it would be a phishing hop
 * wearing Luma's domain — the same reasoning `login.ts` records for the login
 * link.
 */
export function safeDraftReturnPath(raw: string | undefined): string | undefined {
  return safeReturnPath(raw);
}
