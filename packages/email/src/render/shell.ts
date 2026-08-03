import type { RenderedEmail, TemplateName } from '../types.js';
import * as h from './html.js';
import { joinParts, type Part } from './parts.js';

/**
 * Assembles the sections of one email into a finished HTML document and its
 * plain-text alternative.
 *
 * The section order is the caller's, deliberately: spec section 26 fixes it
 * for the digests, and the ordering test reads it back out of the rendered
 * output rather than trusting this function.
 */
export function assemble<T extends TemplateName>(input: {
  template: T;
  subject: string;
  preheader: string;
  sections: readonly (Part | null)[];
}): RenderedEmail<T> {
  const body = joinParts(input.sections);
  return {
    template: input.template,
    subject: input.subject,
    html: h.document({ title: input.subject, preheader: input.preheader, body: body.html }),
    text: `${body.text}\n`,
  };
}
