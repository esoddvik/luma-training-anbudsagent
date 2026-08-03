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

/**
 * Approximate perceptual difference between two colours, 0 (identical) upward.
 *
 * This exists because {@link contrastRatio} answers a different question.
 * Contrast ratio compares luminance and therefore measures legibility: whether
 * text of one colour can be read on a background of the other. It says nothing
 * useful about whether two *surfaces* look different, because two tints of the
 * same lightness and different hue — a peach and a cream — score close to 1.0
 * while being obviously distinguishable.
 *
 * Spec 23.4 needs the second question: a Luma promotion block must not read as
 * one more tender card. So the promotion tokens are checked with this rather
 * than with a ratio.
 *
 * The formula is the widely used "redmean" approximation. It is not CIEDE2000,
 * and it is chosen deliberately: it needs no colour-space conversion, is stable
 * and dependency-free, and is comfortably accurate enough to answer "are these
 * two flat background tints distinguishable at a glance", which is all it is
 * asked to do. For reference, this palette's subtlest deliberate step — white
 * against `surface-raised` — is about 24.
 */
export function perceptualDistance(a: string, b: string): number {
  const parse = (hex: string): [number, number, number] => {
    const value = Number.parseInt(hex.replace('#', ''), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const redMean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(
    (2 + redMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - redMean) / 256) * db * db,
  );
}
