#!/usr/bin/env node
/**
 * Resolves every specification citation in the repository against the
 * specification's own headings.
 *
 * This exists because three wrong citations were found by hand during the
 * build, and the expensive kind is not the dangling one. A citation that
 * points at a *real but wrong* section survives every "does this reference
 * exist" check and sends the reader somewhere plausible to read the wrong
 * rule. This script cannot catch that — judging whether §23.1 or §23.3 is
 * the right home for the promotion ladder needs a person. What it does is
 * remove the cheaper failure so that the reviews which can only be done by
 * hand are not spent on it.
 *
 * ## Two specifications, two citation forms, deliberately separate
 *
 * v3 supplements v2 and renumbers nothing, so the same number means two
 * different sections: v3 §3 is the search-first funnel, v2 §3 is the trust
 * contract. Resolving both against one pool would make a citation to either
 * look fine while pointing at the wrong document — precisely the failure this
 * script is too dumb to catch. So each specification has its own headings and
 * its own citation pattern, and a citation names its document or it is a v2
 * citation.
 *
 * That split is not cosmetic. Before v3 was tracked, its ~80 citations matched
 * no pattern at all: the script reported a confident green over the older half
 * of the repository while every reference in the newest work went unchecked.
 *
 * Read SELF_TEST and CITATION_SELF_TEST before changing any pattern here.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Top-level headings carry a period after the number, subsections do not:
 *
 *     ## 12. Doffin-integrasjon
 *     ### 11.2 Bransjemaler
 *
 * A pattern that requires the period silently loses every subsection, and
 * then reports accurate citations as broken. That is not hypothetical — it
 * happened twice while this check was being written, and in one case nine
 * correct citations were nearly "fixed" on the strength of it. The period is
 * optional here, and SELF_TEST pins both styles.
 */
const HEADING = /^#{2,4}\s+(\d+(?:\.\d+)?)\.?\s+(.+)$/;

/**
 * The two specifications, each with the citation form that points at it.
 *
 * `selfTest` names one section of each heading style that is known to exist,
 * checked before any report is trusted.
 */
const SPECS = [
  {
    key: 'v2',
    file: 'Luma_Anbudsvarsling_IDE_Agent_Specification_v2.md',
    /** `§5`, `spec section 5`, `specification section 5`. */
    citation: /(?:§|spec(?:ification)?\s+section\s+)(\d+(?:\.\d+)?)/gi,
    selfTest: [
      ['12', 'top-level, period after the number'],
      ['11.2', 'subsection, no period after the number'],
      ['0', 'section zero, which sorts and parses unlike the rest'],
    ],
    /** `§5 item 3` resolves on the `§5` and ignores the rest. */
    hint:
      'Numbered list items are a common false positive: §5 has four items and no\n' +
      'subsections, so a reference to its third item is written "§5 item 3", not "§5.3".',
  },
  {
    key: 'v3',
    file: 'Luma_Anbudsvarsling_IDE_Agent_Specification_v3.md',
    /*
     * Anything naming v3 and then a number. The forms in the repository are
     * "Spec v3, section 3.2", the same without the comma, "sections 4 and
     * 7.2", and the bare "Spec v3, 3.2" — all written by hand over four
     * phases, so the pattern accommodates them rather than the other way
     * round. What must NOT match is a mention: "Spec v3 introduces…" and the
     * document's own title both continue with a word, not a digit.
     */
    citation:
      /spec(?:ification)?\s+v3\b[,\s]*(?:sections?\s+)?(\d+(?:\.\d+)?)(?:\s+and\s+(\d+(?:\.\d+)?))?/gi,
    selfTest: [
      ['4', 'top-level, period after the number'],
      ['7.2', 'subsection, no period after the number'],
      ['0', 'section zero, which sorts and parses unlike the rest'],
    ],
    hint:
      'v3 has twelve sections and stops at 12. A number above that is almost always a\n' +
      'v2 citation that picked up the words "Spec v3" from the sentence in front of it.',
  },
];

/**
 * Snippets taken from the repository, with what each must resolve to.
 *
 * The heading self-test proves the script can read the specification. This
 * one proves it can read the *code* — a pattern that silently stops matching
 * a citation form reports a clean run over citations it never looked at, and
 * a green that means "found nothing" is the failure mode this whole script
 * exists to prevent. Every form below is one that is actually in use.
 */
const CITATION_SELF_TEST = [
  ['v2', '§12 and §23.1 apply', ['12', '23.1'], 'the section-sign form'],
  ['v2', 'the promotion ladder (spec section 22)', ['22'], 'the spelled-out form'],
  ['v2', 'specification section 11.2', ['11.2'], 'the long spelled-out form'],
  ['v3', 'IDE Agent Spec v3, section 3.2).', ['3.2'], 'the ordinary form'],
  ['v3', 'Spec v3 section 3.2 forbids `force-dynamic`', ['3.2'], 'without the comma'],
  ['v3', 'IDE Agent Spec v3, sections 4 and 7.2).', ['4', '7.2'], 'two sections at once'],
  ['v3', 'the reasons panel (IDE Agent Spec v3, 3.2).', ['3.2'], 'without the word "section"'],
  ['v3', ' * link (IDE Agent Spec v3,\n * section 3.2).', ['3.2'], 'wrapped across comment lines'],
  ['v3', 'IDE Agent Spec v3 introduces attribution', [], 'a mention, not a citation'],
  ['v3', '# … IDE Agent Spec v3: Søk-først, Pluss', [], "the document's own title"],
];

function fail(message) {
  console.error(`\ncheck-citations: ${message}\n`);
  process.exit(1);
}

/**
 * Rejoins a citation that a comment wrapped across two lines — **without
 * moving a single character**.
 *
 * Every run of newline-plus-comment-margin becomes the same number of spaces,
 * so an index into the result is still an index into the original and line
 * numbers stay honest. That matters more than it sounds: five v3 citations in
 * the repository are wrapped, including one that Prettier wrapped on its own
 * after the reference was written, and a line-by-line scan skips every one of
 * them without saying so.
 */
function flatten(text) {
  return text.replace(/\n[ \t]*\*?[ \t]*/g, (run) => ' '.repeat(run.length));
}

/** Every section cited in `text` under one specification's form, with offsets. */
function citationsIn(text, spec) {
  const found = [];
  for (const match of text.matchAll(spec.citation)) {
    for (let group = 1; group < match.length; group += 1) {
      if (match[group] !== undefined) found.push({ section: match[group], index: match.index });
    }
  }
  return found;
}

/** Blanks a span, keeping length, so a later pattern cannot match it again. */
function maskMatches(text, spec) {
  return text.replace(spec.citation, (match) => ' '.repeat(match.length));
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

// --- load both specifications ----------------------------------------------

for (const spec of SPECS) {
  let specText;
  try {
    specText = readFileSync(join(ROOT, spec.file), 'utf8');
  } catch {
    // Passing because a specification is missing would be the worst outcome:
    // a green check that proves nothing, on the one input it needs.
    fail(`cannot read ${spec.file}. The check cannot run, so it fails rather than passing.`);
  }

  spec.headings = new Map();
  for (const line of specText.split('\n')) {
    const match = HEADING.exec(line.trim());
    if (match) spec.headings.set(match[1], match[2].trim());
  }

  for (const [section, why] of spec.selfTest) {
    if (!spec.headings.has(section)) {
      fail(
        `self-test failed: §${section} (${why}) did not resolve, but it exists in ${spec.file}.\n` +
          `  The heading pattern is broken, not the citations. Fix HEADING before believing any\n` +
          `  report this script produces — a parser that misses a heading style reports correct\n` +
          `  citations as dangling.`,
      );
    }
  }
}

const specByKey = new Map(SPECS.map((spec) => [spec.key, spec]));

for (const [key, snippet, expected, why] of CITATION_SELF_TEST) {
  const spec = specByKey.get(key);
  const actual = citationsIn(flatten(snippet), spec).map((entry) => entry.section);
  if (actual.join(',') !== expected.join(',')) {
    fail(
      `self-test failed: the ${key} pattern read "${snippet.replace(/\n/g, '\\n')}"\n` +
        `  as [${actual.join(', ')}] rather than [${expected.join(', ')}] (${why}).\n` +
        `  The citation pattern is broken, not the docs. A pattern that stops matching a form\n` +
        `  reports a clean run over citations it never looked at.`,
    );
  }
}

// --- scan the repository ----------------------------------------------------

const specFiles = new Set(SPECS.map((spec) => spec.file));
const files = execFileSync('git', ['-C', ROOT, 'ls-files', '*.ts', '*.tsx', '*.md'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\n')
  .filter((file) => file && !specFiles.has(file));

const broken = [];
const totals = new Map(SPECS.map((spec) => [spec.key, 0]));

for (const file of files) {
  let text;
  try {
    text = readFileSync(join(ROOT, file), 'utf8');
  } catch {
    continue;
  }

  let remaining = flatten(text);
  // v3 first, then masked out. "Spec v3 section 3.2" cannot match the v2
  // pattern today, but that is a property of two regexes agreeing by
  // accident, and the day someone loosens either one a v3 citation would
  // start resolving against v2's headings and look fine doing it.
  for (const spec of SPECS) {
    for (const { section, index } of citationsIn(remaining, spec)) {
      totals.set(spec.key, totals.get(spec.key) + 1);
      if (!spec.headings.has(section)) {
        const line = lineAt(text, index);
        broken.push({
          file,
          line,
          spec,
          section,
          text: (text.split('\n')[line - 1] ?? '').trim().slice(0, 120),
        });
      }
    }
    remaining = maskMatches(remaining, spec);
  }
}

// Zero citations means a citation pattern stopped matching, not that the
// repository stopped citing the specification. Reporting "all clear" on an
// empty scan is the same evidence-free green as the missing-spec case, and
// it is checked per specification: v2's 1400 citations would otherwise hide
// v3's pattern going dark.
for (const spec of SPECS) {
  if (totals.get(spec.key) === 0) {
    fail(
      `found no ${spec.key} citations at all across the repository. ` +
        `The ${spec.key} pattern is broken, not the docs.`,
    );
  }
}

if (broken.length > 0) {
  console.error(`\ncheck-citations: ${broken.length} citation(s) resolve to no section.\n`);
  for (const item of broken) {
    console.error(`  ${item.file}:${item.line}  ${item.spec.key} §${item.section}`);
    console.error(`    ${item.text}`);
  }
  const hints = [...new Set(broken.map((item) => `${item.spec.file}:\n${item.spec.hint}`))];
  console.error(
    `\nBefore editing any citation above, confirm the section really is absent from\n` +
      `${hints.join('\n\n')}\n`,
  );
  process.exit(1);
}

console.log(
  `check-citations: ${SPECS.map((spec) => `${totals.get(spec.key)} ${spec.key}`).join(
    ' + ',
  )} citations across ${files.length} files all resolve against ${SPECS.map(
    (spec) => `${spec.headings.size} ${spec.key}`,
  ).join(' + ')} sections.`,
);
