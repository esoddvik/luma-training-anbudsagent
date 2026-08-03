import type { AlertProfile } from '@luma/domain';
import { z } from 'zod';
import { defineReadTool } from '../registry.js';
import { notFound } from '../errors.js';
import { idSchema } from '../schemas.js';
import { PROFILE_NOT_FOUND_NB } from './shared.js';

/**
 * `list_alert_profiles` and `get_alert_profile` (spec section 32.1): read the
 * user's own profiles.
 *
 * Both go through `ProfileReadPort`, whose every method takes `userId`, so
 * there is no call either tool could make that would return someone else's
 * profile. An id belonging to another user produces the same not-found answer
 * as an id that does not exist, which keeps `get_alert_profile` from working
 * as an existence oracle (ADR-0003).
 *
 * The output states the profile as the user set it up. It carries no score, so
 * no disclaimer is needed here, and nothing commercial: an alert profile is
 * the one user input to matching and there is nothing commercial in it by
 * design (ADR-0006).
 */

const FREQUENCY_LABEL_NB: Readonly<Record<AlertProfile['frequency'], string>> = {
  immediate: 'Umiddelbart varsel',
  daily: 'Daglig sammendrag',
  weekly: 'Ukentlig sammendrag',
};

export interface AlertProfileSummaryView {
  readonly id: string;
  readonly navn: string;
  readonly aktiv: boolean;
  readonly frekvens: AlertProfile['frequency'];
  readonly frekvensLabel: string;
  readonly antallCpvKoder: number;
  readonly antallSokeord: number;
  readonly omrader: readonly string[];
  readonly minimumTreffscore: number;
  readonly inkludererPlanlagteAnskaffelser: boolean;
  readonly sistEndret: string;
}

export interface AlertProfileDetailView extends AlertProfileSummaryView {
  readonly beskrivelse: string | null;
  readonly cpvInkluder: readonly string[];
  readonly cpvEkskluder: readonly string[];
  readonly sokeordInkluder: readonly string[];
  readonly sokeordEkskluder: readonly string[];
  readonly oppdragsgivereInkluder: readonly string[];
  readonly oppdragsgivereEkskluder: readonly string[];
  readonly kunngjoringstyper: readonly string[];
  readonly prosedyretyper: readonly string[];
  readonly verdiMinNok: number | null;
  readonly verdiMaksNok: number | null;
  readonly minimumDagerTilFrist: number | null;
  readonly varselTimeLokal: number;
  readonly tidssone: string;
  readonly opprettet: string;
}

function toSummary(profile: AlertProfile): AlertProfileSummaryView {
  return {
    id: profile.id,
    navn: profile.name,
    aktiv: profile.active,
    frekvens: profile.frequency,
    frekvensLabel: FREQUENCY_LABEL_NB[profile.frequency],
    antallCpvKoder: profile.cpvInclude.length,
    antallSokeord: profile.keywordsInclude.length,
    omrader: profile.regionsInclude,
    minimumTreffscore: profile.minimumMatchScore,
    inkludererPlanlagteAnskaffelser: profile.includePlannedProcurements,
    sistEndret: profile.updatedAt.toISOString(),
  };
}

function toDetail(profile: AlertProfile): AlertProfileDetailView {
  return {
    ...toSummary(profile),
    beskrivelse: profile.description ?? null,
    cpvInkluder: profile.cpvInclude,
    cpvEkskluder: profile.cpvExclude,
    sokeordInkluder: profile.keywordsInclude,
    sokeordEkskluder: profile.keywordsExclude,
    oppdragsgivereInkluder: profile.buyerInclude,
    oppdragsgivereEkskluder: profile.buyerExclude,
    kunngjoringstyper: profile.noticeTypes,
    prosedyretyper: profile.procedureTypes,
    verdiMinNok: profile.estimatedValueMinNok ?? null,
    verdiMaksNok: profile.estimatedValueMaxNok ?? null,
    minimumDagerTilFrist: profile.deadlineMinimumDays ?? null,
    varselTimeLokal: profile.digestHourLocal,
    tidssone: profile.timezone,
    opprettet: profile.createdAt.toISOString(),
  };
}

const listInputSchema = z.object({});
const getInputSchema = z.object({ profileId: idSchema });

export interface ListAlertProfilesResult {
  readonly antall: number;
  readonly varslingsprofiler: readonly AlertProfileSummaryView[];
  readonly merknad: string;
}

export const LIST_PROFILES_NOTE_NB =
  'Dette er brukerens egne varslingsprofiler. Ikke foreslå eller utfør endringer i en profil med mindre brukeren ' +
  'uttrykkelig ber om det.';

export const listAlertProfilesTool = defineReadTool<
  typeof listInputSchema,
  ListAlertProfilesResult
>({
  name: 'list_alert_profiles',
  title: 'List varslingsprofiler',
  description:
    'Lister brukerens egne varslingsprofiler med navn, status, frekvens, områder og minimum treffscore. ' +
    'Bruk get_alert_profile for alle detaljene i én profil.',
  requiredScopes: ['profiles:read'],
  lumaContent: false,
  inputSchema: listInputSchema,
  auditFacts: (_input, result) => ({ resultCount: result?.varslingsprofiler.length ?? null }),
  handler: async (_input, context): Promise<ListAlertProfilesResult> => {
    const profiles = await context.ports.profiles.listProfiles(context.caller.userId);
    return {
      antall: profiles.length,
      varslingsprofiler: profiles.map(toSummary),
      merknad: LIST_PROFILES_NOTE_NB,
    };
  },
});

export interface GetAlertProfileResult {
  readonly varslingsprofil: AlertProfileDetailView;
  readonly merknad: string;
}

export const getAlertProfileTool = defineReadTool<typeof getInputSchema, GetAlertProfileResult>({
  name: 'get_alert_profile',
  title: 'Hent varslingsprofil',
  description:
    'Henter alle kriteriene i én av brukerens varslingsprofiler: CPV-koder, søkeord, områder, oppdragsgivere, ' +
    'verdiintervall, frist- og frekvensinnstillinger, både inkluderinger og ekskluderinger.',
  requiredScopes: ['profiles:read'],
  lumaContent: false,
  inputSchema: getInputSchema,
  auditFacts: (input) => ({ targetProfileId: input.profileId }),
  handler: async (input, context): Promise<GetAlertProfileResult> => {
    const profile = await context.ports.profiles.getProfile(context.caller.userId, input.profileId);
    if (profile === undefined) throw notFound(PROFILE_NOT_FOUND_NB);
    return { varslingsprofil: toDetail(profile), merknad: LIST_PROFILES_NOTE_NB };
  },
});
