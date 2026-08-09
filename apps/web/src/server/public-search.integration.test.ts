import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { landsdelBySlug } from '@luma/domain';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import type { searchPublicTenders as SearchPublicTenders } from './public-search';

/**
 * The anonymous search surface's reads (IDE Agent Spec v3, section 3.2).
 *
 * These pages are unauthenticated and indexable, which makes one property
 * load-bearing in a way it is not anywhere else in the app: **suppression is
 * enforced here explicitly, not inherited.** Every signed-in read goes through
 * `assertTenderAccess`; nothing on this path does, because there is no actor
 * to check. So if the filter is ever dropped from these queries, an admin
 * suppressing an invalid notice would leave it live on a public URL that a
 * search engine has already cached, and no other test in the repository would
 * notice.
 */

const describeDb = hasDatabase ? describe : describe.skip;
const NOW = new Date('2026-08-09T09:00:00Z');

describeDb('searchPublicTenders', () => {
  let harness: TestDatabase;
  let db: TestDatabase['db'];
  let searchPublicTenders: typeof SearchPublicTenders;

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db;
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'set-for-the-module-guard';
    vi.doMock('./db', async () => {
      const actual = await vi.importActual<Record<string, unknown>>('./db');
      return { ...actual, getWebDb: () => db };
    });
    ({ searchPublicTenders } = await import('./public-search'));
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table ${schema.tenders} restart identity cascade`);
  });

  async function seedTender(input: {
    sourceId: string;
    cpv: string;
    regions: string[];
    suppressed?: boolean;
    category?: 'planned' | 'competition' | 'award';
    publishedAt?: Date;
  }): Promise<string> {
    const [row] = await db
      .insert(schema.tenders)
      .values({
        source: 'doffin',
        sourceId: input.sourceId,
        sourceUrl: `https://doffin.no/notices/${input.sourceId}`,
        title: `Notice ${input.sourceId}`,
        buyerName: 'Testkommune',
        noticeCategory: input.category ?? 'competition',
        status: 'open',
        publishedAt: input.publishedAt ?? new Date('2026-08-01T00:00:00Z'),
        sourcePayloadHash: `hash-${input.sourceId}`,
        rawPayload: {},
        lastSyncedAt: NOW,
        ...(input.suppressed ? { suppressedAt: NOW } : {}),
      })
      .returning({ id: schema.tenders.id });

    const id = row!.id;
    await db.insert(schema.tenderCpvCodes).values({ tenderId: id, cpvCode: input.cpv });
    if (input.regions.length > 0) {
      await db
        .insert(schema.tenderRegions)
        .values(input.regions.map((regionCode) => ({ tenderId: id, regionCode })));
    }
    return id;
  }

  it('hides a suppressed notice, even though nothing here calls assertTenderAccess', async () => {
    await seedTender({ sourceId: 'visible', cpv: '45000000', regions: ['NO071'] });
    await seedTender({
      sourceId: 'suppressed',
      cpv: '45000000',
      regions: ['NO071'],
      suppressed: true,
    });

    const result = await searchPublicTenders({ cpvInclude: ['45000000'], now: NOW });
    const titles = result.regional.map((tender) => tender.title);

    expect(titles).toContain('Notice visible');
    expect(titles).not.toContain('Notice suppressed');
  });

  it('never lists an award notice', async () => {
    // Awards are ingested but are not opportunities until phase 8 (ADR-13). A
    // public page listing them would advertise competitions already lost.
    await seedTender({ sourceId: 'award', cpv: '45000000', regions: ['NO071'], category: 'award' });
    const result = await searchPublicTenders({ cpvInclude: ['45000000'], now: NOW });
    expect([...result.regional, ...result.nationwide]).toHaveLength(0);
  });

  it('separates nationwide notices from regional ones rather than merging them', async () => {
    // The whole reason the two lists exist: merged, six landsdel pages for a
    // template whose hits are mostly nationwide become ~86% identical content.
    await seedTender({ sourceId: 'regional', cpv: '45000000', regions: ['NO071'] });
    await seedTender({ sourceId: 'national', cpv: '45000000', regions: ['anyw'] });

    const result = await searchPublicTenders({
      cpvInclude: ['45000000'],
      landsdel: landsdelBySlug('nord-norge')!,
      now: NOW,
    });

    expect(result.regional.map((t) => t.title)).toEqual(['Notice regional']);
    expect(result.nationwide.map((t) => t.title)).toEqual(['Notice national']);
  });

  it('cuts to the landsdel asked for and excludes the others', async () => {
    await seedTender({ sourceId: 'nord', cpv: '45000000', regions: ['NO071'] });
    await seedTender({ sourceId: 'oslo', cpv: '45000000', regions: ['NO081'] });

    const nord = await searchPublicTenders({
      cpvInclude: ['45000000'],
      landsdel: landsdelBySlug('nord-norge')!,
      now: NOW,
    });
    expect(nord.regional.map((t) => t.title)).toEqual(['Notice nord']);

    // And the national page keeps both, because there is no cut to apply.
    const national = await searchPublicTenders({ cpvInclude: ['45000000'], now: NOW });
    expect(national.regional).toHaveLength(2);
  });

  it('drops a notice whose region code is not a recognised Norwegian county', async () => {
    // A foreign buyer's code, or one Norway introduces later. It must fall out
    // of the regional cut rather than be filed somewhere plausible.
    await seedTender({ sourceId: 'foreign', cpv: '45000000', regions: ['SE110'] });
    const result = await searchPublicTenders({
      cpvInclude: ['45000000'],
      landsdel: landsdelBySlug('nord-norge')!,
      now: NOW,
    });
    expect(result.regional).toHaveLength(0);
  });

  it('ignores a notice published outside the window', async () => {
    await seedTender({
      sourceId: 'ancient',
      cpv: '45000000',
      regions: ['NO071'],
      publishedAt: new Date('2025-01-01T00:00:00Z'),
    });
    const result = await searchPublicTenders({ cpvInclude: ['45000000'], now: NOW });
    expect(result.regional).toHaveLength(0);
  });

  it('returns nothing for a template with no CPV codes rather than everything', async () => {
    // An empty include list must not degrade into "match all" — that would put
    // every notice in the corpus on one trade's page.
    await seedTender({ sourceId: 'any', cpv: '45000000', regions: ['NO071'] });
    const result = await searchPublicTenders({ cpvInclude: [], now: NOW });
    expect(result.totalConsidered).toBe(0);
  });
});
