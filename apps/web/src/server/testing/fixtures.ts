import { randomBytes, randomUUID } from 'node:crypto';
import * as schema from '@luma/db/schema';
import { normalizeSearchText } from '@luma/domain';
import type { Database } from '../db';

/**
 * Fixtures for the integration suites.
 *
 * The values are deliberately distinctive — `SHARER_EMAIL`, `PROFILE_KEYWORD`
 * and friends are strings that would never occur in real tender text — because
 * the privacy test's whole method is to serialise a rendered payload and assert
 * that none of them appear in it. A fixture email of `test@example.com` would
 * make that assertion pass by luck.
 */

export const SHARER_EMAIL = 'deler-brukeren-unik@fixture.invalid';
export const OTHER_USER_EMAIL = 'annen-bruker-unik@fixture.invalid';
export const PROFILE_NAME = 'Hemmelig profilnavn Kvasarfjord';
export const PROFILE_KEYWORD = 'kvasarfjord';
export const PROFILE_EXCLUDED_KEYWORD = 'nebulaskvalp';
export const PROFILE_BUYER = 'Hemmelig Oppdragsgiver Kvasarfjord AS';

export interface SeededUser {
  readonly id: string;
  readonly email: string;
}

export async function seedUser(db: Database, email: string): Promise<SeededUser> {
  const [user] = await db
    .insert(schema.users)
    .values({ email, name: 'Testbruker' })
    .returning({ id: schema.users.id, email: schema.users.email });
  if (!user) throw new Error('kunne ikke opprette testbruker');
  return user;
}

export interface SeedTenderInput {
  readonly title?: string;
  readonly buyerName?: string;
  readonly description?: string;
  readonly noticeCategory?: 'planned' | 'competition' | 'award' | 'other';
  readonly publishedAt?: Date;
  readonly deadlineAt?: Date | null;
  readonly cpvCodes?: readonly string[];
  readonly regionCodes?: readonly string[];
  readonly estimatedValueNok?: number | null;
  readonly currency?: string | null;
  readonly suppressed?: boolean;
}

export async function seedTender(db: Database, input: SeedTenderInput = {}): Promise<string> {
  const sourceId = `fixture-${randomUUID()}`;
  const [tender] = await db
    .insert(schema.tenders)
    .values({
      source: 'doffin',
      sourceId,
      noticeId: `notice-${sourceId}`,
      sourceUrl: `https://doffin.no/notices/${sourceId}`,
      title: input.title ?? 'Rammeavtale for testformål',
      description: input.description ?? null,
      buyerName: input.buyerName ?? 'Testkommune',
      noticeCategory: input.noticeCategory ?? 'competition',
      status: 'open',
      publishedAt: input.publishedAt ?? new Date(),
      deadlineAt:
        input.deadlineAt === undefined ? new Date(Date.now() + 20 * 86_400_000) : input.deadlineAt,
      estimatedValueMinNok: input.estimatedValueNok ?? null,
      estimatedValueMaxNok: input.estimatedValueNok ?? null,
      currency: input.currency ?? null,
      sourcePayloadHash: randomBytes(16).toString('hex'),
      // The column is NOT NULL and holds the source payload. Nothing reads it
      // here, and it must never contain user data, so it stays an empty object.
      rawPayload: {},
      suppressedAt: input.suppressed ? new Date() : null,
    })
    .returning({ id: schema.tenders.id });
  if (!tender) throw new Error('kunne ikke opprette testanbud');

  const cpvCodes = input.cpvCodes ?? ['45000000'];
  if (cpvCodes.length > 0) {
    await db
      .insert(schema.tenderCpvCodes)
      .values(cpvCodes.map((cpvCode) => ({ tenderId: tender.id, cpvCode })));
  }

  const regionCodes = input.regionCodes ?? ['NO081'];
  if (regionCodes.length > 0) {
    await db
      .insert(schema.tenderRegions)
      .values(regionCodes.map((regionCode) => ({ tenderId: tender.id, regionCode })));
  }

  return tender.id;
}

/** A profile carrying the distinctive criteria the privacy test looks for. */
export async function seedProfile(
  db: Database,
  input: { userId: string; name?: string; keyword?: string; buyer?: string },
): Promise<string> {
  const [profile] = await db
    .insert(schema.alertProfiles)
    .values({
      userId: input.userId,
      name: input.name ?? PROFILE_NAME,
      description: `Beskrivelse som nevner ${PROFILE_KEYWORD}`,
      active: true,
    })
    .returning({ id: schema.alertProfiles.id });
  if (!profile) throw new Error('kunne ikke opprette varslingsprofil');

  const keyword = input.keyword ?? PROFILE_KEYWORD;
  await db.insert(schema.alertProfileKeywords).values([
    {
      alertProfileId: profile.id,
      mode: 'include',
      keyword,
      normalizedKeyword: normalizeSearchText(keyword),
    },
    {
      alertProfileId: profile.id,
      mode: 'exclude',
      keyword: PROFILE_EXCLUDED_KEYWORD,
      normalizedKeyword: normalizeSearchText(PROFILE_EXCLUDED_KEYWORD),
    },
  ]);

  const buyer = input.buyer ?? PROFILE_BUYER;
  await db.insert(schema.alertProfileBuyers).values({
    alertProfileId: profile.id,
    mode: 'include',
    buyerName: buyer,
    normalizedBuyerName: normalizeSearchText(buyer),
  });

  await db
    .insert(schema.alertProfileCpvCodes)
    .values({ alertProfileId: profile.id, mode: 'include', cpvCode: '45000000' });

  await db
    .insert(schema.alertProfileGeographies)
    .values({ alertProfileId: profile.id, kind: 'region', code: 'NO081' });

  return profile.id;
}

export async function seedMatch(
  db: Database,
  input: {
    tenderId: string;
    alertProfileId: string;
    included?: boolean;
    confidence?: 'high' | 'medium' | 'low';
    score?: number;
  },
): Promise<string> {
  const [match] = await db
    .insert(schema.tenderMatches)
    .values({
      tenderId: input.tenderId,
      alertProfileId: input.alertProfileId,
      score: input.score ?? 72,
      confidence: input.confidence ?? 'high',
      included: input.included ?? true,
      matchingVersion: '1.0.0-test',
    })
    .returning({ id: schema.tenderMatches.id });
  if (!match) throw new Error('kunne ikke opprette treff');

  // The evidence deliberately carries the profile's own keyword and buyer, so
  // a shared view that leaked the evidence array would be caught.
  await db.insert(schema.tenderMatchReasons).values([
    {
      matchId: match.id,
      entryType: 'reason',
      reasonType: 'keyword',
      typeKey: 'keyword',
      label: 'Anbudet nevner søkeord fra profilen din',
      contribution: 30,
      evidence: [PROFILE_KEYWORD],
      sortOrder: 0,
    },
    {
      matchId: match.id,
      entryType: 'reason',
      reasonType: 'cpv',
      typeKey: 'cpv',
      label: 'Anbudet har CPV-koder du følger',
      contribution: 42,
      evidence: ['45000000'],
      sortOrder: 1,
    },
  ]);

  return match.id;
}

export async function seedShare(
  db: Database,
  input: {
    tenderId: string;
    createdByUserId: string;
    expiresAt?: Date;
    revokedAt?: Date | null;
  },
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(schema.tenderShares).values({
    tenderId: input.tenderId,
    createdByUserId: input.createdByUserId,
    token,
    expiresAt: input.expiresAt ?? new Date(Date.now() + 30 * 86_400_000),
    revokedAt: input.revokedAt ?? null,
  });
  return token;
}
