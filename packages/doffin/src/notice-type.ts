import type { NoticeCategory, TenderStatus } from '@luma/domain';

/**
 * Notice-type and status derivation.
 *
 * Both mappings are keyed on the single-valued `type` field. The `allTypes`
 * roll-up array looks more convenient and is a trap: `ANNOUNCEMENT_OF_INTENT`
 * (intensjonskunngjøring) rolls up to `RESULT`, the same tag as a real award,
 * so deriving the category from `allTypes` would misclassify every intention
 * notice as an award and hide it from users who asked for planned
 * procurements. Verified 20/20 in a live sample.
 */

/** Every `type` value observed against the live API on 2026-08-03. */
export const KNOWN_NOTICE_TYPES = [
  'ADVISORY_NOTICE',
  'PRE_ANNOUNCEMENT',
  'NOTICE_ON_BUYER_PROFILE',
  'ANNOUNCEMENT_OF_INTENT',
  'ANNOUNCEMENT_OF_COMPETITION',
  'DYNAMIC_PURCHASING_SCHEME',
  'ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT',
  'CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT',
] as const;

export type KnownNoticeType = (typeof KNOWN_NOTICE_TYPES)[number];

const CATEGORY_BY_TYPE: Readonly<Record<KnownNoticeType, NoticeCategory>> = {
  // Planned: the competition has not opened yet. An intention notice belongs
  // here from the user's point of view even though Doffin files it as a result,
  // because it is an early signal about work that is about to be placed.
  ADVISORY_NOTICE: 'planned',
  PRE_ANNOUNCEMENT: 'planned',
  NOTICE_ON_BUYER_PROFILE: 'planned',
  ANNOUNCEMENT_OF_INTENT: 'planned',

  ANNOUNCEMENT_OF_COMPETITION: 'competition',
  DYNAMIC_PURCHASING_SCHEME: 'competition',

  ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT: 'award',
  CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT: 'award',
};

export interface DerivationWarning {
  field: 'noticeType' | 'status';
  value: string;
  message: string;
}

export interface Derived<T> {
  value: T;
  warning?: DerivationWarning;
}

/**
 * Maps a Doffin notice type to a product category.
 *
 * The enum is server-side Java and can gain values without notice, so an
 * unrecognised type returns `other` together with a warning rather than being
 * silently bucketed. A quiet default here would mean a new notice type simply
 * stops reaching users, with nothing in the logs to say so.
 */
export function deriveNoticeCategory(type: string): Derived<NoticeCategory> {
  const known = CATEGORY_BY_TYPE[type as KnownNoticeType];
  if (known) return { value: known };

  return {
    value: 'other',
    warning: {
      field: 'noticeType',
      value: type,
      message: `Unknown Doffin notice type "${type}"; categorised as "other". Add it to CATEGORY_BY_TYPE.`,
    },
  };
}

export function isPlannedType(type: string): boolean {
  return deriveNoticeCategory(type).value === 'planned';
}

/**
 * Derives the tender status.
 *
 * The API's `status` field is null for 40% of notices, and specifically for
 * 100% of award, intention, advisory and cancelled-contract notices: it is
 * populated only for live competitions. So the notice type has to answer for
 * the rest, and the order below matters — type wins over a null status.
 */
export function deriveStatus(input: {
  type: string;
  status: string | null | undefined;
}): Derived<TenderStatus> {
  if (input.type === 'ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT') return { value: 'awarded' };
  if (input.type === 'CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT') return { value: 'cancelled' };

  switch (input.status) {
    case 'ACTIVE':
      return { value: 'open' };
    case 'EXPIRED':
      return { value: 'closed' };
    case 'CANCELLED':
      return { value: 'cancelled' };
    case null:
    case undefined:
      // Planned notices have no competition state, so unknown is correct here
      // rather than a gap worth warning about.
      return { value: 'unknown' };
    default:
      return {
        value: 'unknown',
        warning: {
          field: 'status',
          value: input.status,
          message: `Unknown Doffin status "${input.status}"; treated as "unknown".`,
        },
      };
  }
}
