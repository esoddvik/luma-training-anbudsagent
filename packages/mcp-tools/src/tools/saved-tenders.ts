import { z } from 'zod';
import { defineWriteTool } from '../registry.js';
import { notFound } from '../errors.js';
import { toSavedStateView, type SavedStateView } from '../presentation.js';
import { sanitizeShortField } from '../untrusted.js';
import { idSchema } from '../schemas.js';
import { TENDER_NOT_FOUND_NB } from './shared.js';

/**
 * `save_tender` and `dismiss_tender` (spec section 32.1): the limited write
 * surface of the MVP.
 *
 * Spec section 40 sets the shape: a write tool must take an exact id, never a
 * filter, a query or a predicate. Both schemas are therefore a single
 * `tenderId` and nothing else. There is no "save everything matching X", and
 * adding one would mean adding a parameter that does not exist today.
 *
 * Neither tool takes a free-text reason. Spec section 15 puts structured
 * feedback verdicts on `submit_relevance_feedback`, which is a phase 7 tool
 * (section 32.2); accepting prose here would put conversation content into the
 * database, which spec section 9.5 forbids.
 *
 * The tender is read before the write so that an unknown id gets an honest
 * Norwegian not-found instead of a state row pointing at nothing.
 */

const inputSchema = z.object({ tenderId: idSchema });

export interface SavedTenderResult {
  readonly tenderId: string;
  readonly tittel: string;
  readonly kildelenke: string;
  readonly lagretstatus: SavedStateView;
  readonly bekreftelse: string;
}

export const saveTenderTool = defineWriteTool<typeof inputSchema, SavedTenderResult>({
  name: 'save_tender',
  title: 'Lagre anbud',
  description:
    'Lagrer én bestemt kunngjøring på brukerens liste. Krever den eksakte anbuds-id-en fra et tidligere svar. ' +
    'Verktøyet lagrer aldri flere anbud i én operasjon og tar ikke søk eller filtre.',
  requiredScopes: ['saved:write'],
  lumaContent: false,
  inputSchema,
  auditFacts: (input) => ({ targetTenderId: input.tenderId }),
  handler: async (input, context): Promise<SavedTenderResult> => {
    const tender = await context.ports.tenders.getTender(input.tenderId);
    if (tender === undefined) throw notFound(TENDER_NOT_FOUND_NB);

    const state = await context.ports.userTenderState.saveTender(
      context.caller.userId,
      tender.id,
      context.now,
    );

    return {
      tenderId: tender.id,
      tittel: sanitizeShortField(tender.title),
      kildelenke: tender.sourceUrl,
      lagretstatus: toSavedStateView(state),
      bekreftelse: 'Anbudet er lagret på listen din.',
    };
  },
});

export const dismissTenderTool = defineWriteTool<typeof inputSchema, SavedTenderResult>({
  name: 'dismiss_tender',
  title: 'Skjul anbud',
  description:
    'Merker én bestemt kunngjøring som ikke aktuell, slik at den ikke vises i treffene dine. Krever den eksakte ' +
    'anbuds-id-en. Endrer ikke varslingsprofilen din, og skjuler ikke andre anbud.',
  requiredScopes: ['saved:write'],
  lumaContent: false,
  inputSchema,
  auditFacts: (input) => ({ targetTenderId: input.tenderId }),
  handler: async (input, context): Promise<SavedTenderResult> => {
    const tender = await context.ports.tenders.getTender(input.tenderId);
    if (tender === undefined) throw notFound(TENDER_NOT_FOUND_NB);

    const state = await context.ports.userTenderState.dismissTender(
      context.caller.userId,
      tender.id,
      context.now,
    );

    return {
      tenderId: tender.id,
      tittel: sanitizeShortField(tender.title),
      kildelenke: tender.sourceUrl,
      lagretstatus: toSavedStateView(state),
      bekreftelse:
        'Anbudet er merket som ikke aktuelt og vises ikke i treffene dine. Varslingsprofilen er uendret.',
    };
  },
});
