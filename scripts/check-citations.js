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
 * Read the SELF_TEST block before changing the heading pattern.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_FILE = 'Luma_Anbudsvarsling_IDE_Agent_Specification_v2.md';

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

/** One section of each heading style, checked before the report is trusted. */
const SELF_TEST = [
  ['12', 'top-level, period after the number'],
  ['11.2', 'subsection, no period after the number'],
  ['0', 'section zero, which sorts and parses unlike the rest'],
];

/** Citation forms in use. `§5 item 3` resolves on the `§5` and ignores the rest. */
const CITATION = /(?:§|spec(?:ification)?\s+section\s+)(\d+(?:\.\d+)?)/gi;

function fail(message) {
  console.error(`\ncheck-citations: ${message}\n`);
  process.exit(1);
}

let specText;
try {
  specText = readFileSync(join(ROOT, SPEC_FILE), 'utf8');
} catch {
  // Passing because the specification is missing would be the worst
  // outcome: a green check that proves nothing, on the one input it needs.
  fail(`cannot read ${SPEC_FILE}. The check cannot run, so it fails rather than passing.`);
}

const headings = new Map();
for (const line of specText.split('\n')) {
  const match = HEADING.exec(line.trim());
  if (match) headings.set(match[1], match[2].trim());
}

for (const [section, why] of SELF_TEST) {
  if (!headings.has(section)) {
    fail(
      `self-test failed: §${section} (${why}) did not resolve, but it exists in ${SPEC_FILE}.\n` +
        `  The heading pattern is broken, not the citations. Fix HEADING before believing any\n` +
        `  report this script produces — a parser that misses a heading style reports correct\n` +
        `  citations as dangling.`,
    );
  }
}

const files = execFileSync('git', ['-C', ROOT, 'ls-files', '*.ts', '*.tsx', '*.md'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\n')
  .filter((file) => file && file !== SPEC_FILE);

const broken = [];
let total = 0;

for (const file of files) {
  let text;
  try {
    text = readFileSync(join(ROOT, file), 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(CITATION)) {
      total += 1;
      if (!headings.has(match[1])) {
        broken.push({ file, line: index + 1, section: match[1], text: line.trim().slice(0, 120) });
      }
    }
  });
}

// Zero citations means the citation pattern stopped matching, not that the
// repository stopped citing the specification. Reporting "all clear" on an
// empty scan is the same evidence-free green as the missing-spec case.
if (total === 0) {
  fail('found no citations at all across the repository. CITATION is broken, not the docs.');
}

if (broken.length > 0) {
  console.error(`\ncheck-citations: ${broken.length} citation(s) resolve to no section.\n`);
  for (const item of broken) {
    console.error(`  ${item.file}:${item.line}  §${item.section}`);
    console.error(`    ${item.text}`);
  }
  console.error(
    `\nBefore editing any citation above, confirm the section really is absent from\n` +
      `${SPEC_FILE}. Numbered list items are a common false positive: §5 has four items\n` +
      `and no subsections, so a reference to its third item is written "§5 item 3", not "§5.3".\n`,
  );
  process.exit(1);
}

console.log(
  `check-citations: ${total} citations across ${files.length} files all resolve ` +
    `against ${headings.size} sections.`,
);
