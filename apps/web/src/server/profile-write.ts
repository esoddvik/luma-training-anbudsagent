import { eq, type ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import * as schema from '@luma/db/schema';
import { normalizeCpv, normalizeSearchText } from '@luma/domain';

/**
 * Writing a profile's criteria into the four criterion tables.
 *
 * Extracted from `actions/profile-actions.ts` because a profile is now created
 * from two places: the edit form, and the confirmation of a search-first signup
 * (IDE Agent Spec v3, section 3.1), where the criteria arrive as a draft that
 * an anonymous visitor assembled rather than as a submitted form.
 *
 * The extraction is deliberately of the *writing*, not of the parsing. Form
 * parsing stays with the form; what both callers share is the rule that a
 * keyword's normalised form is computed in TypeScript rather than in SQL, that
 * an unparseable CPV code is dropped rather than failing the whole save, and
 * that criteria are replaced wholesale inside one transaction. Those rules
 * existing in two copies is how the folding of æ, ø and å ends up differing
 * between the two ways a profile can be born — a difference that would show up
 * only as a profile quietly matching less than the identical one next to it.
 */

/**
 * The transaction handle Drizzle hands to a `db.transaction` callback.
 *
 * Spelled out rather than derived with `Parameters<...>`: `transaction` is
 * generic in its return type, and inferring through it collapses to `never`.
 */
export type Tx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * The criterion lists, as free text in the user's own words.
 *
 * Structural rather than nominal, so the form's parsed shape satisfies it
 * without conversion and a draft profile can satisfy it by construction.
 */
export interface ProfileCriteria {
  readonly cpvInclude: readonly string[];
  readonly cpvExclude: readonly string[];
  readonly keywordsInclude: readonly string[];
  readonly keywordsExclude: readonly string[];
  readonly regionsInclude: readonly string[];
  readonly buyerInclude: readonly string[];
  readonly buyerExclude: readonly string[];
}

export async function clearCriteria(tx: Tx, profileId: string): Promise<void> {
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

export async function writeCriteria(
  tx: Tx,
  profileId: string,
  criteria: ProfileCriteria,
): Promise<void> {
  const cpvRows = [
    ...toCpvRows(profileId, criteria.cpvInclude, 'include'),
    ...toCpvRows(profileId, criteria.cpvExclude, 'exclude'),
  ];
  if (cpvRows.length > 0) {
    await tx.insert(schema.alertProfileCpvCodes).values(cpvRows).onConflictDoNothing();
  }

  const keywordRows = [
    ...toKeywordRows(profileId, criteria.keywordsInclude, 'include'),
    ...toKeywordRows(profileId, criteria.keywordsExclude, 'exclude'),
  ];
  if (keywordRows.length > 0) {
    await tx.insert(schema.alertProfileKeywords).values(keywordRows).onConflictDoNothing();
  }

  const regionRows = dedupe(criteria.regionsInclude).map((code) => ({
    alertProfileId: profileId,
    kind: 'region' as const,
    code,
  }));
  if (regionRows.length > 0) {
    await tx.insert(schema.alertProfileGeographies).values(regionRows).onConflictDoNothing();
  }

  const buyerRows = [
    ...toBuyerRows(profileId, criteria.buyerInclude, 'include'),
    ...toBuyerRows(profileId, criteria.buyerExclude, 'exclude'),
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
