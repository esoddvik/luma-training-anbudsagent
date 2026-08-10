import {
  containsPhrase,
  countyCodesIn,
  COUNTY_NAMES,
  cpvLabel,
  type Landsdel,
  type MatchReasonType,
} from '@luma/domain';
import { REASON_TYPE_LABEL_NB } from './match-explanation';
import type { PublicTenderSummary } from './public-search';
import type { ServiceTemplateChoice } from './profiles';

/**
 * Why a notice appears on an anonymous trade page (IDE Agent Spec v3, 3.2).
 *
 * ## What this is not
 *
 * It is not the matcher. There is no profile for an anonymous visitor, no
 * score, and nothing stored — the reasons are derived on the spot from the
 * template the visitor clicked and the notice in front of them.
 *
 * ## The rule that shapes the whole file
 *
 * **No number ever leaves here.** Spec section 4.3 restricts strength to words,
 * and this surface has an extra reason to hold that line: a percentage computed
 * against a template rather than a profile would look like a measurement of
 * *this visitor's* fit when it measures nothing of the kind. So `strength` is
 * one of three words chosen by rules you can read, and `evidence` is a sentence
 * stating an observable fact about the notice — «Kunngjøringen er merket
 * 90910000 Renholdstjenester.» — never a score, a percentage or an estimate.
 *
 * The type labels come from `REASON_TYPE_LABEL_NB` rather than being written
 * here, so the public page and the signed-in match explanation cannot drift
 * into calling the same thing two different words.
 */

export type ReasonStrength = 'sterk' | 'middels' | 'svak';

export interface PublicReason {
  readonly type: MatchReasonType;
  /** «CPV: Renholdstjenester», «Søkeord: «renhold»», «Område: Vestlandet». */
  readonly label: string;
  readonly strength: ReasonStrength;
  /** One plain sentence naming the observable fact behind the reason. */
  readonly evidence: string;
}

/** The word shown next to a `StrengthBar`. Three widths, no percentage. */
export const STRENGTH_LABEL_NB: Readonly<Record<ReasonStrength, string>> = {
  sterk: 'Sterk',
  middels: 'Middels',
  svak: 'Svak',
};

/**
 * `REASON_TYPE_LABEL_NB` names the *kind* of criterion for the shared view
 * («CPV-koder»). A reason row here names one specific hit, so it needs the
 * singular form in front of a colon. Derived from the shared map rather than
 * written out, so a rename there still reaches this surface.
 */
const REASON_PREFIX_NB: Readonly<Partial<Record<MatchReasonType, string>>> = {
  cpv: 'CPV',
  keyword: REASON_TYPE_LABEL_NB.keyword,
  geography: 'Område',
};

function prefix(type: MatchReasonType): string {
  return REASON_PREFIX_NB[type] ?? REASON_TYPE_LABEL_NB[type];
}

export function buildPublicReasons(input: {
  template: ServiceTemplateChoice;
  tender: PublicTenderSummary;
  landsdel?: Landsdel;
}): readonly PublicReason[] {
  const { template, tender, landsdel } = input;
  const reasons: PublicReason[] = [];

  // ── CPV ──────────────────────────────────────────────────────────────────
  // Exact membership, matching what `searchPublicTenders` filtered on. A code
  // the template asked for and the notice carries is the strongest signal this
  // surface has: it is the buyer's own classification, not our reading of it.
  const wanted = new Set(template.cpvInclude);
  for (const code of tender.cpvCodes) {
    if (!wanted.has(code)) continue;
    const name = cpvLabel(code);
    reasons.push({
      type: 'cpv',
      label: `${prefix('cpv')}: ${name}`,
      strength: 'sterk',
      evidence:
        name === code
          ? `Kunngjøringen er merket med CPV-koden ${code}.`
          : `Kunngjøringen er merket ${code} ${name}.`,
    });
  }

  // ── Keywords ─────────────────────────────────────────────────────────────
  // In the title the word is what the buyer chose to call the contract; found
  // anywhere else it is a mention, which is weaker and says so. `matchedKeywords`
  // is title-scanned today (see `PublicTenderSummary`), so the title is
  // re-checked here rather than assumed — the rule then stays right if a caller
  // ever supplies keywords matched against a wider text.
  for (const keyword of tender.matchedKeywords) {
    const inTitle = containsPhrase(tender.title, keyword);
    reasons.push({
      type: 'keyword',
      label: `${prefix('keyword')}: «${keyword}»`,
      strength: inTitle ? 'sterk' : 'middels',
      evidence: inTitle
        ? `Ordet «${keyword}» står i tittelen på kunngjøringen.`
        : `Ordet «${keyword}» er nevnt i kunngjøringen, men ikke i tittelen.`,
    });
  }

  // ── Geography ────────────────────────────────────────────────────────────
  // A nationwide notice is not weaker evidence of *anything* — it is simply not
  // tied to the landsdel the reader is looking at, and the sentence says that
  // rather than implying a poorer fit.
  if (tender.nationwide) {
    reasons.push({
      type: 'geography',
      label: `${prefix('geography')}: hele landet`,
      strength: 'middels',
      evidence: 'Kunngjøringen gjelder hele landet og er ikke knyttet til én landsdel.',
    });
  } else if (landsdel) {
    const inside = new Set(countyCodesIn(landsdel));
    const hits = tender.regionCodes.filter((code) => inside.has(code));
    if (hits.length > 0) {
      const counties = hits
        .map((code) => COUNTY_NAMES[code])
        .filter((name): name is string => Boolean(name));
      reasons.push({
        type: 'geography',
        label: `${prefix('geography')}: ${landsdel.name}`,
        strength: 'sterk',
        evidence:
          counties.length > 0
            ? `Kunngjøringen er registrert i ${counties.join(', ')}, som ligger i ${landsdel.name}.`
            : `Kunngjøringen er registrert i ${landsdel.name}.`,
      });
    }
  }

  return reasons;
}
