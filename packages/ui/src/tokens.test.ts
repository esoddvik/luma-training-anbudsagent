import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, formatRatio, perceptualDistance, requiredRatio } from './contrast.js';
import {
  contrastPairs,
  cssVar,
  cssVarName,
  darkColors,
  describeViolation,
  findContrastViolations,
  lightColors,
  radii,
  themes,
  TOKEN_PREFIX,
  type ColorTokenName,
  type ContrastPair,
  type RadiusTokenName,
  type ThemeName,
} from './tokens.js';

const cssSource = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const componentStyles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

/** Pulls the declarations of one rule block. The token blocks contain no nested braces. */
function ruleBlock(pattern: RegExp): string {
  const match = pattern.exec(cssSource);
  if (match === null || match[1] === undefined) {
    throw new Error(`Fant ikke regelblokken for ${pattern}`);
  }
  return match[1];
}

function customProperties(block: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  const pattern = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let match = pattern.exec(block);
  while (match !== null) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) {
      declarations[name] = value.trim();
    }
    match = pattern.exec(block);
  }
  return declarations;
}

const lightBlock = customProperties(ruleBlock(/:root\s*\{([\s\S]*?)\n\}/));
const darkMediaBlock = customProperties(
  ruleBlock(
    /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)\s*\{([\s\S]*?)\n {2}\}/,
  ),
);
const darkAttributeBlock = customProperties(
  ruleBlock(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/),
);

function colorProperties(block: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(block).filter(([name]) => name.startsWith(`${TOKEN_PREFIX}color-`)),
  );
}

function expectedCss(scale: Readonly<Record<ColorTokenName, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(scale).map(([token, value]) => [cssVarName(token as ColorTokenName), value]),
  );
}

describe('tokens.css is the single source of truth', () => {
  it('light block matches the TypeScript mirror exactly', () => {
    expect(colorProperties(lightBlock)).toEqual(expectedCss(lightColors));
  });

  it('dark prefers-color-scheme block matches the TypeScript mirror exactly', () => {
    expect(colorProperties(darkMediaBlock)).toEqual(expectedCss(darkColors));
  });

  it('dark [data-theme] override matches the TypeScript mirror exactly', () => {
    expect(colorProperties(darkAttributeBlock)).toEqual(expectedCss(darkColors));
  });

  it('defines the non-colour token groups', () => {
    for (const name of [
      '--luma-font-sans',
      '--luma-font-mono',
      '--luma-font-size-md',
      '--luma-line-height-normal',
      '--luma-space-md',
      '--luma-radius-md',
      '--luma-focus-ring-width',
      '--luma-hit-target-min',
      '--luma-shadow-hover',
    ]) {
      expect(lightBlock, `mangler ${name}`).toHaveProperty(name);
    }
  });

  it('radius scale matches the TypeScript mirror exactly', () => {
    const cssRadii = Object.fromEntries(
      Object.entries(lightBlock).filter(([name]) => name.startsWith(`${TOKEN_PREFIX}radius-`)),
    );
    const mirrored = Object.fromEntries(
      Object.entries(radii).map(([token, value]) => [cssVarName(token as RadiusTokenName), value]),
    );
    expect(cssRadii).toEqual(mirrored);
  });

  /**
   * A scale that is out of order is not a typo in one place — it silently makes
   * `sm` rounder than `md` on every button, input and card at once, and nothing
   * else in the suite would notice.
   */
  it('keeps the radius scale ascending', () => {
    const steps: RadiusTokenName[] = ['radius-xs', 'radius-sm', 'radius-md', 'radius-lg'];
    const pixels = steps.map((token) => Number.parseFloat(radii[token]));

    for (let index = 1; index < pixels.length; index += 1) {
      expect(
        pixels[index],
        `${steps[index]} (${radii[steps[index]!]}) er ikke større enn ${steps[index - 1]} (${radii[steps[index - 1]!]})`,
      ).toBeGreaterThan(pixels[index - 1]!);
    }
  });

  /**
   * The dark palette is written out twice, so a shadow added to `:root` alone
   * resolves to nothing in dark mode — an unset custom property is not
   * inherited from the light block, it is simply invalid.
   */
  it('defines every elevation token in all three theme blocks', () => {
    const shadowNames = Object.keys(lightBlock).filter((name) =>
      name.startsWith(`${TOKEN_PREFIX}shadow-`),
    );
    expect(shadowNames.length).toBeGreaterThanOrEqual(3);

    for (const name of shadowNames) {
      expect(darkMediaBlock, `mangler ${name} i prefers-color-scheme-blokken`).toHaveProperty(name);
      expect(darkAttributeBlock, `mangler ${name} i [data-theme='dark']-blokken`).toHaveProperty(
        name,
      );
    }
  });

  it('reserves a promotion token group so promotion is visually distinct', () => {
    const promotionTokens = Object.keys(colorProperties(lightBlock)).filter((name) =>
      name.startsWith('--luma-color-promotion-'),
    );
    expect(promotionTokens.length).toBeGreaterThanOrEqual(5);

    // Spec 23.4: the promotion surface must not be one of the tender surfaces.
    const tenderSurfaces = [
      lightColors['color-surface'],
      lightColors['color-surface-raised'],
      lightColors['color-surface-sunken'],
    ];
    expect(tenderSurfaces).not.toContain(lightColors['color-promotion-surface']);
    expect([
      darkColors['color-surface'],
      darkColors['color-surface-raised'],
      darkColors['color-surface-sunken'],
    ]).not.toContain(darkColors['color-promotion-surface']);
  });

  /**
   * Inequality is too weak a test for 23.4 now that the palette is warm.
   *
   * Two creams one hex apart are different strings and identical to the eye, so
   * `not.toContain` keeps passing while the promotion block dissolves into the
   * page.
   *
   * The metric is a perceptual distance, not a contrast ratio. Contrast ratio
   * measures *legibility*: it compares luminance only, so a peach and a cream
   * of the same lightness score about 1.0 while being obviously different to
   * look at. Using it here would have forced the promotion surface darker to
   * satisfy a number that never described the property in question.
   *
   * **What this threshold does and does not promise.** It is set below the
   * subtlest step the design uses deliberately (white to `surface-raised`, a
   * distance of about 24), because the promotion block is not carrying the
   * separation on tint alone — it also has a heavy branded border and an
   * explicit Luma label, which is what 23.4 actually asks for. So this guards
   * against the surfaces collapsing into each other, not against subtlety.
   * A promotion surface that passed this and still looked like a tender card
   * would be a design failure the test cannot see.
   */
  it('keeps the promotion surface perceptibly distinct from tender surfaces', () => {
    const MIN_DISTANCE = 18;

    for (const [themeName, colors] of [
      ['light', lightColors],
      ['dark', darkColors],
    ] as const) {
      const promotion = colors['color-promotion-surface'];
      for (const token of [
        'color-surface',
        'color-surface-raised',
        'color-surface-sunken',
      ] as const) {
        const distance = perceptualDistance(promotion, colors[token]);
        expect(
          distance,
          `${themeName}: promotion surface is ${distance.toFixed(1)} from ${token}, below ${MIN_DISTANCE} — it would not read as a separate block (spec 23.4)`,
        ).toBeGreaterThanOrEqual(MIN_DISTANCE);
      }
    }
  });

  it('keeps the touch target at or above 44px', () => {
    expect(lightBlock['--luma-hit-target-min']).toBe('44px');
  });
});

/**
 * Removes every `@media (prefers-reduced-motion: no-preference)` block, counting
 * braces so a nested rule cannot end the block early. What is left is the CSS
 * that applies to a reader who has asked their system for less motion.
 */
function stripMotionSafeBlocks(css: string): string {
  const marker = '@media (prefers-reduced-motion: no-preference)';
  let remaining = css;

  for (;;) {
    const start = remaining.indexOf(marker);
    if (start === -1) {
      return remaining;
    }

    const open = remaining.indexOf('{', start);
    if (open === -1) {
      throw new Error(`Fant ${marker} uten blokk`);
    }

    let depth = 0;
    let index = open;
    for (; index < remaining.length; index += 1) {
      if (remaining[index] === '{') {
        depth += 1;
      } else if (remaining[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      }
    }
    if (depth !== 0) {
      throw new Error(`Ubalanserte klammer etter ${marker}`);
    }

    remaining = remaining.slice(0, start) + remaining.slice(index + 1);
  }
}

/** Selectors of every `:hover` rule that moves the element with `transform`. */
function hoverRulesWithTransform(css: string): string[] {
  const selectors: string[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;

  let match = pattern.exec(css);
  while (match !== null) {
    const selector = (match[1] ?? '').trim();
    const body = match[2] ?? '';
    if (selector.includes(':hover') && /(^|[\s;])transform\s*:/.test(body)) {
      selectors.push(selector.replace(/\s+/g, ' '));
    }
    match = pattern.exec(css);
  }

  return selectors;
}

describe('styles.css only references tokens', () => {
  it('contains no literal hex colours', () => {
    const hexLiterals = componentStyles.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    expect(hexLiterals).toEqual([]);
  });

  it('gives every interactive primitive a visible focus ring', () => {
    for (const selector of [
      '.luma-button:focus-visible',
      '.luma-input:focus-visible',
      '.luma-textarea:focus-visible',
      '.luma-select:focus-visible',
      '.luma-checkbox__control:focus-visible',
      '.luma-skip-link:focus-visible',
    ]) {
      expect(componentStyles, `mangler fokusring for ${selector}`).toContain(selector);
    }
    expect(componentStyles).toContain('outline: var(--luma-focus-ring-width)');
  });

  /**
   * Luma's hover lift is a `transform`, and a transform that ignores
   * `prefers-reduced-motion` is an accessibility regression, not a flourish.
   *
   * The guard is written as `no-preference` rather than as an override inside a
   * `reduce` block, so the check is "no hover rule outside the guard moves
   * anything" — which also catches a lift added somewhere else in the file, not
   * only the one on `.luma-button`. Transforms that are *not* on `:hover` are
   * out of scope on purpose: `.luma-skip-link` parks itself off-screen with
   * `translateY(-200%)` and must keep doing that at every motion setting.
   */
  it('declares no hover transform outside the reduced-motion guard', () => {
    expect(hoverRulesWithTransform(stripMotionSafeBlocks(componentStyles))).toEqual([]);
  });

  /**
   * Without this, deleting the lift entirely would make the test above pass by
   * having nothing left to find.
   */
  /**
   * Spec 23.4's separator used to be drawn with `--luma-radius-sm`, so widening
   * the radius scale for the brand refresh silently thickened it. The strength
   * of a compliance-driven rule must not be a side effect of how round the
   * buttons are.
   */
  it('draws the promotion separator from a border token, not the radius scale', () => {
    expect(componentStyles).toContain('border-top-width: var(--luma-border-width-heavy)');
    expect(componentStyles).not.toContain('border-top-width: var(--luma-radius');
  });

  /**
   * The supporting-panel card tone is the obvious place for someone to reach
   * for the brand cream, which would put a second block on the promotion
   * surface and dissolve the separation 23.4 asks for.
   */
  it('keeps the supporting-panel card off the promotion surface', () => {
    const block = /\.luma-card--secondary\s*\{([^}]*)\}/.exec(componentStyles)?.[1];
    expect(block, 'fant ikke .luma-card--secondary').toBeDefined();
    expect(block).toContain('var(--luma-color-surface-sunken)');
    expect(block).not.toContain('promotion');
  });

  it('still ships the hover lift inside that guard', () => {
    const lifted = hoverRulesWithTransform(componentStyles);
    expect(lifted.join(' ')).toContain('.luma-button--primary:hover');
  });
});

describe('WCAG AA contrast', () => {
  const themeNames = Object.keys(themes) as ThemeName[];

  it.each(themeNames)('%s theme has no contrast violations', (theme) => {
    const violations = findContrastViolations(theme);
    expect(violations.map(describeViolation)).toEqual([]);
  });

  it.each(
    themeNames.flatMap((theme) =>
      contrastPairs.map((pair) => [theme, pair] as [ThemeName, ContrastPair]),
    ),
  )('%s: %o clears its threshold', (theme, pair) => {
    const colors = themes[theme];
    const ratio = contrastRatio(colors[pair.foreground], colors[pair.background]);
    const required = requiredRatio(pair.kind);
    expect(
      ratio,
      `${pair.foreground} på ${pair.background} er ${formatRatio(ratio)}, ` +
        `krever ${formatRatio(required)} — ${pair.usage}`,
    ).toBeGreaterThanOrEqual(required);
  });

  it('covers every colour token that is ever rendered as foreground or background', () => {
    const covered = new Set<ColorTokenName>();
    for (const pair of contrastPairs) {
      covered.add(pair.foreground);
      covered.add(pair.background);
    }

    const allTokens = Object.keys(lightColors) as ColorTokenName[];
    const uncovered = allTokens.filter((token) => !covered.has(token));
    expect(uncovered).toEqual([]);
  });

  // Injection seam: proves the suite is capable of turning red. If the palette
  // check ever silently passes on a broken pair, this test fails first.
  it('reports a violation when a bad pair is injected', () => {
    const badPair: ContrastPair = {
      foreground: 'color-surface-raised',
      background: 'color-surface',
      kind: 'text',
      usage: 'Bevisst dårlig par, kun for å bevise at testen kan feile',
    };

    const violations = findContrastViolations('light', [badPair]);
    expect(violations).toHaveLength(1);
    expect(describeViolation(violations[0]!)).toMatch(/krever 4\.50:1/);
  });
});

describe('css variable helpers', () => {
  it('builds custom property names', () => {
    expect(cssVarName('color-surface')).toBe('--luma-color-surface');
  });

  it('builds var() references', () => {
    expect(cssVar('color-promotion-surface')).toBe('var(--luma-color-promotion-surface)');
  });
});
