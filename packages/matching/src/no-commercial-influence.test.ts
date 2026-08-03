import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { matchTender } from './engine.js';
import { CLEANING_FRAMEWORK, CLEANING_PROFILE, FIXED_NOW } from './testing/fixtures.js';

/**
 * ADR-0006 verification hook.
 *
 * Spec section 3 promises the user that commercial considerations never affect
 * which tenders they are shown. ADR-0006 makes that a property of the build
 * rather than a claim in a document: the separation between ranking and
 * marketing is a module boundary with no import edge, and this test is what
 * keeps the edge from ever appearing.
 *
 * It reads this package's own manifest and every source file under `src/`, and
 * fails on a banned dependency (direct or transitive), a banned import, an
 * import of the domain's editorial or attribution symbols, or any identifier
 * naming a commercial concept.
 *
 * The identifier scan runs over source with comments stripped, so the prose
 * above is allowed to discuss what the code may not contain.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, '..');

/** Packages this one must never reach, per ADR-0004 and ADR-0006. */
const BANNED_PACKAGES = [
  '@luma/attribution',
  '@luma/email',
  '@luma/db',
  '@luma/doffin',
  'axios',
  'undici',
  'node-fetch',
  'got',
];

/** Node built-ins that would make the engine impure (ADR-0004 property 1). */
const BANNED_BUILTINS = ['node:fs', 'node:http', 'node:https', 'node:net', 'node:child_process'];

/**
 * Symbols the domain exports from its editorial and attribution modules.
 * `@luma/domain` re-exports everything from one entry point, so the boundary
 * has to be checked at the symbol level rather than by module path.
 */
const BANNED_DOMAIN_SYMBOLS = [
  'EditorialRecommendation',
  'editorialRecommendationSchema',
  'PromotionPlacement',
  'promotionPlacementSchema',
  'MarketingCategory',
  'marketingCategorySchema',
  'LadderLevel',
  'ladderLevelSchema',
  'RegionScope',
  'regionScopeSchema',
  'PROMOTION_HEADINGS_NB',
  'PROMOTION_DISCLOSURE_NB',
  'PAID_OFFER_LABEL_NB',
  'isRecommendationEligible',
  'AttributionEvent',
  'attributionEventSchema',
  'AttributionEventType',
  'UTM_SOURCE',
  'UtmMedium',
  'UtmParams',
  'withUtm',
];

/** Commercial vocabulary that must not appear as code. */
const COMMERCIAL_IDENTIFIER = /paafyll|kurs|webinar|promotion|campaign|utm|attribution/i;

interface PackageManifest {
  name?: string;
  dependencies?: Record<string, string>;
}

function readManifest(packageDir: string): PackageManifest {
  return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as PackageManifest;
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found.sort();
}

/**
 * Removes line and block comments while respecting string and template
 * literals, so a URL inside a string is not mistaken for a comment and a
 * comment is not mistaken for code.
 */
export function stripComments(source: string): string {
  let output = '';
  let index = 0;
  let quote: string | null = null;

  while (index < source.length) {
    const character = source.charAt(index);
    const next = source.charAt(index + 1);

    if (quote !== null) {
      output += character;
      if (character === '\\') {
        output += next;
        index += 2;
        continue;
      }
      if (character === quote) quote = null;
      index += 1;
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      output += character;
      index += 1;
      continue;
    }

    if (character === '/' && next === '/') {
      while (index < source.length && source.charAt(index) !== '\n') index += 1;
      continue;
    }

    if (character === '/' && next === '*') {
      index += 2;
      while (
        index < source.length &&
        !(source.charAt(index) === '*' && source.charAt(index + 1) === '/')
      ) {
        index += 1;
      }
      index += 2;
      continue;
    }

    output += character;
    index += 1;
  }

  return output;
}

const IMPORT_SOURCE = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

function importedModules(source: string): string[] {
  return [...source.matchAll(IMPORT_SOURCE)].map((match) => match[1] ?? '');
}

/**
 * Every source file except this one.
 *
 * The scanner has to be excluded from its own import scan: it necessarily
 * contains the banned module names, both as the list it checks against and as
 * the deliberately violating sample at the bottom of the file. Leaving it in
 * made the suite fail on its own fixture — which is a decent demonstration
 * that the scan works, but not a useful assertion to keep.
 */
const ALL_FILES = sourceFiles(join(PACKAGE_ROOT, 'src')).filter(
  (path) => path !== fileURLToPath(import.meta.url),
);
const RUNTIME_FILES = ALL_FILES.filter((path) => !path.endsWith('.test.ts'));

function named(paths: readonly string[]): ReadonlyArray<readonly [string, string]> {
  return paths.map((path) => [relative(PACKAGE_ROOT, path).replace(/\\/g, '/'), path] as const);
}

describe('the matching package cannot reach anything commercial', () => {
  it('finds source files to check, so a green run is not an empty run', () => {
    expect(RUNTIME_FILES.length).toBeGreaterThan(8);
    expect(ALL_FILES.length).toBeGreaterThan(RUNTIME_FILES.length);
  });

  it('declares only @luma/domain as a runtime dependency', () => {
    expect(Object.keys(readManifest(PACKAGE_ROOT).dependencies ?? {})).toEqual(['@luma/domain']);
  });

  it('has no banned package anywhere in its dependency closure', () => {
    const visited = new Set<string>();

    const walk = (packageDir: string): void => {
      const manifest = readManifest(packageDir);
      for (const dependency of Object.keys(manifest.dependencies ?? {})) {
        expect(
          BANNED_PACKAGES,
          `${manifest.name ?? packageDir} depends on ${dependency}`,
        ).not.toContain(dependency);

        if (dependency.startsWith('@luma/')) {
          const child = join(PACKAGE_ROOT, '..', dependency.slice('@luma/'.length));
          if (!visited.has(child)) {
            visited.add(child);
            walk(child);
          }
        }
      }
    };

    walk(PACKAGE_ROOT);
  });

  it.each(named(ALL_FILES))('%s imports no banned package', (_name, path) => {
    for (const module of importedModules(readFileSync(path, 'utf8'))) {
      expect(BANNED_PACKAGES).not.toContain(module);
    }
  });

  it.each(named(RUNTIME_FILES))('%s does no I/O', (_name, path) => {
    for (const module of importedModules(readFileSync(path, 'utf8'))) {
      expect(BANNED_BUILTINS).not.toContain(module);
    }
  });

  it.each(named(RUNTIME_FILES))(
    '%s imports no editorial or attribution symbol from the domain',
    (_name, path) => {
      const code = stripComments(readFileSync(path, 'utf8'));
      for (const symbol of BANNED_DOMAIN_SYMBOLS) {
        expect(code).not.toContain(symbol);
      }
    },
  );

  it.each(named(RUNTIME_FILES))(
    '%s contains no commercial identifier outside a comment',
    (_name, path) => {
      const code = stripComments(readFileSync(path, 'utf8'));
      const offending = code
        .split('\n')
        .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
        .filter(({ line }) => COMMERCIAL_IDENTIFIER.test(line));

      expect(offending).toEqual([]);
    },
  );

  it('keeps MatchResult free of commercial fields', () => {
    // ADR-0006 decision 3, checked from this side of the boundary too: a
    // `sponsored` or `campaignId` field would fail here as well as in the
    // domain package.
    const result = matchTender(CLEANING_FRAMEWORK, CLEANING_PROFILE, { now: FIXED_NOW });
    expect(Object.keys(result)).toEqual([
      'tenderId',
      'alertProfileId',
      'score',
      'confidence',
      'included',
      'reasons',
      'exclusions',
      'matchingVersion',
    ]);
  });
});

/**
 * Guards the guard.
 *
 * A scan that cannot fail is theatre. If `stripComments` or the pattern ever
 * stopped working, every file above would pass vacuously and nobody would
 * know. These cases inject the exact violations the scan exists to catch and
 * assert that it reacts.
 */
describe('the scan itself can fail', () => {
  const violating = [
    "import { withUtm } from '@luma/attribution';",
    'const attributionBoost = 5;',
    'function kursKlikkVekt() { return 1; }',
  ].join('\n');

  it('flags a banned import', () => {
    expect(importedModules(violating)).toContain('@luma/attribution');
  });

  it('flags a banned domain symbol', () => {
    expect(stripComments(violating)).toContain('withUtm');
  });

  it('flags a commercial identifier', () => {
    expect(COMMERCIAL_IDENTIFIER.test(stripComments(violating))).toBe(true);
  });

  it('allows the same words inside a comment', () => {
    const prose = '// Never import from that package, and never weight kurs clicks.\nconst x = 1;';
    expect(COMMERCIAL_IDENTIFIER.test(stripComments(prose))).toBe(false);
    expect(stripComments(prose).trim()).toBe('const x = 1;');
  });

  it('does not mistake a URL in a string for a comment', () => {
    const code = "const url = 'https://doffin.no/notices/1';";
    expect(stripComments(code)).toBe(code);
  });

  it('strips a block comment without eating the code after it', () => {
    expect(stripComments('/* kurs */ const x = 1;').trim()).toBe('const x = 1;');
  });
});
