import { FORBIDDEN_PAYMENT_TERMS, SCORE_DISCLAIMER_NB } from '@luma/domain';

/**
 * Phrasing that may not appear in anything this package sends.
 *
 * Three specification rules converge here:
 *
 * - Section 4.3: a relevance score is never a probability of winning, never a
 *   guarantee and never a bid/no-bid recommendation.
 * - Section 23.5 and section 42: no artificial scarcity, no false urgency, no
 *   exaggerated promise, and no claim that a course is necessary.
 * - Section 28.2: card payment vocabulary is absent from the MVP.
 *
 * This is not only a test fixture. `promotion.ts` runs the same rules over the
 * text of an `EditorialRecommendation` before rendering it, because
 * recommendations are admin-editable data (spec section 45) and data does not
 * go through code review. A recommendation that trips a rule is dropped, and
 * the digest renders without a promotion block rather than with a bad one.
 */

export type ProhibitedCategory =
  | 'win_probability'
  | 'guarantee'
  | 'obligation'
  | 'scarcity_or_urgency'
  | 'bid_recommendation'
  | 'payment_vocabulary';

export interface ProhibitedPhraseRule {
  readonly id: string;
  readonly category: ProhibitedCategory;
  /** Norwegian explanation, suitable for an admin validation message. */
  readonly explanation: string;
  readonly pattern: RegExp;
}

const WORD_CHARACTER = '\\p{L}\\p{N}';

/**
 * Builds a whole-word matcher.
 *
 * `\b` is ASCII-only in JavaScript, so `\bmå\b` matches inside "målgruppe":
 * `å` is not an ASCII word character, so a boundary appears in the middle of
 * the word. Unicode lookaround is the only correct option here.
 */
function wordPattern(source: string): RegExp {
  return new RegExp(`(?<![${WORD_CHARACTER}])(?:${source})(?![${WORD_CHARACTER}])`, 'giu');
}

function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const RULES: ProhibitedPhraseRule[] = [
  {
    id: 'win-probability',
    category: 'win_probability',
    explanation: 'Treffscore skal aldri fremstilles som vinnersannsynlighet (seksjon 4.3).',
    pattern: wordPattern(
      'vinnersannsynlighet|sannsynlighet(?:en)? for (?:å )?vinne|sjanse(?:n)? for (?:å )?vinne',
    ),
  },
  {
    id: 'win-percentage',
    category: 'win_probability',
    explanation: 'Prosenttall om å vinne er forbudt (seksjon 4.3).',
    pattern: /\d+\s*(?:%|prosent)\s*(?:sannsynlighet|sjanse|treffsikkerhet)/giu,
  },
  {
    id: 'guarantee',
    category: 'guarantee',
    explanation: 'Ingen garantier om treff, leveranse eller resultat (seksjon 4.3).',
    pattern: wordPattern('garanti|garantien|garantier|garantert|garanterte|garanterer'),
  },
  {
    id: 'obligation-second-person',
    category: 'obligation',
    explanation: '«Du må» er en forpliktende formulering tjenesten ikke skal bruke.',
    pattern: wordPattern('du må|dere må|må du|må dere|du er nødt til|dere er nødt til'),
  },
  {
    id: 'course-necessary',
    category: 'obligation',
    explanation: 'Et kurs skal aldri fremstilles som nødvendig (seksjon 23.5).',
    pattern: wordPattern(
      '(?:kurset|kurs|abonnementet|påfyll) er nødvendig|nødvendig for å (?:vinne|lykkes|delta|få treff)',
    ),
  },
  {
    id: 'scarcity',
    category: 'scarcity_or_urgency',
    explanation: 'Kunstig knapphet er forbudt (seksjon 23.5, «null hype»).',
    pattern: wordPattern(
      'kun i dag|bare i dag|siste sjanse|siste plasser|siste mulighet|f(?:å|a) plasser igjen|begrenset antall|snart utsolgt|utsolgt snart|n(?:å|a) eller aldri|kun \\d+ plasser|kun \\d+ igjen',
    ),
  },
  {
    id: 'urgency',
    category: 'scarcity_or_urgency',
    explanation: 'Falskt hastverk er forbudt (seksjon 23.5).',
    pattern: wordPattern(
      'det haster|hastverk|skynd deg|ikke g(?:å|a) glipp av|meld deg p(?:å|a) n(?:å|a)|tilbudet utl(?:ø|o)per|tilbudet g(?:å|a)r ut|handle n(?:å|a)',
    ),
  },
  {
    id: 'bid-recommendation',
    category: 'bid_recommendation',
    explanation:
      'Bid/no-bid er brukerens vurdering. Tjenesten anbefaler aldri å levere tilbud (seksjon 4.3).',
    pattern: wordPattern(
      'b(?:ø|o)r definitivt|dere b(?:ø|o)r levere|du b(?:ø|o)r levere|dette anbudet vil dere vinne|dette vinner dere',
    ),
  },
  ...FORBIDDEN_PAYMENT_TERMS.map((term) => ({
    id: `payment-${term.toLowerCase().replace(/\s+/g, '-')}`,
    category: 'payment_vocabulary' as const,
    explanation: `Betalingsbegrepet «${term}» skal ikke forekomme i MVP (seksjon 28.2).`,
    pattern: wordPattern(escapeLiteral(term)),
  })),
];

export const PROHIBITED_PHRASE_RULES: readonly ProhibitedPhraseRule[] = RULES;

/**
 * Approved sentences that name a forbidden concept in order to deny it.
 *
 * There is exactly one, and it is the score disclaimer from `@luma/domain`:
 * "Den sier ingenting om sannsynligheten for å vinne." A scanner that flags
 * the disclaimer would push us towards removing the disclaimer, which is the
 * opposite of what spec section 4.3 wants. Each entry is an exact,
 * domain-owned constant, so this list cannot be used to smuggle a paraphrase
 * past the rules.
 */
export const APPROVED_EXCEPTIONS: readonly string[] = [SCORE_DISCLAIMER_NB];

/**
 * Whitespace-flexible matchers for the approved exceptions.
 *
 * The plain-text part hard-wraps its paragraphs, so the disclaimer arrives
 * with a newline somewhere in the middle. Matching on literal whitespace
 * would then miss it in exactly the part of the email a reviewer reads first.
 */
const EXCEPTION_PATTERNS: readonly RegExp[] = APPROVED_EXCEPTIONS.map(
  (exception) => new RegExp(escapeLiteral(exception).replace(/\s+/g, '\\s+'), 'giu'),
);

/**
 * Blanks the approved exceptions, preserving length so that reported match
 * offsets still point at the right place in the original text.
 */
function maskApprovedExceptions(text: string): string {
  let masked = text;
  for (const pattern of EXCEPTION_PATTERNS) {
    pattern.lastIndex = 0;
    masked = masked.replace(pattern, (found) => ' '.repeat(found.length));
  }
  return masked;
}

export interface ProhibitedPhraseMatch {
  readonly ruleId: string;
  readonly category: ProhibitedCategory;
  readonly explanation: string;
  /** The exact text that matched, for a reviewable failure message. */
  readonly matched: string;
  readonly index: number;
}

/** Every prohibited phrase in `text`, in the order they appear. */
export function findProhibitedPhrases(text: string): ProhibitedPhraseMatch[] {
  const scannable = maskApprovedExceptions(text);
  const found: ProhibitedPhraseMatch[] = [];
  for (const rule of PROHIBITED_PHRASE_RULES) {
    // `lastIndex` is shared state on a global regex; reset before each scan.
    rule.pattern.lastIndex = 0;
    for (const match of scannable.matchAll(rule.pattern)) {
      found.push({
        ruleId: rule.id,
        category: rule.category,
        explanation: rule.explanation,
        matched: match[0],
        index: match.index,
      });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

export function containsProhibitedPhrase(text: string): boolean {
  return findProhibitedPhrases(text).length > 0;
}
