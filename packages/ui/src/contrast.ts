/**
 * WCAG 2.2 contrast maths.
 *
 * Used by the token test suite to prove that every colour pair the design
 * system ships meets AA. Spec section 16 lists "god kontrast" as a hard
 * requirement for the web interface, so this is verified, not assumed.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Minimum ratio for body text (WCAG 2.2, 1.4.3 Contrast (Minimum)). */
export const WCAG_AA_TEXT = 4.5;

/** Minimum ratio for large text: >=24px, or >=18.66px bold. */
export const WCAG_AA_LARGE_TEXT = 3;

/** Minimum ratio for borders and other non-text UI (WCAG 2.2, 1.4.11). */
export const WCAG_AA_NON_TEXT = 3;

export type ContrastKind = 'text' | 'large-text' | 'non-text';

export function requiredRatio(kind: ContrastKind): number {
  switch (kind) {
    case 'text':
      return WCAG_AA_TEXT;
    case 'large-text':
      return WCAG_AA_LARGE_TEXT;
    case 'non-text':
      return WCAG_AA_NON_TEXT;
    default: {
      // Loud default: a new ContrastKind must never silently pass at 0.
      const unknown: string = kind;
      throw new Error(`Unknown contrast kind: ${unknown}`);
    }
  }
}

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parses `#rgb` or `#rrggbb` into 0-255 channels. Throws on anything else. */
export function parseHexColor(hex: string): Rgb {
  const value = hex.trim();
  if (!HEX_PATTERN.test(value)) {
    throw new Error(`Not a supported hex colour: ${hex}`);
  }

  const digits = value.slice(1);
  const expanded =
    digits.length === 3
      ? digits
          .split('')
          .map((d) => `${d}${d}`)
          .join('')
      : digits;

  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);

  return { r, g, b };
}

function channelLuminance(channel8Bit: number): number {
  const c = channel8Bit / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Relative luminance per WCAG 2.2 definition, in the range 0..1. */
export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

/** Contrast ratio between two hex colours, in the range 1..21. */
export function contrastRatio(foreground: string, background: string): number {
  const lf = relativeLuminance(parseHexColor(foreground));
  const lb = relativeLuminance(parseHexColor(background));
  const lighter = Math.max(lf, lb);
  const darker = Math.min(lf, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsContrast(foreground: string, background: string, kind: ContrastKind): boolean {
  return contrastRatio(foreground, background) >= requiredRatio(kind);
}

/** Rounds to two decimals so assertion messages stay readable. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}
