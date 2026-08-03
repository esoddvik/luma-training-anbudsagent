/**
 * Norwegian formatting of dates, times and money.
 *
 * Deliberately not `Intl.DateTimeFormat('nb-NO', …)` for the output itself.
 * Locale data changes between ICU versions, and a snapshot suite whose whole
 * point is to make copy changes visible in review must not churn because a
 * Node upgrade moved a space. `Intl` is used only for the time-zone
 * arithmetic, whose numeric output is stable, and the Norwegian words come
 * from the table below.
 */

/** All customer-facing times are Oslo local time. */
export const DISPLAY_TIME_ZONE = 'Europe/Oslo';

const MONTHS_NB = [
  'januar',
  'februar',
  'mars',
  'april',
  'mai',
  'juni',
  'juli',
  'august',
  'september',
  'oktober',
  'november',
  'desember',
] as const;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function zonedParts(date: Date): ZonedParts {
  const parts = partsFormatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    return value === undefined ? 0 : Number.parseInt(value, 10);
  };
  // `hour12: false` yields 24 rather than 0 for midnight in some ICU builds.
  const hour = read('hour') % 24;
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
  };
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** "15. mars 2026" */
export function formatDate(date: Date): string {
  const { year, month, day } = zonedParts(date);
  return `${day}. ${MONTHS_NB[month - 1] ?? ''} ${year}`;
}

/** "15. mars 2026 kl. 12:00" */
export function formatDateTime(date: Date): string {
  const { hour, minute } = zonedParts(date);
  return `${formatDate(date)} kl. ${pad2(hour)}:${pad2(minute)}`;
}

/** "1.–7. mars 2026" or "28. februar–6. mars 2026", for the digest period. */
export function formatDateRange(start: Date, end: Date): string {
  const from = zonedParts(start);
  const to = zonedParts(end);
  if (from.year === to.year && from.month === to.month) {
    return `${from.day}.–${to.day}. ${MONTHS_NB[to.month - 1] ?? ''} ${to.year}`;
  }
  if (from.year === to.year) {
    return `${from.day}. ${MONTHS_NB[from.month - 1] ?? ''}–${to.day}. ${
      MONTHS_NB[to.month - 1] ?? ''
    } ${to.year}`;
  }
  return `${formatDate(start)}–${formatDate(end)}`;
}

/** Thousands separated by a plain space: "1 500 000". */
export function formatInteger(value: number): string {
  const rounded = Math.round(value);
  const digits = Math.abs(rounded).toString();
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return `${rounded < 0 ? '-' : ''}${groups.join(' ')}`;
}

/**
 * "1 500 000 NOK", "fra 1 500 000 NOK", "1 500 000–2 000 000 NOK", or
 * undefined when the source gives no value. An absent value is left absent:
 * the alternative would be inventing a number (spec section 4.5).
 */
export function formatValueRange(
  min: number | undefined,
  max: number | undefined,
  currency = 'NOK',
): string | undefined {
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined) {
    if (min === max) return `${formatInteger(min)} ${currency}`;
    return `${formatInteger(min)}–${formatInteger(max)} ${currency}`;
  }
  if (min !== undefined) return `fra ${formatInteger(min)} ${currency}`;
  return `inntil ${formatInteger(max ?? 0)} ${currency}`;
}
