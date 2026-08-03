import { z } from 'zod';
import { cpvCodeSchema } from './tender.js';

/**
 * The alert profile (spec section 11.1): the user's statement of which public
 * tenders they want to hear about. It is the only user-supplied input to
 * matching. Nothing commercial appears here, by design (ADR-6).
 */

export const alertFrequencySchema = z.enum(['immediate', 'daily', 'weekly']);
export type AlertFrequency = z.infer<typeof alertFrequencySchema>;

/** Free-text criteria are bounded so a profile cannot become a denial of service. */
export const LIMITS = {
  maxCpvCodes: 100,
  maxKeywords: 100,
  maxKeywordLength: 120,
  maxRegions: 50,
  maxBuyers: 100,
  maxProfileNameLength: 120,
} as const;

const keyword = z.string().trim().min(2).max(LIMITS.maxKeywordLength);

/**
 * The unrefined shape. Kept separate so both the full schema and the
 * user-submittable input schema can be derived from one definition.
 */
const alertProfileShape = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  name: z.string().trim().min(1).max(LIMITS.maxProfileNameLength),
  description: z.string().max(2000).optional(),
  active: z.boolean(),
  /** Recorded for analytics only; it must not influence matching (spec 11.2). */
  industryTemplateId: z.uuid().optional(),

  cpvInclude: z.array(cpvCodeSchema).max(LIMITS.maxCpvCodes),
  cpvExclude: z.array(cpvCodeSchema).max(LIMITS.maxCpvCodes),
  keywordsInclude: z.array(keyword).max(LIMITS.maxKeywords),
  keywordsExclude: z.array(keyword).max(LIMITS.maxKeywords),
  regionsInclude: z.array(z.string().trim().min(1)).max(LIMITS.maxRegions),
  municipalitiesInclude: z.array(z.string().trim().min(1)).max(LIMITS.maxRegions),
  buyerInclude: z.array(z.string().trim().min(1)).max(LIMITS.maxBuyers),
  buyerExclude: z.array(z.string().trim().min(1)).max(LIMITS.maxBuyers),

  noticeTypes: z.array(z.string()),
  /** Spec section 33 of the change log: planned procurements are on by default. */
  includePlannedProcurements: z.boolean().default(true),
  procedureTypes: z.array(z.string()),

  estimatedValueMinNok: z.number().nonnegative().optional(),
  estimatedValueMaxNok: z.number().nonnegative().optional(),
  /** Filters out competitions whose remaining time is too short to bid on. */
  deadlineMinimumDays: z.number().int().nonnegative().max(365).optional(),

  frequency: alertFrequencySchema,
  digestHourLocal: z.number().int().min(0).max(23),
  timezone: z.string().min(1),
  minimumMatchScore: z.number().min(0).max(100),

  createdAt: z.date(),
  updatedAt: z.date(),
});

/** A value floor above its ceiling would silently exclude every tender. */
const valueRangeIsOrdered = (profile: {
  estimatedValueMinNok?: number | undefined;
  estimatedValueMaxNok?: number | undefined;
}) =>
  profile.estimatedValueMinNok === undefined ||
  profile.estimatedValueMaxNok === undefined ||
  profile.estimatedValueMinNok <= profile.estimatedValueMaxNok;

/** Rebuilt per call: Zod mutates the path array it is handed. */
const valueRangeError = () => ({
  message: 'estimatedValueMinNok must not exceed estimatedValueMaxNok',
  path: ['estimatedValueMinNok'],
});

export const alertProfileSchema = alertProfileShape.refine(valueRangeIsOrdered, valueRangeError());

export type AlertProfile = z.infer<typeof alertProfileSchema>;

/** The subset a user may submit; the server owns ids and timestamps. */
export const alertProfileInputSchema = alertProfileShape
  .omit({ id: true, userId: true, createdAt: true, updatedAt: true })
  .refine(valueRangeIsOrdered, valueRangeError());

export type AlertProfileInput = z.infer<typeof alertProfileInputSchema>;

/**
 * Industry templates (spec section 11.2): editorial content that pre-fills a
 * profile during onboarding. Maintained in admin without a deploy, and
 * quality-assured by Luma before launch.
 */
export const industryTemplateSchema = z.object({
  id: z.uuid(),
  /** Stable machine key, e.g. `bygg-og-anlegg`. */
  slug: z.string().regex(/^[a-z0-9-]+$/),
  /** Norwegian display name shown during onboarding. */
  name: z.string().min(1),
  description: z.string().min(1),
  sortOrder: z.number().int(),
  active: z.boolean(),

  cpvInclude: z.array(cpvCodeSchema),
  cpvExclude: z.array(cpvCodeSchema),
  keywordsInclude: z.array(keyword),
  keywordsExclude: z.array(keyword),

  createdAt: z.date(),
  updatedAt: z.date(),
});

export type IndustryTemplate = z.infer<typeof industryTemplateSchema>;
