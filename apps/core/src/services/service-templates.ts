import { asc, eq, isNull, and } from 'drizzle-orm';
import { serviceTemplates } from '@luma/db';
import type { SupplierForm } from '@luma/domain';
import type { ApiContext } from './context.js';

/**
 * Service templates (spec §11.2, ADR-17).
 *
 * Editorial content that pre-fills a profile during onboarding, maintained in
 * admin without a deploy. Readable without a session: it is shown on the
 * signup page, before the account exists, and it is the same content for
 * everyone. There is nothing here to authorise.
 *
 * A template narrows the service side only. The response carries no buyer,
 * notice-type or procedure field, and adding one here would push a buyer-side
 * assumption straight into onboarding, where the user would never see it as a
 * choice they had made.
 */

export interface ServiceTemplateView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly sortOrder: number;
  /** The segmentation key, so a caller can group without inventing its own. */
  readonly serviceCategory: string;
  /** Shapes the onboarding guidance below. Never an input to matching (ADR-17). */
  readonly supplierForm: SupplierForm;
  readonly onboardingHint: string | null;
  readonly cpvInclude: readonly string[];
  readonly cpvExclude: readonly string[];
  readonly keywordsInclude: readonly string[];
  readonly keywordsExclude: readonly string[];
}

/**
 * The active templates in display order.
 *
 * Deliberately not paginated. There are eight (ADR-17), the onboarding screen
 * shows all of them at once, and a cursor over an eight-row editorial list
 * would be ceremony rather than protection.
 */
export async function listServiceTemplates(
  ctx: ApiContext,
): Promise<readonly ServiceTemplateView[]> {
  return ctx.db
    .select({
      id: serviceTemplates.id,
      slug: serviceTemplates.slug,
      name: serviceTemplates.name,
      description: serviceTemplates.description,
      sortOrder: serviceTemplates.sortOrder,
      serviceCategory: serviceTemplates.serviceCategory,
      supplierForm: serviceTemplates.supplierForm,
      onboardingHint: serviceTemplates.onboardingHint,
      cpvInclude: serviceTemplates.cpvInclude,
      cpvExclude: serviceTemplates.cpvExclude,
      keywordsInclude: serviceTemplates.keywordsInclude,
      keywordsExclude: serviceTemplates.keywordsExclude,
    })
    .from(serviceTemplates)
    .where(and(eq(serviceTemplates.active, true), isNull(serviceTemplates.deletedAt)))
    .orderBy(asc(serviceTemplates.sortOrder), asc(serviceTemplates.name));
}
