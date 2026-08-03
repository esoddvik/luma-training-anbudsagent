import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { containsPhrase } from '@luma/domain';
import { findForbiddenScorePhrasing } from '@luma/matching';
import { CLEANING_FRAMEWORK } from '@luma/matching/testing';
import { describe, expect, it } from 'vitest';
import { createInMemoryPorts } from '../testing/in-memory-ports.js';
import { CALLER_A, DEFAULT_SEED, FIXED_NOW, PROFILE_A_CLEANING } from '../testing/fixtures.js';
import { invokeTool, LUMA_TOOLS } from './index.js';

/**
 * Spec section 32.1: `search_tenders` carries no marketing content, and
 * `get_luma_learning_resource` is the one explicit Luma tool. Spec section 4.1
 * generalises it: a tender alert must still be useful with every marketing
 * element removed. ADR-0006 makes the separation a property of the build.
 *
 * This file is the executable form of that promise, in two halves: no
 * promotional string reaches a caller through any tool but the one, and no
 * tool but the one can even reach the Luma content.
 *
 * This test has been verified to be able to fail. Appending the sentence
 * "Tips: meld deg på Lumas kurs i anbudsskriving for å vinne flere av disse."
 * to `SEARCH_NOTE_NB` in `search-tenders.ts` turned all three `search_tenders`
 * cases red with `expected [ 'kurs', 'meld deg på' ] to deeply equal []`. The
 * sentence was then removed and the suite went green again.
 *
 * It has also caught a real leak once already: an earlier draft of
 * `SUGGESTION_NOTE_NB` and of the missing-scope message named the product by
 * brand inside answers about tenders. Both were reworded.
 */

/**
 * Words that would betray a commercial motive in a tender answer.
 *
 * Matched whole-word through the domain's `containsPhrase`, which also folds
 * æ/ø/å. Substring matching would be useless here: "konkurranse" contains
 * neither of these, but a naive `includes('kurs')` on "kurset" versus
 * "konkurransegrunnlaget" is exactly the kind of false result that gets a
 * guard rail switched off.
 */
const PROMOTIONAL_PHRASES_NB: readonly string[] = [
  'luma',
  'luma training',
  'kurs',
  'kurset',
  'kursene',
  'kursdag',
  'webinar',
  'påfyll',
  'påmelding',
  'meld deg på',
  'nyhetsbrev',
  'abonnement',
  'rabatt',
  'kampanje',
  'bestill',
  'kjøp',
  'les mer om',
  'anbefalt lesing',
  'gratis e-bok',
];

const READ_ONLY_CALLS: ReadonlyArray<{ name: string; input: unknown }> = [
  { name: 'search_tenders', input: { query: 'renhold' } },
  { name: 'search_tenders', input: { noticeCategory: 'planned' } },
  { name: 'search_tenders', input: {} },
  { name: 'find_matching_tenders', input: { minimumScore: 0 } },
  { name: 'get_tender', input: { tenderId: CLEANING_FRAMEWORK.id } },
  {
    name: 'explain_tender_match',
    input: { tenderId: CLEANING_FRAMEWORK.id, profileId: PROFILE_A_CLEANING.id },
  },
  { name: 'list_alert_profiles', input: {} },
  { name: 'get_alert_profile', input: { profileId: PROFILE_A_CLEANING.id } },
  { name: 'save_tender', input: { tenderId: CLEANING_FRAMEWORK.id } },
  { name: 'dismiss_tender', input: { tenderId: CLEANING_FRAMEWORK.id } },
];

function foundPhrases(text: string): string[] {
  return PROMOTIONAL_PHRASES_NB.filter((phrase) => containsPhrase(text, phrase));
}

describe('the promotional-phrase guard itself', () => {
  it('finds a promotional sentence when one is present', () => {
    // Without this the suite could pass because the check does nothing.
    expect(foundPhrases('Meld deg på Lumas kurs i anbudsskriving.')).toContain('kurs');
  });

  it('does not fire on ordinary procurement Norwegian', () => {
    expect(
      foundPhrases(
        'Konkurransegrunnlaget beskriver kravspesifikasjonen og tildelingskriteriene i konkurransen.',
      ),
    ).toEqual([]);
  });
});

describe('no tool but get_luma_learning_resource returns marketing', () => {
  it.each(READ_ONLY_CALLS)('$name returns no promotional string', async ({ name, input }) => {
    const ports = createInMemoryPorts(DEFAULT_SEED);
    const outcome = await invokeTool(name, input, { caller: CALLER_A, ports, now: FIXED_NOW });

    expect(outcome.ok, `${name} should succeed`).toBe(true);
    if (!outcome.ok) return;

    const serialised = JSON.stringify(outcome.result);
    expect(foundPhrases(serialised)).toEqual([]);
  });

  it('describes every tool but the Luma one without promotional wording', () => {
    // Tool titles and descriptions are read by the model on every connection,
    // which makes them the easiest place for a sales line to end up.
    for (const tool of LUMA_TOOLS) {
      if (tool.lumaContent) continue;
      expect(foundPhrases(`${tool.title} ${tool.description}`), tool.name).toEqual([]);
    }
  });

  it('never phrases a score as a win probability', async () => {
    const ports = createInMemoryPorts(DEFAULT_SEED);
    const outcome = await invokeTool(
      'find_matching_tenders',
      { minimumScore: 0 },
      { caller: CALLER_A, ports, now: FIXED_NOW },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(findForbiddenScorePhrasing(JSON.stringify(outcome.result))).toEqual([]);
  });
});

describe('only one module can reach the Luma content', () => {
  const toolsDir = dirname(fileURLToPath(import.meta.url));

  it('is imported by get_luma_learning_resource and by no other tool', () => {
    // Spec 32.1: a search tool must not pull Luma material in on its own. The
    // import edge is what would make that possible, so the edge is what is
    // asserted, rather than the behaviour of today's handlers.
    const importers = readdirSync(toolsDir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter((file) => readFileSync(join(toolsDir, file), 'utf8').includes('resources.js'));

    expect(importers).toEqual(['learning-resource.ts']);
  });

  it('has no other tool naming a Luma resource URI', () => {
    const offenders = readdirSync(toolsDir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter((file) => file !== 'learning-resource.ts')
      .filter((file) => readFileSync(join(toolsDir, file), 'utf8').includes('luma://'));

    expect(offenders).toEqual([]);
  });
});
