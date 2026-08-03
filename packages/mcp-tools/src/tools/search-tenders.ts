import { z } from 'zod';
import { defineReadTool } from '../registry.js';
import {
  decodeCursor,
  limitNoteNb,
  nextCursor,
  resolveLimit,
  MAX_PAGE_LIMIT,
} from '../pagination.js';
import { toTenderView, type TenderView } from '../presentation.js';
import {
  cpvCodeInputSchema,
  cursorSchema,
  dateStringSchema,
  limitSchema,
  searchNoticeCategorySchema,
  searchStatusSchema,
} from '../schemas.js';
import type { TenderSearchCriteria } from '../ports.js';

/**
 * `search_tenders` (spec section 32.1).
 *
 * Plain search over the normalised notices. It does not score, does not read
 * the user's profile, and returns no commercial content of any kind — spec
 * section 32.1 says "Ingen markedsføringsinnhold" about this tool
 * specifically, and a test asserts it against the whole serialised result.
 *
 * It also never reaches for `get_luma_learning_resource`. Spec section 32.1
 * forbids a search tool from pulling Luma material in on its own; here that is
 * structural, since this module has no import path to the resource content and
 * a test walks the source to keep it that way.
 */

export const SEARCH_NOTE_NB =
  'Søket går mot normaliserte kunngjøringer fra Doffin. Treffene er ikke rangert mot varslingsprofilen din; ' +
  'bruk find_matching_tenders for det. Oppgi alltid kildelenken når du refererer til et anbud.';

const inputSchema = z.object({
  query: z
    .string({ error: 'må være tekst' })
    .min(2, { error: 'må ha minst to tegn' })
    .max(200, { error: 'kan ikke være lengre enn 200 tegn' })
    .optional(),
  cpvCodes: z
    .array(cpvCodeInputSchema)
    .max(50, { error: 'kan ikke ha mer enn 50 koder' })
    .optional(),
  regions: z
    .array(z.string({ error: 'må være tekst' }).min(1, { error: 'kan ikke være tom' }))
    .max(50, { error: 'kan ikke ha mer enn 50 områder' })
    .optional(),
  buyer: z
    .string({ error: 'må være tekst' })
    .min(2, { error: 'må ha minst to tegn' })
    .max(200, { error: 'kan ikke være lengre enn 200 tegn' })
    .optional(),
  noticeCategory: searchNoticeCategorySchema.optional(),
  publishedAfter: dateStringSchema.optional(),
  deadlineBefore: dateStringSchema.optional(),
  deadlineAfter: dateStringSchema.optional(),
  status: searchStatusSchema.optional(),
  limit: limitSchema,
  cursor: cursorSchema,
});

export interface SearchTendersResult {
  readonly antall: number;
  readonly anbud: readonly TenderView[];
  readonly nesteCursor: string | null;
  readonly merknad: string;
  readonly sideMerknad: string | null;
}

export const searchTendersTool = defineReadTool<typeof inputSchema, SearchTendersResult>({
  name: 'search_tenders',
  title: 'Søk i anbud',
  description:
    'Søk i norske offentlige kunngjøringer fra Doffin på fritekst, CPV-koder, område, oppdragsgiver, ' +
    'kunngjøringstype, dato og status. Returnerer normaliserte anbudsdata med kildelenke. ' +
    `Maks ${MAX_PAGE_LIMIT} treff per side; bruk nesteCursor for å hente flere. ` +
    'Verktøyet rangerer ikke mot varslingsprofilen — bruk find_matching_tenders til det.',
  requiredScopes: ['tenders:read'],
  lumaContent: false,
  inputSchema,
  auditFacts: (_input, result) => ({ resultCount: result?.anbud.length ?? null }),
  handler: async (input, context): Promise<SearchTendersResult> => {
    const limit = resolveLimit(input.limit);
    const offset = decodeCursor(input.cursor);

    const criteria: TenderSearchCriteria = {
      ...(input.query !== undefined ? { text: input.query } : {}),
      ...(input.cpvCodes !== undefined ? { cpvCodes: input.cpvCodes } : {}),
      ...(input.regions !== undefined ? { regions: input.regions } : {}),
      ...(input.buyer !== undefined ? { buyer: input.buyer } : {}),
      ...(input.noticeCategory !== undefined ? { noticeCategory: input.noticeCategory } : {}),
      ...(input.publishedAfter !== undefined ? { publishedAfter: input.publishedAfter } : {}),
      ...(input.deadlineBefore !== undefined ? { deadlineBefore: input.deadlineBefore } : {}),
      ...(input.deadlineAfter !== undefined ? { deadlineAfter: input.deadlineAfter } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };

    const page = await context.ports.tenders.searchTenders(criteria, { limit, offset });

    return {
      antall: page.items.length,
      anbud: page.items.map(toTenderView),
      nesteCursor: nextCursor(offset, page.items.length, page.hasMore),
      merknad: SEARCH_NOTE_NB,
      sideMerknad: limitNoteNb(input.limit),
    };
  },
});
