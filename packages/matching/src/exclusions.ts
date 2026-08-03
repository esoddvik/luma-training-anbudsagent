import type { AlertProfile, MatchExclusion, Tender } from '@luma/domain';
import {
  anyCpvCovered,
  decideGeography,
  findBuyerMatches,
  findKeywordMatches,
  profileValueRange,
  rangesOverlap,
  tenderValueRange,
} from './criteria.js';
import { daysUntil, formatDateNb, formatNok, sortedUnique } from './util.js';

/**
 * Hard exclusions (spec section 14), evaluated before any scoring.
 *
 * Spec section 11.1 states the governing rule in one line: exclusion rules
 * override inclusion rules. There is no score high enough to survive one. A
 * tender that maxes every component and hits a single exclusion is not
 * included, and the engine test asserts exactly that.
 *
 * The second requirement of section 11.1 is that the user can see *why*
 * something was excluded, so every exclusion carries a Norwegian label and the
 * concrete evidence that triggered it — the actual code, keyword, buyer name
 * or date, not a category name.
 *
 * All applicable exclusions are returned, not just the first. When a user asks
 * why a tender never arrived, "the buyer is on your exclude list, and it also
 * closed last week" is a more useful answer than either half alone.
 */

export const EXCLUSION_TYPES = [
  'cpv_excluded',
  'keyword_excluded',
  'buyer_excluded',
  'geography_outside',
  'value_outside',
  'closed',
  'cancelled',
  'deadline_passed',
  'deadline_too_soon',
  'planned_opted_out',
  'award_notice',
] as const;

export type ExclusionType = (typeof EXCLUSION_TYPES)[number];

export interface ExclusionInput {
  /** Passed in rather than read from the system clock, so this stays pure. */
  readonly now: Date;
}

/**
 * Evaluates every hard exclusion in a fixed order.
 *
 * The order is part of the determinism contract: `exclusions` is stored and
 * compared byte for byte, so it must not depend on which check happened to be
 * written first in a later edit.
 */
export function evaluateExclusions(
  tender: Tender,
  profile: AlertProfile,
  input: ExclusionInput,
): MatchExclusion[] {
  const found: MatchExclusion[] = [];

  const push = (exclusion: MatchExclusion | null): void => {
    if (exclusion !== null) found.push(exclusion);
  };

  push(excludedCpv(tender, profile));
  push(excludedKeyword(tender, profile));
  push(excludedBuyer(tender, profile));
  push(outsideGeography(tender, profile));
  push(outsideValueRange(tender, profile));
  push(notOpen(tender));
  push(deadlinePassed(tender, input.now));
  push(deadlineTooSoon(tender, profile, input.now));
  push(plannedOptedOut(tender, profile));
  push(awardNotice(tender));

  return found;
}

function excludedCpv(tender: Tender, profile: AlertProfile): MatchExclusion | null {
  const covered = anyCpvCovered(tender.cpvCodes, profile.cpvExclude);
  if (covered.length === 0) return null;
  return {
    type: 'cpv_excluded',
    label: 'Anbudet har en CPV-kode du har ekskludert',
    evidence: sortedUnique(covered),
  };
}

function excludedKeyword(tender: Tender, profile: AlertProfile): MatchExclusion | null {
  const matches = findKeywordMatches(tender, profile.keywordsExclude);
  if (matches.length === 0) return null;
  return {
    type: 'keyword_excluded',
    label: 'Anbudet inneholder et søkeord du har ekskludert',
    evidence: matches.map((match) =>
      match.inTitle ? `«${match.keyword}» i tittelen` : `«${match.keyword}» i beskrivelsen`,
    ),
  };
}

function excludedBuyer(tender: Tender, profile: AlertProfile): MatchExclusion | null {
  const matches = findBuyerMatches(tender, profile.buyerExclude);
  if (matches.length === 0) return null;
  return {
    type: 'buyer_excluded',
    label: `Oppdragsgiveren ${tender.buyerName} står på ekskluderingslisten din`,
    evidence: matches.map((entry) => `Ekskludert oppdragsgiver: ${entry}`),
  };
}

/**
 * Geography stated in a profile is treated as mandatory: spec section 14 lists
 * "utenfor obligatorisk geografi" as a hard exclusion, and `AlertProfile` has
 * no separate "mandatory" flag, so the only coherent reading is that naming
 * places means the user will not travel outside them.
 *
 * The filter only fires on a definite `outside` verdict. Three situations look
 * like a non-match but are not one, and `decideGeography` separates them:
 * a nationwide notice covers everyone, a notice that states no place at all
 * cannot be shown to be elsewhere, and a municipality-only profile cannot be
 * compared against a region-only notice. Excluding on any of those would turn
 * a gap in Doffin's data into a silently empty inbox.
 */
function outsideGeography(tender: Tender, profile: AlertProfile): MatchExclusion | null {
  if (decideGeography(tender, profile).verdict !== 'outside') return null;

  const stated = sortedUnique([...tender.regions, ...tender.municipalities]);
  const wanted = sortedUnique([...profile.regionsInclude, ...profile.municipalitiesInclude]);

  return {
    type: 'geography_outside',
    label: 'Anbudet ligger utenfor de geografiske områdene i profilen din',
    evidence: [
      `Anbudet gjelder: ${stated.join(', ')}`,
      `Profilen din dekker: ${wanted.join(', ')}`,
    ],
  };
}

/**
 * Only fires when both sides state a comparable value. `tenderValueRange`
 * returns `null` for a notice with no value (53% of them) and for one priced
 * in another currency, so neither can be filtered out on a comparison that was
 * never actually made.
 */
function outsideValueRange(tender: Tender, profile: AlertProfile): MatchExclusion | null {
  const tenderRange = tenderValueRange(tender);
  const profileRange = profileValueRange(profile);
  if (tenderRange === null || profileRange === null) return null;
  if (rangesOverlap(tenderRange, profileRange)) return null;

  const stated =
    tenderRange.min === tenderRange.max
      ? formatNok(tenderRange.min)
      : `${formatNok(tenderRange.min)}–${formatNok(tenderRange.max)}`;
  const wanted = Number.isFinite(profileRange.max)
    ? `${formatNok(profileRange.min)}–${formatNok(profileRange.max)}`
    : `fra ${formatNok(profileRange.min)}`;

  return {
    type: 'value_outside',
    label: 'Anslått verdi ligger utenfor verdiintervallet i profilen din',
    evidence: [`Anslått verdi i anbudet: ${stated}`, `Verdiintervall i profilen: ${wanted}`],
  };
}

/** Spec section 14: "stengt, kansellert eller utløpt". */
function notOpen(tender: Tender): MatchExclusion | null {
  switch (tender.status) {
    case 'cancelled':
      return {
        type: 'cancelled',
        label: 'Kunngjøringen er kansellert',
        evidence: ['Status hos kilden: kansellert'],
      };
    case 'closed':
      return {
        type: 'closed',
        label: 'Konkurransen er stengt',
        evidence: ['Status hos kilden: stengt'],
      };
    case 'awarded':
      return {
        type: 'closed',
        label: 'Konkurransen er avgjort',
        evidence: ['Status hos kilden: tildelt'],
      };
    case 'open':
    case 'unknown':
      return null;
  }
}

function deadlinePassed(tender: Tender, now: Date): MatchExclusion | null {
  const deadlineAt = tender.deadlineAt;
  if (deadlineAt === undefined) return null;
  if (deadlineAt.getTime() > now.getTime()) return null;

  return {
    type: 'deadline_passed',
    label: 'Fristen er utløpt',
    evidence: [`Frist: ${formatDateNb(deadlineAt)}`],
  };
}

/**
 * `deadlineMinimumDays` is a filter, not a scoring penalty.
 *
 * The domain field says it "filters out competitions whose remaining time is
 * too short to bid on", and a user who set it has stated that such a tender is
 * not actionable for them. Ranking it lower would still put it in the inbox,
 * which is precisely what they asked not to happen.
 */
function deadlineTooSoon(tender: Tender, profile: AlertProfile, now: Date): MatchExclusion | null {
  const minimumDays = profile.deadlineMinimumDays;
  const deadlineAt = tender.deadlineAt;
  if (minimumDays === undefined || deadlineAt === undefined) return null;

  const remaining = daysUntil(deadlineAt, now);
  // A passed deadline is reported by `deadlinePassed`; do not say it twice.
  if (remaining <= 0 || remaining >= minimumDays) return null;

  return {
    type: 'deadline_too_soon',
    label: 'Det er kortere tid igjen til fristen enn minstekravet i profilen din',
    evidence: [
      `Frist: ${formatDateNb(deadlineAt)}`,
      `Dager igjen: ${Math.floor(remaining)}`,
      `Minstekrav i profilen: ${minimumDays} dager`,
    ],
  };
}

function plannedOptedOut(tender: Tender, profile: AlertProfile): MatchExclusion | null {
  if (tender.noticeCategory !== 'planned' || profile.includePlannedProcurements) return null;
  return {
    type: 'planned_opted_out',
    label: 'Profilen din er satt til å utelate planlagte anskaffelser',
    evidence: ['Kunngjøringen er en planlagt anskaffelse'],
  };
}

/**
 * Award notices are ingested and stored in the MVP because they arrive in the
 * same Doffin stream (spec section 13), but they are not a product surface
 * yet.
 *
 * The test is `noticeCategory === 'award'` and nothing else. In particular it
 * is NOT "does this notice name a winner": an intensjonskunngjøring (VEAT)
 * names the intended supplier and Doffin rolls it up under `RESULT` alongside
 * real awards, yet spec section 13 classifies it as `planned` — an early
 * warning the user should see. Inferring award-ness from winner data would
 * suppress exactly the notices this product exists to surface. The domain
 * model's category, derived once at ingest, is the only authority here.
 *
 * PHASE 8: this exclusion is removed. Award notices become the basis for the
 * learning phase and for framework-agreement expiry signals, so this function
 * is the single place that has to change — everything downstream already
 * carries `noticeCategory`.
 */
function awardNotice(tender: Tender): MatchExclusion | null {
  if (tender.noticeCategory !== 'award') return null;
  return {
    type: 'award_notice',
    label: 'Dette er en tildelingskunngjøring. Tildelinger vises ikke i anbudsvarsler ennå.',
    evidence: ['Kunngjøringskategori: tildeling'],
  };
}
