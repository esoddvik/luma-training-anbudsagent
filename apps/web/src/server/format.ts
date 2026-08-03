/**
 * Norwegian presentation helpers.
 *
 * Every function here has the same job: turn a value that may be missing into
 * Norwegian text without inventing anything. `docs/spec-deviations.md` records
 * that `estimatedValue` is absent in about half of all notices, that it is not
 * always denominated in kroner, that `municipalities` is always empty, and
 * that a notice can be nationwide rather than regional. A blank cell or a
 * plausible-looking guess would each be worse than saying so.
 *
 * Pure functions, no database and no clock read, so the rules are testable.
 */

/** The single phrase used wherever the source did not supply a value. */
export const NOT_PROVIDED_NB = 'Ikke oppgitt';

const dateFormatter = new Intl.DateTimeFormat('nb-NO', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Oslo',
});

const dateTimeFormatter = new Intl.DateTimeFormat('nb-NO', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Oslo',
});

/** A date, or `Ikke oppgitt`. Never an empty string. */
export function formatDate(value: Date | null | undefined): string {
  if (!value || Number.isNaN(value.getTime())) return NOT_PROVIDED_NB;
  return dateFormatter.format(value);
}

export function formatDateTime(value: Date | null | undefined): string {
  if (!value || Number.isNaN(value.getTime())) return NOT_PROVIDED_NB;
  return dateTimeFormatter.format(value);
}

/** ISO-8601 for a `<time dateTime>` attribute, or undefined when absent. */
export function isoDate(value: Date | null | undefined): string | undefined {
  if (!value || Number.isNaN(value.getTime())) return undefined;
  return value.toISOString();
}

/**
 * How a deadline should be described.
 *
 * A planned procurement has no bid deadline (`expectsDeadline` in the domain
 * is false for it), so the absence is a fact about the notice rather than
 * missing data, and the two cases must not read the same.
 */
export type DeadlineDisplay =
  | {
      readonly kind: 'date';
      readonly text: string;
      readonly iso: string;
      readonly daysLeft: number;
    }
  | { readonly kind: 'planned'; readonly text: string }
  | { readonly kind: 'missing'; readonly text: string };

export const PLANNED_NO_DEADLINE_NB = 'Ingen tilbudsfrist ennå. Konkurransen er ikke publisert.';

export const MISSING_DEADLINE_NB = 'Frist er ikke oppgitt i kunngjøringen.';

export function describeDeadline(input: {
  deadlineAt: Date | null | undefined;
  isPlanned: boolean;
  now: Date;
}): DeadlineDisplay {
  const { deadlineAt, isPlanned, now } = input;

  if (deadlineAt && !Number.isNaN(deadlineAt.getTime())) {
    return {
      kind: 'date',
      text: formatDateTime(deadlineAt),
      iso: deadlineAt.toISOString(),
      daysLeft: daysBetween(now, deadlineAt),
    };
  }

  if (isPlanned) return { kind: 'planned', text: PLANNED_NO_DEADLINE_NB };
  return { kind: 'missing', text: MISSING_DEADLINE_NB };
}

/** Whole days from `from` to `to`, rounded towards zero. Negative when past. */
export function daysBetween(from: Date, to: Date): number {
  return Math.trunc((to.getTime() - from.getTime()) / 86_400_000);
}

/** Short Norwegian description of how long is left, for a badge. */
export function deadlineUrgency(daysLeft: number): string {
  if (daysLeft < 0) return 'Fristen har gått ut';
  if (daysLeft === 0) return 'Frist i dag';
  if (daysLeft === 1) return '1 dag igjen';
  return `${daysLeft} dager igjen`;
}

/**
 * The estimated value, with its currency stated.
 *
 * The column is named `..._nok` because spec section 13 names it that, but the
 * source is not always kroner (`PLN` occurs) and supplies no conversion rate.
 * Rendering a foreign amount as if it were kroner would be a fabrication, so
 * the currency is always shown and never assumed.
 */
export function formatEstimatedValue(input: {
  min: number | null | undefined;
  max: number | null | undefined;
  currency: string | null | undefined;
}): string {
  const { min, max, currency } = input;
  const hasMin = typeof min === 'number' && Number.isFinite(min);
  const hasMax = typeof max === 'number' && Number.isFinite(max);
  if (!hasMin && !hasMax) return NOT_PROVIDED_NB;

  const unit = currency && currency.length > 0 ? currency.toUpperCase() : 'NOK';
  const low = hasMin ? min : max;
  const high = hasMax ? max : min;

  // Doffin publishes a single scalar, so the adapter writes the same number to
  // both bounds. Showing "1 000 000–1 000 000" would imply a range the source
  // never expressed.
  if (low === high) return `${formatAmount(low as number)} ${unit}`;
  return `${formatAmount(low as number)}–${formatAmount(high as number)} ${unit}`;
}

const amountFormatter = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 });

export function formatAmount(value: number): string {
  return amountFormatter.format(value);
}

/**
 * Geography, in the vocabulary the data actually supports.
 *
 * `anyw` means nationwide and is the most common value in the corpus; `NOZZZ`
 * means unspecified. Neither is a NUTS code, so neither may be printed raw.
 * Municipalities are never populated (see the deviations document), which is
 * why there is no municipality branch here to go stale.
 */
export const NATIONWIDE_MARKERS: readonly string[] = ['anyw', 'ANYW'];
export const UNSPECIFIED_REGION_MARKERS: readonly string[] = ['NOZZZ'];

export const NATIONWIDE_NB = 'Hele landet';
export const UNSPECIFIED_REGION_NB = 'Geografi ikke spesifisert';

export function describeRegions(regionCodes: readonly string[]): string {
  if (regionCodes.length === 0) return NOT_PROVIDED_NB;

  const nationwide = regionCodes.some((code) =>
    NATIONWIDE_MARKERS.some((marker) => marker.toLowerCase() === code.toLowerCase()),
  );
  if (nationwide) return NATIONWIDE_NB;

  const named = regionCodes.filter(
    (code) =>
      !UNSPECIFIED_REGION_MARKERS.some((marker) => marker.toLowerCase() === code.toLowerCase()),
  );
  if (named.length === 0) return UNSPECIFIED_REGION_NB;
  return named.join(', ');
}

/** Norwegian labels for the product-level notice categories (spec section 13). */
export const NOTICE_CATEGORY_LABEL_NB = {
  planned: 'Planlagt anskaffelse',
  competition: 'Konkurranse',
  award: 'Tildeling',
  other: 'Annen kunngjøring',
} as const;

export const TENDER_STATUS_LABEL_NB = {
  open: 'Åpen',
  closed: 'Lukket',
  cancelled: 'Avlyst',
  awarded: 'Tildelt',
  unknown: 'Ukjent status',
} as const;

export const USER_STATE_LABEL_NB = {
  new: 'Ny',
  opened: 'Åpnet',
  saved: 'Lagret',
  dismissed: 'Avvist',
} as const;

export const ALERT_FREQUENCY_LABEL_NB = {
  immediate: 'Umiddelbart',
  daily: 'Daglig sammendrag',
  weekly: 'Ukentlig sammendrag',
} as const;

/** A list of codes, or `Ikke oppgitt`. Used for CPV and similar. */
export function formatCodeList(codes: readonly string[]): string {
  return codes.length === 0 ? NOT_PROVIDED_NB : codes.join(', ');
}

/** Truncates a description for a card without cutting a word in half. */
export function excerpt(text: string | null | undefined, maxLength = 220): string | undefined {
  if (!text) return undefined;
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return undefined;
  if (collapsed.length <= maxLength) return collapsed;
  const cut = collapsed.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
