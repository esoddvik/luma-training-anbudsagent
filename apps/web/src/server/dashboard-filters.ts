import { noticeCategorySchema } from '@luma/domain';
import type { DashboardFilters, UserTenderState } from './tenders';

/**
 * Parsing the dashboard's query string (spec section 16: filter on profile,
 * deadline, buyer, CPV, status and category).
 *
 * A pure function, separate from the page, for two reasons. It is the boundary
 * where user-controlled text becomes a database predicate, so it is worth
 * testing on its own; and every unrecognised value has to become `undefined`
 * rather than being passed through, so a hand-edited URL cannot widen a query.
 */

export const DEADLINE_FILTER_OPTIONS = [
  { days: 7, label: 'Innen 7 dager' },
  { days: 14, label: 'Innen 14 dager' },
  { days: 30, label: 'Innen 30 dager' },
  { days: 90, label: 'Innen 90 dager' },
] as const;

const ALLOWED_DEADLINE_DAYS = new Set(DEADLINE_FILTER_OPTIONS.map((option) => option.days));

const ALLOWED_STATES: ReadonlySet<UserTenderState> = new Set<UserTenderState>([
  'new',
  'opened',
  'saved',
  'dismissed',
]);

export type SearchParams = Record<string, string | string[] | undefined>;

function single(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  if (Array.isArray(value)) return value.find((entry) => entry.length > 0);
  return undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseDashboardFilters(params: SearchParams): DashboardFilters {
  const profileRaw = single(params, 'profil');
  const deadlineRaw = single(params, 'frist');
  const stateRaw = single(params, 'status');
  const categoryRaw = single(params, 'kategori');

  const deadlineWithinDays =
    deadlineRaw === undefined ? undefined : Number.parseInt(deadlineRaw, 10);

  const category = categoryRaw ? noticeCategorySchema.safeParse(categoryRaw) : undefined;

  return {
    profileId: profileRaw !== undefined && UUID_PATTERN.test(profileRaw) ? profileRaw : undefined,
    deadlineWithinDays:
      deadlineWithinDays !== undefined && ALLOWED_DEADLINE_DAYS.has(deadlineWithinDays as 7)
        ? deadlineWithinDays
        : undefined,
    buyer: single(params, 'oppdragsgiver'),
    // The CPV filter is turned into a prefix by `significantCpvDigits`, which
    // rejects anything that is not digits, so no escaping is needed here.
    cpv: single(params, 'cpv'),
    state:
      stateRaw !== undefined && ALLOWED_STATES.has(stateRaw as UserTenderState)
        ? (stateRaw as UserTenderState)
        : undefined,
    category: category?.success ? category.data : undefined,
  };
}

/** True when at least one filter is in force, for the empty-state wording. */
export function hasActiveFilters(filters: DashboardFilters): boolean {
  return Object.values(filters).some((value) => value !== undefined);
}
