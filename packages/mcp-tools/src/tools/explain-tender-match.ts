import {
  confidenceLabel,
  SCORE_DISCLAIMER_NB,
  type AlertProfile,
  type MatchConfidence,
  type MatchResult,
  type ProfileSuggestion,
  type Tender,
} from '@luma/domain';
import { explainMatch, matchTender, METHOD_NOTE_NB } from '@luma/matching';
import { z } from 'zod';
import { defineReadTool } from '../registry.js';
import { notFound } from '../errors.js';
import {
  toExclusionView,
  toReasonView,
  toTenderView,
  type ExclusionView,
  type ReasonView,
  type TenderView,
} from '../presentation.js';
import { idSchema } from '../schemas.js';
import { resolveProfile, TENDER_NOT_FOUND_NB } from './shared.js';

/**
 * `explain_tender_match` (spec section 32.1): the rule-based components, the
 * explanation, the warning that a score is not a probability of winning, and
 * any suggested profile change.
 *
 * The suggestion is the delicate part. Spec section 15 is explicit: the system
 * stores feedback, may suggest profile changes, must not change a profile on
 * its own, and must show what is proposed and require the user's approval.
 * This tool therefore has `profiles:read` and not `profiles:write`, so it
 * could not apply a suggestion even if a future edit tried: there is no write
 * port on a read tool's context, and no scope for it on the token.
 *
 * Suggestions are derived deterministically from the match itself — an
 * exclusion that fired, a CPV code on the notice that the profile does not
 * cover — never from a model's opinion. Each one carries a Norwegian rationale
 * so the user can judge it.
 */

const inputSchema = z.object({
  tenderId: idSchema,
  profileId: idSchema.optional(),
});

export const SUGGESTION_NOTE_NB =
  'Forslagene under er ikke utført. Ingen varslingsprofil er endret. En profil endres bare når brukeren selv ' +
  'godkjenner endringen i varslingsprofilen sin.';

export interface ProfileChangeSuggestionView {
  readonly felt: ProfileSuggestion['field'];
  readonly operasjon: ProfileSuggestion['operation'];
  readonly verdi: string;
  readonly begrunnelse: string;
}

export interface ExplainTenderMatchResult {
  readonly anbud: TenderView;
  readonly varslingsprofil: { readonly id: string; readonly navn: string };
  readonly treffscore: number;
  readonly maksScore: number;
  readonly sikkerhet: MatchConfidence;
  readonly sikkerhetLabel: string;
  readonly komponenter: readonly ReasonView[];
  readonly eksklusjoner: readonly ExclusionView[];
  readonly inkludertIVarsler: boolean;
  /** The full Norwegian prose explanation from the matching engine. */
  readonly forklaring: string;
  readonly metode: string;
  readonly forbehold: string;
  readonly regelversjon: string;
  readonly forslagTilProfilendring: readonly ProfileChangeSuggestionView[];
  readonly forslagMerknad: string;
}

const MAX_SCORE = 100;

export const explainTenderMatchTool = defineReadTool<typeof inputSchema, ExplainTenderMatchResult>({
  name: 'explain_tender_match',
  title: 'Forklar hvorfor et anbud traff',
  description:
    'Forklarer hvorfor en kunngjøring traff eller ikke traff en varslingsprofil: de regelbaserte komponentene med ' +
    'poeng og grunnlag, eventuelle eksklusjoner, en forklaring på norsk, og eventuelle forslag til endringer i ' +
    'profilen. Forslagene er kun forslag og blir aldri utført. Treffscoren er ikke en sannsynlighet for å vinne.',
  requiredScopes: ['tenders:read', 'profiles:read'],
  lumaContent: false,
  inputSchema,
  auditFacts: (input, result) => ({
    targetTenderId: input.tenderId,
    targetProfileId: result?.varslingsprofil.id ?? input.profileId ?? null,
  }),
  handler: async (input, context): Promise<ExplainTenderMatchResult> => {
    const tender = await context.ports.tenders.getTender(input.tenderId);
    if (tender === undefined) throw notFound(TENDER_NOT_FOUND_NB);

    const profile = await resolveProfile(context.ports, context.caller.userId, input.profileId);
    const result = matchTender(tender, profile, { now: context.now });
    const explanation = explainMatch(result);

    return {
      anbud: toTenderView(tender),
      varslingsprofil: { id: profile.id, navn: profile.name },
      treffscore: result.score,
      maksScore: MAX_SCORE,
      sikkerhet: result.confidence,
      sikkerhetLabel: confidenceLabel(result.confidence),
      komponenter: result.reasons.map(toReasonView),
      eksklusjoner: result.exclusions.map(toExclusionView),
      inkludertIVarsler: result.included,
      forklaring: explanation.text,
      metode: METHOD_NOTE_NB,
      forbehold: SCORE_DISCLAIMER_NB,
      regelversjon: result.matchingVersion,
      forslagTilProfilendring: buildSuggestions(tender, profile, result),
      forslagMerknad: SUGGESTION_NOTE_NB,
    };
  },
});

/**
 * Deterministic suggestions derived from what the rules actually did.
 *
 * Deliberately conservative: one suggestion per observed cause, no ranking, no
 * speculation about what the user "probably" wants. `deadlineMinimumDays` and
 * `minimumMatchScore` are left alone even when they are the reason a tender
 * fell out, because neither is in the field list spec section 15 allows a
 * suggestion to target.
 */
export function buildSuggestions(
  tender: Tender,
  profile: AlertProfile,
  result: MatchResult,
): ProfileChangeSuggestionView[] {
  const suggestions: ProfileChangeSuggestionView[] = [];

  for (const exclusion of result.exclusions) {
    switch (exclusion.type) {
      case 'geography_outside': {
        const region = tender.regions[0];
        if (region !== undefined && !profile.regionsInclude.includes(region)) {
          suggestions.push({
            felt: 'regionsInclude',
            operasjon: 'add',
            verdi: region,
            begrunnelse: `Anbudet er utenfor områdene i profilen din. Legg til «${region}» hvis du vil se anbud derfra.`,
          });
        }
        break;
      }
      case 'cpv_excluded': {
        const code = exclusion.evidence[0];
        if (code !== undefined) {
          suggestions.push({
            felt: 'cpvExclude',
            operasjon: 'remove',
            verdi: code,
            begrunnelse: `CPV-koden ${code} står på ekskluderingslista di. Fjern den hvis anbud som dette likevel er interessante.`,
          });
        }
        break;
      }
      case 'keyword_excluded': {
        const keyword = exclusion.evidence[0];
        if (keyword !== undefined) {
          suggestions.push({
            felt: 'keywordsExclude',
            operasjon: 'remove',
            verdi: keyword,
            begrunnelse: `Søkeordet «${keyword}» ekskluderer anbudet. Fjern det hvis det stenger ute mer enn du ønsker.`,
          });
        }
        break;
      }
      case 'buyer_excluded': {
        const buyer = exclusion.evidence[0];
        if (buyer !== undefined) {
          suggestions.push({
            felt: 'buyerExclude',
            operasjon: 'remove',
            verdi: buyer,
            begrunnelse: `Oppdragsgiveren «${buyer}» står på ekskluderingslista di.`,
          });
        }
        break;
      }
      case 'value_outside': {
        const suggestion = valueSuggestion(tender, profile);
        if (suggestion !== null) suggestions.push(suggestion);
        break;
      }
      default:
        // closed, cancelled, deadline_passed, deadline_too_soon, planned_opted_out
        // and award_notice are facts about the notice or settings outside the
        // suggestable field list. Nothing to propose.
        break;
    }
  }

  // A code the notice carries that the profile does not cover at all is the
  // most common reason a relevant tender scores lower than the user expects.
  if (!result.reasons.some((reason) => reason.type === 'cpv')) {
    const code = tender.cpvCodes[0];
    if (code !== undefined && !profile.cpvInclude.includes(code)) {
      suggestions.push({
        felt: 'cpvInclude',
        operasjon: 'add',
        verdi: code,
        begrunnelse: `Anbudet har CPV-koden ${code}, som ikke er dekket av profilen din. Legg den til hvis dette er arbeid dere leverer.`,
      });
    }
  }

  return suggestions;
}

function valueSuggestion(
  tender: Tender,
  profile: AlertProfile,
): ProfileChangeSuggestionView | null {
  const tenderMax = tender.estimatedValueMaxNok ?? tender.estimatedValueMinNok;
  const tenderMin = tender.estimatedValueMinNok ?? tender.estimatedValueMaxNok;
  if (tenderMax === undefined || tenderMin === undefined) return null;

  if (profile.estimatedValueMaxNok !== undefined && tenderMin > profile.estimatedValueMaxNok) {
    return {
      felt: 'estimatedValueMaxNok',
      operasjon: 'set',
      verdi: String(tenderMax),
      begrunnelse: `Anslått verdi er høyere enn taket i profilen din. Hev taket hvis dere også vil se større kontrakter.`,
    };
  }
  if (profile.estimatedValueMinNok !== undefined && tenderMax < profile.estimatedValueMinNok) {
    return {
      felt: 'estimatedValueMinNok',
      operasjon: 'set',
      verdi: String(tenderMin),
      begrunnelse: `Anslått verdi er lavere enn gulvet i profilen din. Senk gulvet hvis mindre kontrakter også er aktuelle.`,
    };
  }
  return null;
}
