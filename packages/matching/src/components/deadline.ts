import { expectsDeadline, type AlertProfile, type MatchReason, type Tender } from '@luma/domain';
import { daysUntil, formatDateNb, roundScore } from '../util.js';
import type { MatchWeights } from '../weights.js';

/**
 * Deadline component (spec section 14, up to 5 points).
 *
 * What is scored is *usable* time, not the existence of a deadline. A tender
 * closing tomorrow is worth less to a supplier than the same tender closing in
 * three weeks, because writing a serious bid takes weeks and a notice that
 * arrives too late is close to noise.
 *
 * Planned procurements are skipped entirely, with no penalty. Spec section 14
 * says so explicitly, and the reason is structural: a planned notice has no
 * deadline to score, so charging it 5 points would make every early warning
 * permanently rank below a competition that is otherwise identical. The domain
 * helper `expectsDeadline` owns that distinction.
 */

/**
 * Days from which the deadline stops being a constraint. Three weeks is the
 * point at which a supplier can run a normal internal bid process: read the
 * documents, decide, gather references, price and review.
 */
export const COMFORTABLE_DAYS = 21;

export function scoreDeadline(
  tender: Tender,
  profile: AlertProfile,
  weights: MatchWeights,
  now: Date,
): MatchReason | null {
  // Planned and award notices carry no deadline; skipped without penalty.
  if (!expectsDeadline(tender.noticeCategory)) return null;

  const deadlineAt = tender.deadlineAt;
  if (deadlineAt === undefined) return null;

  const remaining = daysUntil(deadlineAt, now);
  // A passed deadline is a hard exclusion; scoring it is `exclusions.ts`'s job.
  if (remaining <= 0) return null;

  const share = Math.min(1, remaining / COMFORTABLE_DAYS);
  const contribution = roundScore(weights.deadline * share);

  const wholeDays = Math.floor(remaining);
  const evidence = [`Frist: ${formatDateNb(deadlineAt)}`, `Dager igjen: ${wholeDays}`];

  const minimumDays = profile.deadlineMinimumDays;
  if (minimumDays !== undefined) {
    evidence.push(`Minstekrav i profilen: ${minimumDays} dager`);
  }

  return {
    type: 'deadline',
    label: describeRemaining(wholeDays),
    contribution,
    evidence,
  };
}

function describeRemaining(wholeDays: number): string {
  if (wholeDays === 0) return 'Fristen går ut i dag';
  if (wholeDays === 1) return 'Det er én dag igjen til fristen';
  return `Det er ${wholeDays} dager igjen til fristen`;
}
