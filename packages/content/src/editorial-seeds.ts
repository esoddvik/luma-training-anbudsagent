import type { LadderLevel, MarketingCategory, PromotionPlacement, RegionScope } from '@luma/domain';

/**
 * Seed editorial recommendations: Luma's own promotion (spec sections 23-24).
 *
 * Placed on the promotion ladder from spec 23.1, lowest threshold first:
 *   1 free professional content, the default for new users
 *   2 Påfyll, the paid newsletter and the main digest promotion
 *   3 NHO course and webinars
 *   4 the full-day course in Oslo, shown only after regional routing
 *
 * Two constraints this file is bound by. The full-day course carries
 * `regionScope: 'oslo_region'` because it is held physically in Oslo and spec
 * 23.2 forbids promoting it nationally. And nothing here may be phrased with
 * artificial scarcity, false urgency or a claim that a course is necessary
 * (spec 23.5) - Luma's brand is explicitly "praktisk og ærlig, null hype".
 *
 * These rows are editable in admin without a deploy. This is the launch state.
 */

export interface EditorialSeed {
  slug: string;
  title: string;
  description: string;
  url: string;
  placement: PromotionPlacement;
  relevanceTags: string[];
  ladderLevel: LadderLevel;
  regionScope: RegionScope;
  marketingCategory: MarketingCategory;
  isPaid: boolean;
}

export const EDITORIAL_SEEDS: readonly EditorialSeed[] = [
  {
    slug: 'guide-utvelgelse',
    title: 'Slik velger du hvilke anbud du skal bruke tid på',
    description:
      'En kort guide til fase 1 i anbudsarbeidet: hvordan du siler bort konkurranser du uansett ikke vinner, og bruker tiden på dem du kan ta.',
    url: 'https://luma-training.com/artikler/utvelgelse',
    placement: 'digest_footer',
    relevanceTags: ['utvelgelse', 'nybegynner'],
    ladderLevel: 1,
    regionScope: 'national',
    marketingCategory: 'free_guide',
    isPaid: false,
  },
  {
    slug: 'guide-kravforstaelse',
    title: 'Les konkurransegrunnlaget riktig første gang',
    description:
      'Hvordan du finner kvalifikasjonskrav og tildelingskriterier raskt, og hva du bør notere før du bestemmer deg for å levere.',
    url: 'https://luma-training.com/artikler/kravforstaelse',
    placement: 'digest_footer',
    relevanceTags: ['krav', 'tildelingskriterier'],
    ladderLevel: 1,
    regionScope: 'national',
    marketingCategory: 'article',
    isPaid: false,
  },
  {
    slug: 'paafyll',
    title: 'Påfyll',
    description:
      'Månedlig fagbrev om tilbudsarbeid og praktisk bruk av AI. Konkrete grep du kan ta i bruk i neste konkurranse. 395 kroner måneden eks. mva.',
    url: 'https://luma-training.com/paafyll',
    placement: 'digest_footer',
    relevanceTags: ['fagbrev', 'ai', 'tilbudsarbeid'],
    ladderLevel: 2,
    regionScope: 'national',
    marketingCategory: 'paid_newsletter',
    isPaid: true,
  },
  {
    slug: 'webinar-ai-tilbudsarbeid',
    title: 'Webinar: AI i tilbudsarbeid',
    description:
      'Gratis nettmøte der vi går gjennom hvordan du bruker AI som en assistent i tilbudsarbeidet, uten å gi fra deg kontrollen.',
    url: 'https://luma-training.com/webinar',
    placement: 'digest_footer',
    relevanceTags: ['ai', 'webinar'],
    ladderLevel: 3,
    regionScope: 'national',
    marketingCategory: 'webinar',
    isPaid: false,
  },
  {
    slug: 'nho-kurs',
    title: 'NHO-kurs i anbudsarbeid',
    // NHO sets and publishes the price for this one, not Luma, so the copy
    // points at their page rather than stating a number we do not control.
    description:
      'Hybridkurs i regi av NHO. Samme metodikk som heldagskurset, tilgjengelig fra hele landet. Pris og påmelding finner du hos NHO.',
    url: 'https://luma-training.com/nho-kurs',
    placement: 'digest_footer',
    relevanceTags: ['kurs', 'nho'],
    ladderLevel: 3,
    regionScope: 'national',
    marketingCategory: 'nho_course',
    isPaid: true,
  },
  {
    slug: 'heldagskurs-vinn-flere-anbud',
    title: 'Vinn flere anbud med AI',
    description:
      'Heldagskurs i Oslo. Du rigger din egen arbeidsflyt for utvelgelse, kravforståelse og kvalitetssikring, og går hjem med den ferdig satt opp. 14 500 kroner eks. mva.',
    url: 'https://luma-training.com/kurs/vinn-flere-anbud-med-ai',
    placement: 'digest_footer',
    relevanceTags: ['kurs', 'ai', 'oslo'],
    ladderLevel: 4,
    // Held physically in Oslo. Spec 23.2: never promoted nationally.
    regionScope: 'oslo_region',
    marketingCategory: 'course',
    isPaid: true,
  },
  {
    slug: 'koble-til-ai',
    title: 'Bruk anbudsvarslene i ditt eget AI-verktøy',
    description:
      'Koble varslingsprofilen til ChatGPT eller Claude, og undersøk treffene der du allerede jobber.',
    url: 'https://luma-training.com/anbudsvarsling/ai-verktoy',
    placement: 'empty_state',
    relevanceTags: ['mcp', 'ai'],
    ladderLevel: 1,
    regionScope: 'national',
    marketingCategory: 'tool',
    isPaid: false,
  },
];

/**
 * Wording that must never appear in a promotion (spec 23.5 and 42).
 *
 * Checked by a test rather than left to review, because this is precisely the
 * kind of copy that drifts one harmless-looking edit at a time.
 */
export const FORBIDDEN_PROMOTION_PHRASES: readonly RegExp[] = [
  /siste sjanse/i,
  /kun i dag/i,
  /f[åa] kun \d+ plasser igjen/i,
  /haster/i,
  /g[åa]r glipp av/i,
  /du m[åa] ha/i,
  /n[øo]dvendig for [åa] vinne/i,
  /garantert/i,
  /revolusjoner/i,
];
