import { asc, eq, isNull, and } from 'drizzle-orm';
import { industryTemplates } from '@luma/db';
import type { ApiContext } from './context.js';

/**
 * Industry templates (spec §11.2).
 *
 * Editorial content that pre-fills a profile during onboarding, maintained in
 * admin without a deploy. Readable without a session: it is shown on the
 * signup page, before the account exists, and it is the same content for
 * everyone. There is nothing here to authorise.
 */

export interface IndustryTemplateView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly sortOrder: number;
  readonly cpvInclude: readonly string[];
  readonly cpvExclude: readonly string[];
  readonly keywordsInclude: readonly string[];
  readonly keywordsExclude: readonly string[];
}

/**
 * The active templates in display order.
 *
 * Deliberately not paginated. There are five (spec §11.2), the onboarding
 * screen shows all of them at once, and a cursor over a five-row editorial
 * list would be ceremony rather than protection.
 */
export async function listIndustryTemplates(
  ctx: ApiContext,
): Promise<readonly IndustryTemplateView[]> {
  return ctx.db
    .select({
      id: industryTemplates.id,
      slug: industryTemplates.slug,
      name: industryTemplates.name,
      description: industryTemplates.description,
      sortOrder: industryTemplates.sortOrder,
      cpvInclude: industryTemplates.cpvInclude,
      cpvExclude: industryTemplates.cpvExclude,
      keywordsInclude: industryTemplates.keywordsInclude,
      keywordsExclude: industryTemplates.keywordsExclude,
    })
    .from(industryTemplates)
    .where(and(eq(industryTemplates.active, true), isNull(industryTemplates.deletedAt)))
    .orderBy(asc(industryTemplates.sortOrder), asc(industryTemplates.name));
}
