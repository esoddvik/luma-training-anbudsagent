import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, formatRatio, requiredRatio } from './contrast.js';
import {
  contrastPairs,
  cssVar,
  cssVarName,
  darkColors,
  describeViolation,
  findContrastViolations,
  lightColors,
  themes,
  TOKEN_PREFIX,
  type ColorTokenName,
  type ContrastPair,
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
    ]) {
      expect(lightBlock, `mangler ${name}`).toHaveProperty(name);
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

  it('keeps the touch target at or above 44px', () => {
    expect(lightBlock['--luma-hit-target-min']).toBe('44px');
  });
});

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
