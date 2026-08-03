'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, isNull, type ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import * as schema from '@luma/db/schema';
import { alertFrequencySchema, normalizeCpv, normalizeSearchText } from '@luma/domain';
import { z } from 'zod';
import { getWebDb, type Database } from '../db';
import { requireUser } from '../session';
import { withMessage } from './messages';

/**
 * Creating, editing, pausing and deleting alert profiles (spec section 11).
 *
 * Spec section 4.4 lists what the user must be able to do to a profile — edit
 * it, pause it, exclude keywords, buyers and CPV codes, change the frequency,
 * delete it — and every one of those is an action in this file. Nothing else
 * writes to `alert_profiles`: the matcher reads it, the editorial layer never
 * touches it (ADR-6).
 *
 * Criteria are replaced wholesale on save rather than diffed. The four
 * criterion tables have composite primary keys, so a delete-then-insert inside
 * one transaction is both simpler and correct, and a half-applied edit is
 * impossible.
 */

/** Comma- or newline-separated free text, as the form presents it. */
const listField = z
  .string()
  .optional()
  .transform((raw) =>
    (raw ?? '')
      .split(/[\n,;]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  );

const optionalNumber = z
  .string()
  .optional()
  .transform((raw) => {
    if (raw === undefined) return undefined;
    // \s covers the non-breaking space that a Norwegian thousands separator
    // and a copy-paste from a spreadsheet both produce.
    const cleaned = raw.replace(/\s/gu, '').replace(',', '.');
    if (cleaned.length === 0) return undefined;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  });

const profileForm = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    cpvInclude: listField,
    cpvExclude: listField,
    keywordsInclude: listField,
    keywordsExclude: listField,
    regionsInclude: listField,
    buyerInclude: listField,
    buyerExclude: listField,
    includePlannedProcurements: z.union([z.literal('on'), z.literal('')]).optional(),
    estimatedValueMinNok: optionalNumber,
    estimatedValueMaxNok: optionalNumber,
    deadlineMinimumDays: optionalNumber,
    frequency: alertFrequencySchema,
    digestHourLocal: z.coerce.number().int().min(0).max(23),
    minimumMatchScore: z.coerce.number().min(0).max(100),
    industryTemplateId: z.uuid().optional(),
  })
  .refine(
    (value) =>
      value.estimatedValueMinNok === undefined ||
      value.estimatedValueMaxNok === undefined ||
      value.estimatedValueMinNok <= value.estimatedValueMaxNok,
    { message: 'Minsteverdien kan ikke være høyere enn maksverdien.' },
  );

type ProfileForm = z.infer<typeof profileForm>;

function readProfileForm(formData: FormData): ProfileForm | null {
  const value = (key: string): string | undefined => {
    const raw = formData.get(key);
    return typeof raw === 'string' ? raw : undefined;
  };
  const parsed = profileForm.safeParse({
    name: value('name') ?? '',
    ...(value('description') && value('description')!.trim().length > 0
      ? { description: value('description') }
      : {}),
    cpvInclude: value('cpvInclude'),
    cpvExclude: value('cpvExclude'),
    keywordsInclude: value('keywordsInclude'),
    keywordsExclude: value('keywordsExclude'),
    regionsInclude: value('regionsInclude'),
    buyerInclude: value('buyerInclude'),
    buyerExclude: value('buyerExclude'),
    includePlannedProcurements: value('includePlannedProcurements') === 'on' ? 'on' : '',
    estimatedValueMinNok: value('estimatedValueMinNok'),
    estimatedValueMaxNok: value('estimatedValueMaxNok'),
    deadlineMinimumDays: value('deadlineMinimumDays'),
    frequency: value('frequency') ?? 'daily',
    digestHourLocal: value('digestHourLocal') ?? '7',
    minimumMatchScore: value('minimumMatchScore') ?? '0',
    ...(value('industryTemplateId') && value('industryTemplateId')!.length > 0
      ? { industryTemplateId: value('industryTemplateId') }
      : {}),
  });
  return parsed.success ? parsed.data : null;
}

export async function createProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const form = readProfileForm(formData);
  if (!form) redirect(withMessage('/varsler/ny', 'ugyldig'));

  const db = getWebDb();
  const profileId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.alertProfiles)
      .values({
        userId: user.id,
        name: form.name,
        description: form.description ?? null,
        // A new profile starts paused. Spec section 9.1 has the user preview
        // the matches (step 11) and adjust (step 12) *before* activating
        // (step 13), so activating on creation would send the first digest
        // from criteria nobody has looked at yet.
        active: false,
        industryTemplateId: form.industryTemplateId ?? null,
        includePlannedProcurements: form.includePlannedProcurements === 'on',
        estimatedValueMinNok: form.estimatedValueMinNok ?? null,
        estimatedValueMaxNok: form.estimatedValueMaxNok ?? null,
        deadlineMinimumDays: form.deadlineMinimumDays ?? null,
        frequency: form.frequency,
        digestHourLocal: form.digestHourLocal,
        minimumMatchScore: form.minimumMatchScore,
      })
      .returning({ id: schema.alertProfiles.id });

    if (!created) throw new Error('Kunne ikke opprette varslingsprofilen.');
    await writeCriteria(tx, created.id, form);
    return created.id;
  });

  revalidatePath('/varsler');
  redirect(withMessage(`/varsler/${profileId}`, 'profil-opprettet'));
}

export async function updateProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const idParsed = z.uuid().safeParse(formData.get('profileId'));
  if (!idParsed.success) redirect(withMessage('/varsler', 'ugyldig'));

  const form = readProfileForm(formData);
  if (!form) redirect(withMessage(`/varsler/${idParsed.data}`, 'ugyldig'));

  const db = getWebDb();
  const owned = await ownedProfile(db, idParsed.data, user.id);
  if (!owned) redirect(withMessage('/varsler', 'ukjent-profil'));

  await db.transaction(async (tx) => {
    await tx
      .update(schema.alertProfiles)
      .set({
        name: form.name,
        description: form.description ?? null,
        includePlannedProcurements: form.includePlannedProcurements === 'on',
        estimatedValueMinNok: form.estimatedValueMinNok ?? null,
        estimatedValueMaxNok: form.estimatedValueMaxNok ?? null,
        deadlineMinimumDays: form.deadlineMinimumDays ?? null,
        frequency: form.frequency,
        digestHourLocal: form.digestHourLocal,
        minimumMatchScore: form.minimumMatchScore,
        updatedAt: new Date(),
      })
      .where(eq(schema.alertProfiles.id, idParsed.data));

    await clearCriteria(tx, idParsed.data);
    await writeCriteria(tx, idParsed.data, form);
  });

  revalidatePath('/varsler');
  revalidatePath(`/varsler/${idParsed.data}`);
  revalidatePath('/oversikt');
  redirect(withMessage(`/varsler/${idParsed.data}`, 'profil-lagret'));
}

/** Pauses or resumes a profile (spec section 4.4). Never deletes anything. */
export async function toggleProfileActiveAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const idParsed = z.uuid().safeParse(formData.get('profileId'));
  if (!idParsed.success) redirect(withMessage('/varsler', 'ugyldig'));

  const db = getWebDb();
  const owned = await ownedProfile(db, idParsed.data, user.id);
  if (!owned) redirect(withMessage('/varsler', 'ukjent-profil'));

  const next = !owned.active;
  await db
    .update(schema.alertProfiles)
    .set({ active: next, updatedAt: new Date() })
    .where(eq(schema.alertProfiles.id, idParsed.data));

  revalidatePath('/varsler');
  revalidatePath(`/varsler/${idParsed.data}`);
  redirect(withMessage(`/varsler/${idParsed.data}`, next ? 'profil-startet' : 'profil-pauset'));
}

/**
 * Deletes a profile.
 *
 * A soft delete: notification history and relevance feedback point at the
 * profile, and hard-deleting it would rewrite what was already sent. The row
 * disappears from every product surface immediately, and the account-deletion
 * path is what removes it for real.
 */
export async function deleteProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const idParsed = z.uuid().safeParse(formData.get('profileId'));
  if (!idParsed.success) redirect(withMessage('/varsler', 'ugyldig'));

  const db = getWebDb();
  const owned = await ownedProfile(db, idParsed.data, user.id);
  if (!owned) redirect(withMessage('/varsler', 'ukjent-profil'));

  await db
    .update(schema.alertProfiles)
    .set({ deletedAt: new Date(), active: false, updatedAt: new Date() })
    .where(eq(schema.alertProfiles.id, idParsed.data));

  revalidatePath('/varsler');
  revalidatePath('/oversikt');
  redirect(withMessage('/varsler', 'profil-slettet'));
}

// --- helpers ---------------------------------------------------------------

async function ownedProfile(
  db: Database,
  profileId: string,
  userId: string,
): Promise<{ id: string; active: boolean } | null> {
  const [row] = await db
    .select({ id: schema.alertProfiles.id, active: schema.alertProfiles.active })
    .from(schema.alertProfiles)
    .where(
      and(
        eq(schema.alertProfiles.id, profileId),
        eq(schema.alertProfiles.userId, userId),
        isNull(schema.alertProfiles.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The transaction handle Drizzle hands to a `db.transaction` callback.
 *
 * Spelled out rather than derived with `Parameters<...>`: `transaction` is
 * generic in its return type, and inferring through it collapses to `never`.
 */
type Tx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

async function clearCriteria(tx: Tx, profileId: string): Promise<void> {
  await tx
    .delete(schema.alertProfileCpvCodes)
    .where(eq(schema.alertProfileCpvCodes.alertProfileId, profileId));
  await tx
    .delete(schema.alertProfileKeywords)
    .where(eq(schema.alertProfileKeywords.alertProfileId, profileId));
  await tx
    .delete(schema.alertProfileGeographies)
    .where(eq(schema.alertProfileGeographies.alertProfileId, profileId));
  await tx
    .delete(schema.alertProfileBuyers)
    .where(eq(schema.alertProfileBuyers.alertProfileId, profileId));
}

async function writeCriteria(tx: Tx, profileId: string, form: ProfileForm): Promise<void> {
  const cpvRows = [
    ...toCpvRows(profileId, form.cpvInclude, 'include'),
    ...toCpvRows(profileId, form.cpvExclude, 'exclude'),
  ];
  if (cpvRows.length > 0) {
    await tx.insert(schema.alertProfileCpvCodes).values(cpvRows).onConflictDoNothing();
  }

  const keywordRows = [
    ...toKeywordRows(profileId, form.keywordsInclude, 'include'),
    ...toKeywordRows(profileId, form.keywordsExclude, 'exclude'),
  ];
  if (keywordRows.length > 0) {
    await tx.insert(schema.alertProfileKeywords).values(keywordRows).onConflictDoNothing();
  }

  const regionRows = dedupe(form.regionsInclude).map((code) => ({
    alertProfileId: profileId,
    kind: 'region' as const,
    code,
  }));
  if (regionRows.length > 0) {
    await tx.insert(schema.alertProfileGeographies).values(regionRows).onConflictDoNothing();
  }

  const buyerRows = [
    ...toBuyerRows(profileId, form.buyerInclude, 'include'),
    ...toBuyerRows(profileId, form.buyerExclude, 'exclude'),
  ];
  if (buyerRows.length > 0) {
    await tx.insert(schema.alertProfileBuyers).values(buyerRows).onConflictDoNothing();
  }
}

/** Invalid CPV entries are dropped rather than stored: an eight-digit column
 *  would reject them at insert and fail the whole save for one typo. */
function toCpvRows(profileId: string, values: readonly string[], mode: 'include' | 'exclude') {
  return dedupe(
    values.map((value) => normalizeCpv(value)).filter((value): value is string => value !== null),
  ).map((cpvCode) => ({ alertProfileId: profileId, mode, cpvCode }));
}

function toKeywordRows(profileId: string, values: readonly string[], mode: 'include' | 'exclude') {
  const seen = new Set<string>();
  const rows: Array<{
    alertProfileId: string;
    mode: 'include' | 'exclude';
    keyword: string;
    normalizedKeyword: string;
  }> = [];
  for (const keyword of values) {
    if (keyword.length < 2) continue;
    // The normalised form is supplied by the writer on purpose: the folding
    // rule for æ, ø and å lives in TypeScript, where it is tested, rather than
    // being reimplemented in SQL.
    const normalizedKeyword = normalizeSearchText(keyword);
    if (normalizedKeyword.length === 0 || seen.has(normalizedKeyword)) continue;
    seen.add(normalizedKeyword);
    rows.push({ alertProfileId: profileId, mode, keyword, normalizedKeyword });
  }
  return rows;
}

function toBuyerRows(profileId: string, values: readonly string[], mode: 'include' | 'exclude') {
  const seen = new Set<string>();
  const rows: Array<{
    alertProfileId: string;
    mode: 'include' | 'exclude';
    buyerName: string;
    normalizedBuyerName: string;
  }> = [];
  for (const buyerName of values) {
    const normalizedBuyerName = normalizeSearchText(buyerName);
    if (normalizedBuyerName.length === 0 || seen.has(normalizedBuyerName)) continue;
    seen.add(normalizedBuyerName);
    rows.push({ alertProfileId: profileId, mode, buyerName, normalizedBuyerName });
  }
  return rows;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}
