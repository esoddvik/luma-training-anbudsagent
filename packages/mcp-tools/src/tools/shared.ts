import type { AlertProfile, Tender } from '@luma/domain';
import type { McpScope, AuthenticatedCaller } from '../auth.js';
import { notFound, ToolError } from '../errors.js';
import { toSavedStateView, type SavedStateView } from '../presentation.js';
import type { ReadToolPorts, UserTenderState } from '../ports.js';

/** Helpers several tools need, kept in one place so the wording matches. */

export function hasScope(caller: AuthenticatedCaller, scope: McpScope): boolean {
  return caller.scopes.includes(scope);
}

export const NO_PROFILES_NB =
  'Du har ingen varslingsprofil ennå. Opprett en i varslingstjenesten først, så kan jeg matche anbud mot den.';

export const PROFILE_NOT_FOUND_NB =
  'Fant ingen varslingsprofil med den id-en. Bruk list_alert_profiles for å se dine egne profiler.';

export const TENDER_NOT_FOUND_NB =
  'Fant ingen kunngjøring med den id-en. Bruk search_tenders eller find_matching_tenders for å finne riktig id.';

export const SAVED_SCOPE_MISSING_NB =
  'Lagret- og avvist-status er utelatt fordi tokenet mangler tilgangen «saved:read».';

export const PROFILE_SCOPE_MISSING_NB =
  'Treff mot varslingsprofilene dine er utelatt fordi tokenet mangler tilgangen «profiles:read».';

function ambiguousProfileMessage(profiles: readonly AlertProfile[]): string {
  const listed = profiles.map((profile) => `${profile.name} (${profile.id})`).join(', ');
  return (
    'Du har flere aktive varslingsprofiler, så jeg vet ikke hvilken du mener. ' +
    `Oppgi profileId. Aktive profiler: ${listed}.`
  );
}

/**
 * Resolves the profile a match-oriented tool should use.
 *
 * Spec section 32.1 makes `profileId` optional without saying what happens
 * when it is left out. The reading taken here: with exactly one active profile
 * the intent is unambiguous, so use it; with several, ask rather than guess,
 * because silently picking one would attribute a match to a profile the user
 * did not mean and spec section 4.2 requires the user to be able to see why a
 * match happened.
 *
 * Every lookup is scoped by `userId`, so another user's profile id resolves to
 * the same not-found answer as a nonexistent one (ADR-0003).
 */
export async function resolveProfile(
  ports: ReadToolPorts,
  userId: string,
  profileId: string | undefined,
): Promise<AlertProfile> {
  if (profileId !== undefined) {
    const profile = await ports.profiles.getProfile(userId, profileId);
    if (profile === undefined) throw notFound(PROFILE_NOT_FOUND_NB);
    return profile;
  }

  const profiles = await ports.profiles.listProfiles(userId);
  if (profiles.length === 0) throw notFound(NO_PROFILES_NB);

  const active = profiles.filter((profile) => profile.active);
  const candidates = active.length > 0 ? active : profiles;
  const only = candidates[0];
  if (candidates.length === 1 && only !== undefined) return only;

  throw new ToolError('invalid_input', ambiguousProfileMessage(candidates));
}

/**
 * Saved and dismissed state for a set of tenders, or `null` when the token
 * carries no `saved:read` scope.
 *
 * Returning `null` rather than an empty map keeps the two cases apart in the
 * output: "you have not saved this" and "I was not allowed to look" are
 * different answers, and a model that cannot tell them apart will state the
 * first when the second is true.
 */
export async function loadSavedStates(
  ports: ReadToolPorts,
  caller: AuthenticatedCaller,
  tenderIds: readonly string[],
): Promise<Map<string, UserTenderState> | null> {
  if (!hasScope(caller, 'saved:read')) return null;
  const states = await ports.userTenderState.listStates(caller.userId, tenderIds);
  return new Map(states.map((state) => [state.tenderId, state]));
}

export function savedViewFor(
  states: Map<string, UserTenderState> | null,
  tenderId: string,
): SavedStateView | null {
  if (states === null) return null;
  return toSavedStateView(states.get(tenderId));
}

/** Deterministic ordering for a ranked list: score first, then id. */
export function compareByScoreThenId(
  a: { readonly score: number; readonly tender: Tender },
  b: { readonly score: number; readonly tender: Tender },
): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.tender.id < b.tender.id ? -1 : a.tender.id > b.tender.id ? 1 : 0;
}
