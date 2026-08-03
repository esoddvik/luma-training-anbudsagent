import { SCORE_DISCLAIMER_NB, type MatchResult, type Tender } from '@luma/domain';
import { matchTender } from '@luma/matching';
import { z } from 'zod';
import { defineReadTool } from '../registry.js';
import {
  decodeCursor,
  limitNoteNb,
  nextCursor,
  resolveLimit,
  slicePage,
  MAX_MATCH_CANDIDATES,
  MAX_PAGE_LIMIT,
} from '../pagination.js';
import { toMatchView, type MatchView } from '../presentation.js';
import { cursorSchema, dateStringSchema, idSchema, limitSchema, scoreSchema } from '../schemas.js';
import type { MatchCandidateCriteria } from '../ports.js';
import {
  compareByScoreThenId,
  loadSavedStates,
  resolveProfile,
  savedViewFor,
  SAVED_SCOPE_MISSING_NB,
} from './shared.js';

/**
 * `find_matching_tenders` (spec section 32.1).
 *
 * Ranks the user's own alert profile against the tender corpus and returns
 * "anbud, score, sikkerhet, begrunnelser, kategori, kildelenke", which is what
 * section 32.1 asks for.
 *
 * The scoring is not reimplemented here. `matchTender` from `@luma/matching`
 * is the single ranking authority (ADR-0004); this tool selects candidates,
 * calls it, and presents the result. Nothing commercial is an input, and
 * nothing commercial is in the output (ADR-0006).
 *
 * Award notices never appear. The candidate port filters them out and the
 * engine excludes them independently, which is two guards rather than one
 * because `search_awards` is a phase 8 tool (spec section 32.3) and until then
 * an award in a "here is what you could bid on" list is simply wrong.
 */

const inputSchema = z.object({
  profileId: idSchema.optional(),
  minimumScore: scoreSchema,
  includePlanned: z.boolean({ error: 'må være true eller false' }).optional(),
  publishedAfter: dateStringSchema.optional(),
  deadlineBefore: dateStringSchema.optional(),
  includeDismissed: z.boolean({ error: 'må være true eller false' }).optional(),
  limit: limitSchema,
  cursor: cursorSchema,
});

export const MATCH_NOTE_NB =
  'Tildelingskunngjøringer er ikke med i matchingen. Treffscoren er en sum av regelbaserte komponenter mot ' +
  'varslingsprofilen din, og begrunnelsene viser hva som ga poeng. Oppgi alltid kildelenken når du refererer til et anbud.';

export const CANDIDATE_CAP_NOTE_NB =
  `Kunngjøringene som ble vurdert er begrenset til de ${MAX_MATCH_CANDIDATES} nyeste. ` +
  'Snevre inn med publishedAfter eller deadlineBefore hvis du leter etter noe eldre.';

export interface FindMatchingTendersResult {
  readonly varslingsprofil: { readonly id: string; readonly navn: string };
  readonly antall: number;
  readonly treff: readonly MatchView[];
  readonly nesteCursor: string | null;
  /** `SCORE_DISCLAIMER_NB`. Present because a score is present (section 4.3). */
  readonly forbehold: string;
  readonly merknad: string;
  readonly sideMerknad: string | null;
  readonly tilgangsMerknad: string | null;
  readonly utvalgsMerknad: string | null;
}

interface Scored {
  readonly tender: Tender;
  readonly result: MatchResult;
  readonly score: number;
}

export const findMatchingTendersTool = defineReadTool({
  name: 'find_matching_tenders',
  title: 'Finn anbud som passer varslingsprofilen',
  description:
    'Rangerer norske offentlige kunngjøringer mot brukerens egen varslingsprofil og returnerer treffscore, ' +
    'sikkerhetsnivå, begrunnelser, kategori og kildelenke. Treffscoren sier hvor godt anbudet passer profilen, ' +
    'og er ikke en sannsynlighet for å vinne. Tildelingskunngjøringer er utelatt. ' +
    `Maks ${MAX_PAGE_LIMIT} treff per side; bruk nesteCursor for å hente flere.`,
  requiredScopes: ['tenders:read', 'profiles:read'],
  lumaContent: false,
  inputSchema,
  auditFacts: (input, result) => ({
    targetProfileId: result?.varslingsprofil.id ?? input.profileId ?? null,
    resultCount: result?.treff.length ?? null,
  }),
  handler: async (input, context): Promise<FindMatchingTendersResult> => {
    const limit = resolveLimit(input.limit);
    const offset = decodeCursor(input.cursor);

    const profile = await resolveProfile(context.ports, context.caller.userId, input.profileId);

    const includePlanned = input.includePlanned ?? profile.includePlannedProcurements;
    const criteria: MatchCandidateCriteria = {
      includePlanned,
      ...(input.publishedAfter !== undefined ? { publishedAfter: input.publishedAfter } : {}),
      ...(input.deadlineBefore !== undefined ? { deadlineBefore: input.deadlineBefore } : {}),
    };

    const candidates = await context.ports.tenders.listMatchCandidates(
      criteria,
      MAX_MATCH_CANDIDATES,
    );

    const minimumScore = input.minimumScore ?? profile.minimumMatchScore;

    const scored: Scored[] = [];
    for (const tender of candidates) {
      // Award notices are excluded by the engine as well; belt and braces.
      if (tender.noticeCategory === 'award') continue;
      const result = matchTender(tender, profile, { now: context.now });
      if (result.exclusions.length > 0) continue;
      if (result.score < minimumScore) continue;
      scored.push({ tender, result, score: result.score });
    }

    scored.sort(compareByScoreThenId);

    const savedStates = await loadSavedStates(
      context.ports,
      context.caller,
      scored.map((entry) => entry.tender.id),
    );

    const includeDismissed = input.includeDismissed ?? false;
    const visible =
      savedStates === null || includeDismissed
        ? scored
        : scored.filter((entry) => savedStates.get(entry.tender.id)?.dismissed !== true);

    const page = slicePage(visible, offset, limit);

    return {
      varslingsprofil: { id: profile.id, navn: profile.name },
      antall: page.items.length,
      treff: page.items.map((entry) =>
        toMatchView(entry.tender, entry.result, savedViewFor(savedStates, entry.tender.id)),
      ),
      nesteCursor: nextCursor(offset, page.items.length, page.hasMore),
      forbehold: SCORE_DISCLAIMER_NB,
      merknad: MATCH_NOTE_NB,
      sideMerknad: limitNoteNb(input.limit),
      tilgangsMerknad: savedStates === null ? SAVED_SCOPE_MISSING_NB : null,
      utvalgsMerknad: candidates.length >= MAX_MATCH_CANDIDATES ? CANDIDATE_CAP_NOTE_NB : null,
    };
  },
});
