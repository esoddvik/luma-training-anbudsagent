import type { AlertProfile, MatchReason, NoticeCategory, Tender } from '@luma/domain';
import { roundScore } from '../util.js';
import { nameContains } from '../util.js';
import type { MatchWeights } from '../weights.js';

/**
 * Notice type and procedure components (spec section 14, 5 points shared).
 *
 * Spec section 14 gives one budget to "type og prosedyre"; the `MatchResult`
 * type keeps them as separate reasons, so the budget is split in
 * `weights.noticeType` and `weights.procedure`.
 */

/**
 * The exact customer-facing sentence spec section 14 requires on the
 * `notice_type` reason of a planned procurement.
 *
 * It is a verbatim requirement, not a suggestion: a planned notice is not a
 * competition the supplier can bid on yet, and the product promises to say so
 * in these words wherever the match is shown. A test asserts the string.
 */
export const PLANNED_NOTICE_TEXT_NB =
  'Dette er en planlagt anskaffelse. Konkurransen er ikke publisert ennå.';

/** Norwegian display names for the notice categories (spec section 13). */
const CATEGORY_LABEL_NB: Readonly<Record<NoticeCategory, string>> = {
  planned: 'Planlagt anskaffelse',
  competition: 'Aktiv konkurranse',
  award: 'Tildelingskunngjøring',
  other: 'Annen kunngjøring',
};

/**
 * How much of the notice-type budget each category is worth.
 *
 * `planned` scores the same as `competition`. A planned procurement the user
 * asked to see is an early warning, which is the most valuable thing this
 * product can deliver; discounting it would push it below the fold precisely
 * when acting early matters most. `award` is 0 because an award notice never
 * reaches scoring in the MVP: it is excluded outright.
 */
const CATEGORY_SHARE: Readonly<Record<NoticeCategory, number>> = {
  planned: 1,
  competition: 1,
  award: 0,
  other: 0.5,
};

export function scoreNoticeType(
  tender: Tender,
  profile: AlertProfile,
  weights: MatchWeights,
): MatchReason | null {
  const typeShare = matchesRequestedNoticeType(tender, profile) ? 1 : 0;
  const contribution = roundScore(
    weights.noticeType * CATEGORY_SHARE[tender.noticeCategory] * typeShare,
  );

  const planned = tender.noticeCategory === 'planned';

  /**
   * A planned procurement always produces this reason, even when it scores
   * nothing, because the required sentence is how the user is told the
   * competition is not open yet. Every other category with no points produces
   * no reason at all.
   */
  if (!planned && contribution === 0) return null;

  const evidence: string[] = planned ? [PLANNED_NOTICE_TEXT_NB] : [];
  evidence.push(
    `Kunngjøringstype: ${tender.noticeType ?? CATEGORY_LABEL_NB[tender.noticeCategory]}`,
  );

  return {
    type: 'notice_type',
    label: planned ? PLANNED_NOTICE_TEXT_NB : CATEGORY_LABEL_NB[tender.noticeCategory],
    contribution,
    evidence,
  };
}

function matchesRequestedNoticeType(tender: Tender, profile: AlertProfile): boolean {
  if (profile.noticeTypes.length === 0) return true;
  const noticeType = tender.noticeType;
  if (noticeType === undefined) return false;
  return profile.noticeTypes.some((requested) => nameContains(noticeType, requested));
}

export function scoreProcedure(
  tender: Tender,
  profile: AlertProfile,
  weights: MatchWeights,
): MatchReason | null {
  const procedureType = tender.procedureType;
  if (procedureType === undefined || profile.procedureTypes.length === 0) return null;

  const matched = profile.procedureTypes.filter((requested) =>
    nameContains(procedureType, requested),
  );
  if (matched.length === 0) return null;

  return {
    type: 'procedure',
    label: `Konkurranseformen ${procedureType} står i profilen din`,
    contribution: roundScore(weights.procedure),
    evidence: [`Prosedyre: ${procedureType}`],
  };
}
