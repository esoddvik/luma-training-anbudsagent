import {
  containsPhrase,
  countyCodesIn,
  COUNTY_NAMES,
  cpvDepth,
  cpvFamilyLabel,
  cpvFamilyOf,
  cpvLabel,
  isBroadCpv,
  isCpvDescendantOf,
  type Landsdel,
  type MatchReasonType,
} from '@luma/domain';
import { REASON_TYPE_LABEL_NB } from './match-explanation';
import type { PublicTenderSummary } from './public-search';
import type { ServiceTemplateChoice } from './profiles';

/**
 * Why a notice appears on an anonymous trade page, and how strongly (IDE Agent
 * Spec v3, 3.2; relevance spec R2, R3, R10).
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
 * one of three words, `level` is one of three phrases, and `evidence` is a
 * sentence stating an observable fact about the notice — «Kunngjøringen er
 * merket 90910000 Renholdstjenester.» — never a score, a percentage or an
 * estimate.
 *
 * Weights exist inside this module and are the arithmetic behind those words.
 * They are deliberately not exported and never reach a caller: the moment a
 * number crosses this boundary something downstream will render it.
 *
 * ## Why weights replaced per-signal strength
 *
 * The old rule graded each signal on its own and called almost everything
 * «Sterk». A notice matching three CPV codes *and* a title keyword looked
 * identical to one matching a single vague code, because both had at least one
 * strong reason and the page showed no aggregate at all. Weighing the signals
 * and summing them is what lets those two notices land on different words.
 *
 * The type labels come from `REASON_TYPE_LABEL_NB` rather than being written
 * here, so the public page and the signed-in match explanation cannot drift
 * into calling the same thing two different words.
 */

export type ReasonStrength = 'sterk' | 'middels' | 'svak';

/**
 * The aggregate word for a whole notice. Two values, no third.
 *
 * R2 specifies three bands and this was three until it was measured. «Lav» was
 * unreachable in practice: `searchPublicTenders` only selects notices carrying
 * one of the template's CPV codes, so a notice on the page has either a precise
 * code — weight 3, already Middels — or a broad code, and R1 removes a broad
 * code that stands alone. The only survivor was the narrow case of a broad code
 * plus a keyword buried in the description, which returned nothing on any of
 * renhold, bygg-og-anlegg or it-tjenester (13, 50 and 64 notices).
 *
 * A band that never renders is worse than no band: it invites a filter facet
 * that returns an empty list, and it lets a reader infer that the levels are
 * finer-grained than the two the data can actually distinguish.
 *
 * Sums of 1–2 now read «Middels relevans» rather than being a band of their
 * own. That is a real widening at the bottom and it is the honest cost of the
 * simplification — a notice with a single weak signal claims the same word as
 * one with five. It stays acceptable only because R1 removes almost every way
 * to be down there. **If that ever stops being true, the fix is to raise the
 * bar for appearing at all — require one substantial signal — not to put the
 * third band back.**
 */
export type RelevanceLevel = 'hoy' | 'middels';

export interface PublicReason {
  readonly type: MatchReasonType;
  /** «CPV: Renholdstjenester», «Søkeord: «renhold»», «Område: Vestlandet». */
  readonly label: string;
  readonly strength: ReasonStrength;
  /** One plain sentence naming the observable fact behind the reason. */
  readonly evidence: string;
}

export interface PublicRelevance {
  /** How relevant the notice is overall. Rendered as a phrase, never a number. */
  readonly level: RelevanceLevel;
  readonly reasons: readonly PublicReason[];
}

/** The word shown next to a `StrengthBar`. Three widths, no percentage. */
export const STRENGTH_LABEL_NB: Readonly<Record<ReasonStrength, string>> = {
  sterk: 'Sterk',
  middels: 'Middels',
  svak: 'Svak',
};

/** The phrase shown for the notice as a whole. */
export const RELEVANCE_LEVEL_LABEL_NB: Readonly<Record<RelevanceLevel, string>> = {
  hoy: 'Høy relevans',
  middels: 'Middels relevans',
};

/**
 * The signal weights (R2), and the one signal that is deliberately absent.
 *
 * A precise CPV code and a word in the title are the two things a buyer chose
 * on purpose, so they weigh the same and weigh most. A broad code and a mention
 * buried in the description are both true and both nearly free of information,
 * so they weigh least.
 *
 * **«Oppdragsgivertype i profilen» is not here.** R2 lists it at weight 1, and
 * there is no data for it: `tenders` carries `buyerName` and an organisation
 * number, nothing more, and `packages/db/src/schema/profiles.ts` states that a
 * buyer-side column must never exist. The only way to produce the signal would
 * be to infer a sector from the buyer's *name* — «kommune», «sykehus», «HF» —
 * which is precisely the buyer-side assumption ADR-17 and
 * `no-buyer-side-assumptions.test.ts` forbid, and which would be invisibly
 * wrong for every buyer whose name does not announce what it is. So the signal
 * is omitted rather than approximated.
 */
const WEIGHT_PRECISE_CPV = 3;
const WEIGHT_KEYWORD_IN_TITLE = 3;
const WEIGHT_KEYWORD_IN_DESCRIPTION = 1;
const WEIGHT_BROAD_CPV = 1;
const WEIGHT_GEOGRAPHY_IN_LANDSDEL = 1;
/**
 * Nationwide is not in R2's table, and it needs a number because R10 fixes the
 * word: the row reads «Middels». Strength is weight-derived now, so the only
 * way for that word to come out of the same rule as every other row — rather
 * than being written in by hand and drifting the first time the mapping changes
 * — is for the signal to weigh what «Middels» weighs.
 */
const WEIGHT_NATIONWIDE = 2;

/**
 * R2's threshold. The only place a sum turns into a word.
 *
 * R2 states two cuts, at 6 and at 3. Only the first survives — see
 * `RelevanceLevel` for why the band below 3 was measured to be unreachable and
 * dropped rather than shipped empty.
 */
const LEVEL_HOY_FROM = 6;

function levelFor(weight: number): RelevanceLevel {
  return weight >= LEVEL_HOY_FROM ? 'hoy' : 'middels';
}

/**
 * Row strength, derived from the row's own weight rather than chosen.
 *
 * Three weights, three words, and no way for a row to claim a strength its
 * contribution to the level does not support.
 */
function strengthFor(weight: number): ReasonStrength {
  if (weight >= 3) return 'sterk';
  if (weight === 2) return 'middels';
  return 'svak';
}

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

/** «90900000, 90910000 og 90911200» — Norwegian has no serial comma. */
function joinNb(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? '';
  return `${values.slice(0, -1).join(', ')} og ${values[values.length - 1]}`;
}

interface Weighted {
  readonly reason: PublicReason;
  readonly weight: number;
}

/**
 * The CPV rows for one notice (R3), one per family rather than one per code.
 *
 * A notice tagged 90900000, 90910000 and 90911200 has said one thing three
 * times at three depths. Listing it three times reads as three independent
 * confirmations and inflates any sum built from it, so those codes collapse
 * into a single row that names the family and cites every code behind it.
 *
 * ## What counts as one family, and why it is not just the first four digits
 *
 * R3 states the rule as «codes sharing the first four digits», and then gives
 * as its example a row merging **90900000, 90910000 and 90911200** — which the
 * stated rule does not produce, because 90900000 is family 9090 and the other
 * two are 9091. The rule and its own example disagree, and the example is the
 * one that describes the case the spec was written about.
 *
 * So a family here is: codes sharing four digits, *plus* any families joined by
 * CPV ancestry within this notice's own matched set. 90910000 sits beneath
 * 90900000 in the vocabulary's hierarchy, so when a notice carries both it has
 * named one branch twice, and the row says so once.
 *
 * The measurement is what settled it. On the first-four-digits rule alone,
 * `renhold-og-facility-management` came out **77% «Høy relevans»** — over R3's
 * own O2 ceiling of 70% — because nearly every cleaning notice carries both
 * 90900000 and 90910000 and so scored 3 + 3 before a single word was read.
 * Under ancestry those notices score 3, which is what one CPV branch is worth,
 * and a notice that *also* has the trade's word in its title is the one that
 * reaches «Høy».
 *
 * Ancestry is transitive here, deliberately. A bygg notice tagged 45000000,
 * 45100000 and 45400000 becomes one row rather than three: site preparation and
 * completion work are different jobs, but the notice has classified itself
 * within one branch at three depths, and «Kunngjøringen er merket 45000000,
 * 45100000 og 45400000» under one heading is a truer summary than three rows
 * that read as three separate confirmations.
 *
 * Two cases stay unmerged on purpose:
 *
 * - **A family of one.** 79993000 is the only 7999 code any template asks for,
 *   and its family name would be 79990000 «Diverse forretningstjenester» —
 *   vaguer than «Bygnings- og eiendomsforvaltning», which is the actual code.
 *   Merging a single code can only ever lose precision, so it does not happen.
 * - **A family with no name.** A row headed «CPV: 5041» would be worse than no
 *   merge, so codes whose branch is outside the vocabulary keep their own rows,
 *   where `cpvLabel` prints the full eight digits — something a reader can look
 *   up.
 *
 * A family weighs what its *best* code weighs: one precise code in the family
 * makes the row precise, because the notice really did carry a precise code.
 */
function cpvRows(matched: readonly string[]): Weighted[] {
  const groups = groupCpvCodes(matched);
  const rows: Weighted[] = [];

  for (const codes of groups) {
    if (codes.length === 1) {
      rows.push(singleCpvRow(codes[0] as string));
      continue;
    }
    // Shallowest first: the broadest code present is the one whose name covers
    // every other member, so it is the only honest heading for the group.
    const ordered = [...codes].sort((a, b) => cpvDepth(a) - cpvDepth(b) || a.localeCompare(b));
    const name = groupLabel(ordered);
    if (!name) {
      for (const code of ordered) rows.push(singleCpvRow(code));
      continue;
    }
    const weight = ordered.some((code) => !isBroadCpv(code))
      ? WEIGHT_PRECISE_CPV
      : WEIGHT_BROAD_CPV;
    rows.push({
      weight,
      reason: {
        type: 'cpv',
        label: `${prefix('cpv')}: ${name}`,
        strength: strengthFor(weight),
        evidence: `Kunngjøringen er merket ${joinNb(ordered)}.`,
      },
    });
  }

  return rows;
}

/**
 * The heading for a merged group: the broadest code's own name, or its family's.
 *
 * `undefined` when neither is known, which is the caller's signal to leave the
 * codes as separate rows rather than print digits as a heading.
 */
function groupLabel(ordered: readonly string[]): string | undefined {
  const broadest = ordered[0] as string;
  const name = cpvLabel(broadest);
  if (name !== broadest) return name;
  const family = cpvFamilyOf(broadest);
  return family ? cpvFamilyLabel(family) : undefined;
}

/**
 * Matched codes partitioned into families. Four-digit prefix, then ancestry.
 *
 * A small union-find, written out rather than pulled in: the sets are at most a
 * handful of codes per notice, and the merge condition — «either code covers
 * the other» — is the whole rule, which is easier to read here than to infer
 * from a library call.
 */
function groupCpvCodes(matched: readonly string[]): string[][] {
  const codes = [...new Set(matched)];
  const parent = new Map<string, string>(codes.map((code) => [code, code]));

  function find(code: string): string {
    let root = code;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    return root;
  }
  function union(a: string, b: string): void {
    const [rootA, rootB] = [find(a), find(b)];
    if (rootA !== rootB) parent.set(rootA, rootB);
  }

  for (let i = 0; i < codes.length; i += 1) {
    for (let j = i + 1; j < codes.length; j += 1) {
      const a = codes[i] as string;
      const b = codes[j] as string;
      const related =
        cpvFamilyOf(a) === cpvFamilyOf(b) || isCpvDescendantOf(a, b) || isCpvDescendantOf(b, a);
      if (related) union(a, b);
    }
  }

  const byRoot = new Map<string, string[]>();
  for (const code of codes) {
    const root = find(code);
    byRoot.set(root, [...(byRoot.get(root) ?? []), code]);
  }
  return [...byRoot.values()];
}

function singleCpvRow(code: string): Weighted {
  const name = cpvLabel(code);
  const weight = isBroadCpv(code) ? WEIGHT_BROAD_CPV : WEIGHT_PRECISE_CPV;
  return {
    weight,
    reason: {
      type: 'cpv',
      label: `${prefix('cpv')}: ${name}`,
      strength: strengthFor(weight),
      evidence:
        name === code
          ? `Kunngjøringen er merket med CPV-koden ${code}.`
          : `Kunngjøringen er merket ${code} ${name}.`,
    },
  };
}

export function buildPublicReasons(input: {
  template: ServiceTemplateChoice;
  tender: PublicTenderSummary;
  landsdel?: Landsdel;
}): PublicRelevance {
  const { template, tender, landsdel } = input;
  const rows: Weighted[] = [];

  // ── CPV ──────────────────────────────────────────────────────────────────
  // Exact membership, matching what `searchPublicTenders` filtered on. A code
  // the template asked for and the notice carries is the buyer's own
  // classification rather than our reading of it — but only when the code is
  // precise. `searchPublicTenders` has already dropped any notice whose *only*
  // matching code is broad (R1), so a broad row reaching here is always
  // alongside something else.
  const wanted = new Set(template.cpvInclude);
  rows.push(...cpvRows(tender.cpvCodes.filter((code) => wanted.has(code))));

  // ── Keywords ─────────────────────────────────────────────────────────────
  // In the title the word is what the buyer chose to call the contract; found
  // in the description it is a mention, which weighs a third as much and says
  // so. `matchedKeywords` is title-scanned by `searchPublicTenders`, but the
  // title is re-checked here rather than assumed, so the rule stays right if a
  // caller ever supplies keywords matched against a wider text.
  for (const keyword of tender.matchedKeywords) {
    rows.push(keywordRow(keyword, containsPhrase(tender.title, keyword)));
  }
  for (const keyword of tender.descriptionKeywords) {
    // A word in both places is a title hit, counted once. `searchPublicTenders`
    // already subtracts the title words, and this repeats the subtraction so a
    // caller that does not cannot double-count.
    if (tender.matchedKeywords.includes(keyword)) continue;
    rows.push(keywordRow(keyword, containsPhrase(tender.title, keyword)));
  }

  // ── Geography ────────────────────────────────────────────────────────────
  // A nationwide notice is not weaker evidence of *anything* — it is simply not
  // tied to the landsdel the reader is looking at, and the sentence says that
  // rather than implying a poorer fit (R10).
  if (tender.nationwide) {
    rows.push({
      weight: WEIGHT_NATIONWIDE,
      reason: {
        type: 'geography',
        label: `${prefix('geography')}: gjelder hele landet`,
        strength: strengthFor(WEIGHT_NATIONWIDE),
        evidence:
          'Konkurransen er ikke knyttet til én landsdel, så den er like aktuell der du holder til.',
      },
    });
  } else if (landsdel) {
    const inside = new Set(countyCodesIn(landsdel));
    const hits = tender.regionCodes.filter((code) => inside.has(code));
    if (hits.length > 0) {
      const counties = hits
        .map((code) => COUNTY_NAMES[code])
        .filter((name): name is string => Boolean(name));
      rows.push({
        weight: WEIGHT_GEOGRAPHY_IN_LANDSDEL,
        reason: {
          type: 'geography',
          label: `${prefix('geography')}: ${landsdel.name}`,
          strength: strengthFor(WEIGHT_GEOGRAPHY_IN_LANDSDEL),
          evidence:
            counties.length > 0
              ? `Kunngjøringen er registrert i ${counties.join(', ')}, som ligger i ${landsdel.name}.`
              : `Kunngjøringen er registrert i ${landsdel.name}.`,
        },
      });
    }
  }

  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  return { level: levelFor(total), reasons: rows.map((row) => row.reason) };
}

function keywordRow(keyword: string, inTitle: boolean): Weighted {
  const weight = inTitle ? WEIGHT_KEYWORD_IN_TITLE : WEIGHT_KEYWORD_IN_DESCRIPTION;
  return {
    weight,
    reason: {
      type: 'keyword',
      label: `${prefix('keyword')}: «${keyword}»`,
      strength: strengthFor(weight),
      evidence: inTitle
        ? `Ordet «${keyword}» står i tittelen på kunngjøringen.`
        : `Ordet «${keyword}» er nevnt i kunngjøringen, men ikke i tittelen.`,
    },
  };
}
