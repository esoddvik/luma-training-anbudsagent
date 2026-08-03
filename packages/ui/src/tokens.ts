/**
 * JavaScript mirror of `src/tokens.css`.
 *
 * Luma Training's brand palette — see the comment block at the top of
 * `src/tokens.css` for why the signature orange appears twice, once verbatim
 * as `color-brand` and once darkened as `color-primary`. `tokens.test.ts`
 * asserts that this file and `tokens.css` never drift apart, so a brand change
 * means editing two colocated lists and nothing else.
 */

import { contrastRatio, formatRatio, requiredRatio, type ContrastKind } from './contrast.js';

export type ColorTokenName =
  // Neutrals
  | 'color-surface'
  | 'color-surface-raised'
  | 'color-surface-sunken'
  | 'color-text'
  | 'color-text-muted'
  | 'color-border'
  | 'color-border-strong'
  | 'color-focus-ring'
  // Primary accent
  | 'color-primary'
  | 'color-primary-hover'
  | 'color-primary-on'
  | 'color-primary-soft'
  | 'color-primary-soft-text'
  // Signature brand orange, decorative and Luma-voice surfaces only
  | 'color-brand'
  | 'color-brand-on'
  // Semantic
  | 'color-success'
  | 'color-success-on'
  | 'color-success-soft'
  | 'color-success-soft-text'
  | 'color-warning'
  | 'color-warning-on'
  | 'color-warning-soft'
  | 'color-warning-soft-text'
  | 'color-danger'
  | 'color-danger-hover'
  | 'color-danger-on'
  | 'color-danger-soft'
  | 'color-danger-soft-text'
  | 'color-info'
  | 'color-info-on'
  | 'color-info-soft'
  | 'color-info-soft-text'
  // Promotion (spec section 23.4: Luma promotion must be visually separated)
  | 'color-promotion-surface'
  | 'color-promotion-border'
  | 'color-promotion-text'
  | 'color-promotion-muted'
  | 'color-promotion-accent';

export type ColorScale = Readonly<Record<ColorTokenName, string>>;

export const lightColors: ColorScale = {
  'color-surface': '#ffffff',
  'color-surface-raised': '#faf7f4',
  'color-surface-sunken': '#f0ebe5',
  'color-text': '#1a1614',
  'color-text-muted': '#57504b',
  'color-border': '#8a817a',
  'color-border-strong': '#6b635c',
  'color-focus-ring': '#b83d0a',

  'color-primary': '#b83d0a',
  'color-primary-hover': '#8c2f08',
  'color-primary-on': '#ffffff',
  'color-primary-soft': '#ffe8dc',
  'color-primary-soft-text': '#8a2f08',

  'color-brand': '#ff6b35',
  'color-brand-on': '#26150c',

  'color-success': '#1a6b3f',
  'color-success-on': '#ffffff',
  'color-success-soft': '#e3f2e9',
  'color-success-soft-text': '#12502f',

  'color-warning': '#8a5300',
  'color-warning-on': '#ffffff',
  'color-warning-soft': '#fbf0dc',
  'color-warning-soft-text': '#6b4000',

  'color-danger': '#a32020',
  'color-danger-hover': '#85191a',
  'color-danger-on': '#ffffff',
  'color-danger-soft': '#fbe9e9',
  'color-danger-soft-text': '#8a1c1c',

  'color-info': '#0f5c78',
  'color-info-on': '#ffffff',
  'color-info-soft': '#e2f0f5',
  'color-info-soft-text': '#0c4a61',

  'color-promotion-surface': '#fff5e6',
  'color-promotion-border': '#b83d0a',
  'color-promotion-text': '#2b1d12',
  'color-promotion-muted': '#5a4634',
  'color-promotion-accent': '#8a3d0b',
};

export const darkColors: ColorScale = {
  'color-surface': '#17120f',
  'color-surface-raised': '#211a16',
  'color-surface-sunken': '#0e0b09',
  'color-text': '#f5efea',
  'color-text-muted': '#b8ada4',
  'color-border': '#7a6f66',
  'color-border-strong': '#a2968c',
  'color-focus-ring': '#ff9466',

  'color-primary': '#ff8a5c',
  'color-primary-hover': '#ffa783',
  'color-primary-on': '#2b1206',
  'color-primary-soft': '#3a2115',
  'color-primary-soft-text': '#ffb894',

  'color-brand': '#ff6b35',
  'color-brand-on': '#1a0c05',

  'color-success': '#62c48d',
  'color-success-on': '#04170d',
  'color-success-soft': '#12291d',
  'color-success-soft-text': '#8ddab0',

  'color-warning': '#e0a94a',
  'color-warning-on': '#1c1204',
  'color-warning-soft': '#2e2410',
  'color-warning-soft-text': '#edc47f',

  'color-danger': '#f08a8a',
  'color-danger-hover': '#f5abab',
  'color-danger-on': '#200606',
  'color-danger-soft': '#331515',
  'color-danger-soft-text': '#f4a9a9',

  'color-info': '#66bcd8',
  'color-info-on': '#04171e',
  'color-info-soft': '#10262e',
  'color-info-soft-text': '#94d3e8',

  'color-promotion-surface': '#2c2214',
  'color-promotion-border': '#c98a45',
  'color-promotion-text': '#f7eedf',
  'color-promotion-muted': '#d3c2a6',
  'color-promotion-accent': '#f0b978',
};

export const themes = {
  light: lightColors,
  dark: darkColors,
} as const;

export type ThemeName = keyof typeof themes;

/** CSS custom property name for a token, e.g. `--luma-color-surface`. */
export const TOKEN_PREFIX = '--luma-';

export function cssVarName(token: ColorTokenName): string {
  return `${TOKEN_PREFIX}${token}`;
}

/** `var(--luma-color-surface)`, for inline styles that need a token. */
export function cssVar(token: ColorTokenName): string {
  return `var(${cssVarName(token)})`;
}

/**
 * Every colour pair the design system actually renders, with the WCAG level
 * it has to clear. Adding a colour combination to a component means adding it
 * here, otherwise it is not covered by the contrast test.
 */
export interface ContrastPair {
  readonly foreground: ColorTokenName;
  readonly background: ColorTokenName;
  readonly kind: ContrastKind;
  /** Where the pair is used, so a failure points at real UI. */
  readonly usage: string;
}

const surfaces = ['color-surface', 'color-surface-raised', 'color-surface-sunken'] as const;

function onEverySurface(
  foreground: ColorTokenName,
  kind: ContrastKind,
  usage: string,
): ContrastPair[] {
  return surfaces.map((background) => ({ foreground, background, kind, usage }));
}

export const contrastPairs: readonly ContrastPair[] = [
  ...onEverySurface('color-text', 'text', 'Brødtekst og overskrifter'),
  ...onEverySurface('color-text-muted', 'text', 'Hjelpetekst, metadata, frist'),
  ...onEverySurface('color-border', 'non-text', 'Kantlinje på kort og felt'),
  ...onEverySurface('color-border-strong', 'non-text', 'Kantlinje på sekundærknapp'),
  ...onEverySurface('color-focus-ring', 'non-text', 'Fokusring'),
  ...onEverySurface('color-primary', 'text', 'Lenker og tekstknapper'),

  {
    foreground: 'color-brand-on',
    background: 'color-brand',
    kind: 'text',
    usage: 'Luma-merkede flater i signaturoransje',
  },
  {
    foreground: 'color-primary-on',
    background: 'color-primary',
    kind: 'text',
    usage: 'Primærknapp',
  },
  {
    foreground: 'color-primary-on',
    background: 'color-primary-hover',
    kind: 'text',
    usage: 'Primærknapp, hover',
  },
  {
    foreground: 'color-primary-soft-text',
    background: 'color-primary-soft',
    kind: 'text',
    usage: 'Info-badge og callout',
  },
  {
    foreground: 'color-primary',
    background: 'color-primary-soft',
    kind: 'large-text',
    usage: 'Overskrift i callout (stor tekst)',
  },
  {
    foreground: 'color-border',
    background: 'color-primary-soft',
    kind: 'non-text',
    usage: 'Kantlinje på callout',
  },

  {
    foreground: 'color-success-on',
    background: 'color-success',
    kind: 'text',
    usage: 'Suksessknapp og full badge',
  },
  {
    foreground: 'color-success-soft-text',
    background: 'color-success-soft',
    kind: 'text',
    usage: 'Suksess-callout',
  },
  ...onEverySurface('color-success', 'non-text', 'Statusmarkør, suksess'),

  {
    foreground: 'color-warning-on',
    background: 'color-warning',
    kind: 'text',
    usage: 'Advarselsbadge',
  },
  {
    foreground: 'color-warning-soft-text',
    background: 'color-warning-soft',
    kind: 'text',
    usage: 'Advarsels-callout',
  },
  ...onEverySurface('color-warning', 'non-text', 'Statusmarkør, frist nær'),

  {
    foreground: 'color-danger-on',
    background: 'color-danger',
    kind: 'text',
    usage: 'Fareknapp',
  },
  {
    foreground: 'color-danger-on',
    background: 'color-danger-hover',
    kind: 'text',
    usage: 'Fareknapp, hover',
  },
  {
    foreground: 'color-danger-soft-text',
    background: 'color-danger-soft',
    kind: 'text',
    usage: 'Feilmelding',
  },
  ...onEverySurface('color-danger', 'text', 'Feilmelding under skjemafelt'),

  {
    foreground: 'color-info-on',
    background: 'color-info',
    kind: 'text',
    usage: 'Badge for planlagt anskaffelse',
  },
  {
    foreground: 'color-info-soft-text',
    background: 'color-info-soft',
    kind: 'text',
    usage: 'Informasjons-callout',
  },
  ...onEverySurface('color-info', 'non-text', 'Statusmarkør, planlagt'),

  {
    foreground: 'color-promotion-text',
    background: 'color-promotion-surface',
    kind: 'text',
    usage: 'Tekst i Luma-promoteringsblokk',
  },
  {
    foreground: 'color-promotion-muted',
    background: 'color-promotion-surface',
    kind: 'text',
    usage: 'Merkingen «Fra Luma Training»',
  },
  {
    foreground: 'color-promotion-accent',
    background: 'color-promotion-surface',
    kind: 'text',
    usage: 'Lenke i promoteringsblokk',
  },
  ...onEverySurface(
    'color-promotion-border',
    'non-text',
    'Kantlinje som skiller promotering fra anbudsinnhold',
  ),
  {
    foreground: 'color-promotion-border',
    background: 'color-promotion-surface',
    kind: 'non-text',
    usage: 'Kantlinje mot egen promoteringsflate',
  },
];

export interface ContrastViolation {
  readonly theme: ThemeName;
  readonly pair: ContrastPair;
  readonly actual: number;
  readonly required: number;
}

/**
 * Returns every pair that fails its required ratio. An empty array means the
 * palette is AA-clean; a non-empty array is the failure report.
 */
export function findContrastViolations(
  theme: ThemeName,
  pairs: readonly ContrastPair[] = contrastPairs,
): ContrastViolation[] {
  const colors = themes[theme];
  const violations: ContrastViolation[] = [];

  for (const pair of pairs) {
    const actual = contrastRatio(colors[pair.foreground], colors[pair.background]);
    const required = requiredRatio(pair.kind);
    if (actual < required) {
      violations.push({ theme, pair, actual, required });
    }
  }

  return violations;
}

export function describeViolation(violation: ContrastViolation): string {
  const { theme, pair, actual, required } = violation;
  return (
    `[${theme}] ${pair.foreground} on ${pair.background} ` +
    `= ${formatRatio(actual)}, krever ${formatRatio(required)} (${pair.kind}) — ${pair.usage}`
  );
}
