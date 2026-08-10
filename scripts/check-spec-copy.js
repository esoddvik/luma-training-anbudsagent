#!/usr/bin/env node
/**
 * Verifies that the tracked copy of the v3 specification has not been edited
 * in place.
 *
 * ## What this can prove, and what it cannot
 *
 * v3 is authored in Rable. The copy in this repository exists so that
 * `check-citations.js` has real headings to resolve against, which means the
 * repository now holds a second copy of a document it does not own — and two
 * copies of anything drift.
 *
 * Drift has two directions and they are not equally checkable:
 *
 *   1. **Someone edits the copy.** That is what happens by accident: the file
 *      is right there, in the editor, next to the code. This script catches
 *      it, in CI, on every push — the receipt in the file's header carries a
 *      hash of the body, and a hand edit breaks it.
 *
 *   2. **Someone edits the note.** The copy is then stale and every citation
 *      still resolves, against yesterday's headings. **This script cannot
 *      catch that, and neither can CI.** Rable is reachable only through an
 *      MCP connector authenticated in a Claude session; a GitHub runner has
 *      no credential for it and no HTTP API to call. Detecting that direction
 *      needs a session that can read the note — `docs/spec-sync.md` has the
 *      procedure and what it costs.
 *
 * Saying so here rather than only in the docs is deliberate. A check named
 * "spec copy" that ran green while the note had moved on would be read as
 * "the copy is current", which is the one thing it does not mean.
 *
 * Usage:
 *   node scripts/check-spec-copy.js            verify (CI)
 *   node scripts/check-spec-copy.js --record   rewrite the hash after a re-export
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every tracked copy of a document authored somewhere else. */
const COPIES = [
  {
    file: 'Luma_Anbudsvarsling_IDE_Agent_Specification_v3.md',
    source: 'the Rable note "Luma Anbudsvarsling IDE Agent Spec v3"',
  },
];

const RECEIPT = {
  note: /^\s*rable-note:\s*(\S+)\s*$/m,
  updated: /^\s*note-updated:\s*(\S+)\s*$/m,
  hash: /^(\s*body-sha256:\s*)([0-9a-f]{64})(\s*)$/m,
};

function fail(message) {
  console.error(`\ncheck-spec-copy: ${message}\n`);
  process.exit(1);
}

/**
 * Splits the file into its provenance header and the specification itself.
 *
 * The hash covers only what follows the header, so recording a new hash does
 * not change the thing being hashed — a receipt that covered itself could
 * never be written twice with the same result.
 */
function split(text, file) {
  const end = text.indexOf('-->');
  if (!text.startsWith('<!--') || end === -1) {
    fail(
      `${file} has no provenance header.\n` +
        `  Every tracked copy starts with one: where the document is authored, and the\n` +
        `  receipt this script checks. Without it nothing records that the file is a copy.`,
    );
  }
  return { header: text.slice(0, end + 3), body: text.slice(end + 3) };
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const record = process.argv.includes('--record');

for (const copy of COPIES) {
  const path = join(ROOT, copy.file);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    fail(`cannot read ${copy.file}. It is a tracked copy of ${copy.source} and must exist.`);
  }

  const { header, body } = split(text, copy.file);
  const actual = sha256(body);

  for (const [field, pattern] of [
    ['rable-note', RECEIPT.note],
    ['note-updated', RECEIPT.updated],
  ]) {
    if (!pattern.test(header)) {
      fail(`${copy.file} has a provenance header with no \`${field}:\` line.`);
    }
  }

  const recorded = RECEIPT.hash.exec(header);
  if (!recorded) {
    fail(
      `${copy.file} has a provenance header with no \`body-sha256:\` line, or one that is\n` +
        `  not 64 hex characters. Run \`node scripts/check-spec-copy.js --record\`.`,
    );
  }

  if (record) {
    const updated = header.replace(RECEIPT.hash, `$1${actual}$3`) + body;
    writeFileSync(path, updated);
    console.log(
      recorded[2] === actual
        ? `check-spec-copy: ${copy.file} unchanged, receipt already current (${actual.slice(0, 12)}…).`
        : `check-spec-copy: ${copy.file} receipt updated to ${actual.slice(0, 12)}… ` +
            `(was ${recorded[2].slice(0, 12)}…).`,
    );
    continue;
  }

  if (recorded[2] !== actual) {
    fail(
      `${copy.file} does not match its export receipt.\n` +
        `    recorded  ${recorded[2]}\n` +
        `    actual    ${actual}\n\n` +
        `  This file is a copy of ${copy.source}. Editing it here puts the two\n` +
        `  out of step silently: the citations would keep resolving, against headings that\n` +
        `  no longer match what the specification says.\n\n` +
        `  If you meant to change the specification, change the note and re-export.\n` +
        `  If you have just re-exported, record the new hash:\n` +
        `      node scripts/check-spec-copy.js --record`,
    );
  }

  console.log(
    `check-spec-copy: ${copy.file} matches its receipt (${actual.slice(0, 12)}…). ` +
      `Unedited here — not proof it matches the note; see docs/spec-sync.md.`,
  );
}
