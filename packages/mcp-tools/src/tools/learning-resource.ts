import { z } from 'zod';
import { defineReadTool } from '../registry.js';
import { findResource, type LumaResource } from '../resources.js';
import { learningTopicSchema, type LearningTopic } from '../schemas.js';

/**
 * `get_luma_learning_resource` (spec section 32.1).
 *
 * The one explicit Luma tool on the surface, and the only place in this
 * package where Luma's own material may appear at all. Section 32.1 sets four
 * rules, and each has a counterpart here:
 *
 * 1. **It must not be called automatically by a search tool.** Enforced
 *    structurally: this is the only module that imports `../resources.js`, no
 *    other tool can reach the content, and a test walks the source to keep it
 *    that way. The tool description also tells the calling model to use it
 *    only on an explicit request for method help, and the server instructions
 *    (spec section 31) say the same thing.
 * 2. **Free resources come before paid offers.** Everything served today is
 *    free, and `pris` says so on every response.
 * 3. **Paid offers are labelled.** There are none in the MVP; when there are,
 *    they get `pris: 'betalt'` and appear after the free material.
 * 4. **Never claim a purchase is necessary.** `merknad` states the opposite in
 *    plain Norwegian.
 *
 * Three of the six topics in section 32.1 have no resource yet: `strategi`
 * (playbook phase 3), `kvalitetssikring` and `ai_sikkerhet`. They return an
 * honest "ikke tilgjengelig ennå" with the topics that do exist. Writing
 * course material to fill the gap is not this package's job, and inventing it
 * would be worse than the gap.
 */

/** Spec section 32.1 topic to `luma://` resource URI. */
export const TOPIC_TO_RESOURCE_URI: Readonly<Record<LearningTopic, string | null>> = {
  utvelgelse: 'luma://playbook/fase-1-utvelgelse',
  krav_og_oppdragsforstaelse: 'luma://playbook/fase-2-krav-og-oppdragsforstaelse',
  bid_no_bid: 'luma://methodology/bid-no-bid',
  /** Playbook phase 3. No resource written yet (spec section 33). */
  strategi: null,
  kvalitetssikring: null,
  ai_sikkerhet: null,
};

export const TOPIC_LABEL_NB: Readonly<Record<LearningTopic, string>> = {
  utvelgelse: 'Utvelgelse (playbook fase 1)',
  krav_og_oppdragsforstaelse: 'Krav- og oppdragsforståelse (playbook fase 2)',
  strategi: 'Strategi (playbook fase 3)',
  bid_no_bid: 'Bid/no-bid',
  kvalitetssikring: 'Kvalitetssikring',
  ai_sikkerhet: 'AI-sikkerhet',
};

export const FREE_RESOURCE_NOTE_NB =
  'Dette er en gratis ressurs fra Luma Training. Du trenger ikke kjøpe noe for å bruke tjenesten eller denne ' +
  'metodikken.';

export const UNAVAILABLE_NOTE_NB =
  'Denne ressursen er ikke tilgjengelig ennå. Vi later ikke som om vi har innhold vi ikke har skrevet.';

export interface LearningResourceResult {
  readonly emne: LearningTopic;
  readonly emneLabel: string;
  readonly tilgjengelig: boolean;
  readonly uri: string | null;
  readonly tittel: string | null;
  readonly beskrivelse: string | null;
  readonly innhold: string | null;
  /** `gratis` for everything in the MVP. A paid offer would say `betalt`. */
  readonly pris: 'gratis' | null;
  readonly merknad: string;
  /** Topics that do have material, offered when the asked-for one does not. */
  readonly tilgjengeligeEmner: readonly string[];
}

function availableTopics(): string[] {
  return (Object.keys(TOPIC_TO_RESOURCE_URI) as LearningTopic[]).filter(
    (topic) => TOPIC_TO_RESOURCE_URI[topic] !== null,
  );
}

function found(topic: LearningTopic, resource: LumaResource): LearningResourceResult {
  return {
    emne: topic,
    emneLabel: TOPIC_LABEL_NB[topic],
    tilgjengelig: true,
    uri: resource.uri,
    tittel: resource.title,
    beskrivelse: resource.description,
    innhold: resource.text,
    pris: 'gratis',
    merknad: FREE_RESOURCE_NOTE_NB,
    tilgjengeligeEmner: availableTopics(),
  };
}

function missing(topic: LearningTopic): LearningResourceResult {
  return {
    emne: topic,
    emneLabel: TOPIC_LABEL_NB[topic],
    tilgjengelig: false,
    uri: null,
    tittel: null,
    beskrivelse: null,
    innhold: null,
    pris: null,
    merknad: `${UNAVAILABLE_NOTE_NB} Emner som finnes nå: ${availableTopics().join(', ')}.`,
    tilgjengeligeEmner: availableTopics(),
  };
}

const inputSchema = z.object({ topic: learningTopicSchema });

export const getLumaLearningResourceTool = defineReadTool<
  typeof inputSchema,
  LearningResourceResult
>({
  name: 'get_luma_learning_resource',
  title: 'Hent faglig ressurs fra Luma',
  description:
    'Henter en gratis metodikkressurs fra Luma Training om et gitt emne i anbudsarbeid. ' +
    'Bruk verktøyet bare når brukeren uttrykkelig ber om faglig hjelp eller metodikk. ' +
    'Kall det aldri automatisk som del av et søk eller en match, og bland aldri innholdet inn i svar om et konkret anbud.',
  requiredScopes: ['tenders:read'],
  lumaContent: true,
  inputSchema,
  auditFacts: () => ({}),
  handler: async (input): Promise<LearningResourceResult> => {
    const uri = TOPIC_TO_RESOURCE_URI[input.topic];
    if (uri === null) return missing(input.topic);
    const resource = findResource(uri);
    return resource === undefined ? missing(input.topic) : found(input.topic, resource);
  },
});
