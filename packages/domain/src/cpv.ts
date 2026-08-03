/**
 * CPV (Common Procurement Vocabulary) code handling.
 *
 * A CPV code is eight digits plus an optional check digit, and the digits form
 * a hierarchy: 45000000 (construction work) contains 45200000, which contains
 * 45210000, and so on. Trailing zeros mark where a branch stops being
 * specific. Spec section 11.1 requires profile matching to respect this
 * hierarchy, so that a profile asking for 45000000 also matches 45213316.
 */

const CPV_PATTERN = /^(\d{8})(?:-(\d))?$/;

export interface ParsedCpv {
  /** The eight significant digits, without the check digit. */
  digits: string;
  checkDigit?: string;
}

export function parseCpv(code: string): ParsedCpv | null {
  const match = CPV_PATTERN.exec(code.trim());
  if (!match) return null;
  const digits = match[1];
  if (digits === undefined) return null;
  const checkDigit = match[2];
  return checkDigit === undefined ? { digits } : { digits, checkDigit };
}

export function isValidCpv(code: string): boolean {
  return parseCpv(code) !== null;
}

/** Strips the check digit and whitespace so codes compare consistently. */
export function normalizeCpv(code: string): string | null {
  return parseCpv(code)?.digits ?? null;
}

/**
 * The number of leading digits that are significant, i.e. the position after
 * which the code is all zeros. 45000000 has depth 2, 45210000 has depth 4.
 */
export function cpvDepth(code: string): number {
  const digits = normalizeCpv(code);
  if (!digits) return 0;
  let depth = digits.length;
  while (depth > 1 && digits[depth - 1] === '0') {
    depth -= 1;
  }
  return depth;
}

/**
 * True when `candidate` is the same code as `ancestor` or sits beneath it.
 *
 * The check compares only the ancestor's significant digits, so a broad
 * profile code matches every specific tender code under it, while a specific
 * profile code does not match its own parent.
 */
export function isCpvDescendantOf(candidate: string, ancestor: string): boolean {
  const candidateDigits = normalizeCpv(candidate);
  const ancestorDigits = normalizeCpv(ancestor);
  if (!candidateDigits || !ancestorDigits) return false;

  const significant = cpvDepth(ancestorDigits);
  return candidateDigits.slice(0, significant) === ancestorDigits.slice(0, significant);
}

/**
 * Returns the profile codes that cover a given tender code, most specific
 * first, so match evidence can name the closest reason rather than the
 * broadest one.
 */
export function findCoveringCpvCodes(
  tenderCode: string,
  profileCodes: readonly string[],
): string[] {
  return profileCodes
    .filter((profileCode) => isCpvDescendantOf(tenderCode, profileCode))
    .sort((a, b) => cpvDepth(b) - cpvDepth(a));
}

/**
 * Every profile/tender code pair where the profile code covers the tender
 * code. Used both for scoring and for building human-readable evidence.
 */
export interface CpvOverlap {
  tenderCode: string;
  profileCode: string;
  /** Significant digits shared: higher means a more specific match. */
  specificity: number;
}

export function findCpvOverlaps(
  tenderCodes: readonly string[],
  profileCodes: readonly string[],
): CpvOverlap[] {
  const overlaps: CpvOverlap[] = [];
  for (const tenderCode of tenderCodes) {
    for (const profileCode of profileCodes) {
      if (isCpvDescendantOf(tenderCode, profileCode)) {
        overlaps.push({ tenderCode, profileCode, specificity: cpvDepth(profileCode) });
      }
    }
  }
  return overlaps.sort((a, b) => b.specificity - a.specificity);
}
