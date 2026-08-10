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
    cpv: string | string[];
    regions: string[];
    suppressed?: boolean;
    category?: 'planned' | 'competition' | 'award';
    publishedAt?: Date;
    title?: string;
    estimatedValueMinNok?: number;
  }): Promise<string> {
    const [row] = await db
      .insert(schema.tenders)
      .values({
        source: 'doffin',
        sourceId: input.sourceId,
        sourceUrl: `https://doffin.no/notices/${input.sourceId}`,
        title: input.title ?? `Notice ${input.sourceId}`,
        ...(input.estimatedValueMinNok === undefined
          ? {}
          : { estimatedValueMinNok: input.estimatedValueMinNok }),
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
    const cpvCodes = Array.isArray(input.cpv) ? input.cpv : [input.cpv];
    await db
      .insert(schema.tenderCpvCodes)
      .values(cpvCodes.map((cpvCode) => ({ tenderId: id, cpvCode })));
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

  /**
   * The fields the anonymous result card and its "Hvorfor traff dette?" panel
   * are built from. They are widening the same query, so each one is asserted
   * against a notice that also proves the widening did not change *which*
   * notices come back.
   */
  describe('the fields a result card needs', () => {
    it('carries the estimated value through, and null when Doffin published none', async () => {
      // Absent about 47% of the time in the real corpus. A card that showed
      // "0 kr" for those would be stating a number the source never gave.
      await seedTender({
        sourceId: 'priced',
        cpv: '45000000',
        regions: ['NO071'],
        estimatedValueMinNok: 2_500_000,
      });
      await seedTender({ sourceId: 'unpriced', cpv: '45000000', regions: ['NO071'] });

      const result = await searchPublicTenders({ cpvInclude: ['45000000'], now: NOW });
      const byTitle = new Map(result.regional.map((t) => [t.title, t]));

      expect(byTitle.get('Notice priced')?.estimatedValueMinNok).toBe(2_500_000);
      expect(byTitle.get('Notice unpriced')?.estimatedValueMinNok).toBeNull();
    });

    it('returns only the CPV codes the caller asked about, not every code on the notice', async () => {
      // The card names the code that caused the hit. A notice classified under
      // half a dozen unrelated divisions must not have them all shown as
      // reasons the reader matched.
      await seedTender({
        sourceId: 'multi',
        cpv: ['45000000', '45100000', '79400000'],
        regions: ['NO071'],
      });

      const result = await searchPublicTenders({
        cpvInclude: ['45000000', '45100000'],
        now: NOW,
      });

      expect([...(result.regional[0]?.cpvCodes ?? [])].sort()).toEqual(['45000000', '45100000']);
    });

    it('reports the keywords found in the title', async () => {
      await seedTender({
        sourceId: 'kw',
        cpv: '45000000',
        regions: ['NO071'],
        title: 'Rammeavtale for rehabilitering av skolebygg',
      });

      const result = await searchPublicTenders({
        cpvInclude: ['45000000'],
        keywordsInclude: ['rehabilitering', 'riving'],
        now: NOW,
      });

      expect(result.regional[0]?.matchedKeywords).toEqual(['rehabilitering']);
    });

    it('matches a keyword as a whole word, not as a substring', async () => {
      // "bad" must not match "badevakt". Same rule as the real matcher, and the
      // reason `containsPhrase` exists rather than `String.includes`.
      await seedTender({
        sourceId: 'substring',
        cpv: '45000000',
        regions: ['NO071'],
        title: 'Innkjøp av badevakter til svømmehall',
      });

      const result = await searchPublicTenders({
        cpvInclude: ['45000000'],
        keywordsInclude: ['bad'],
        now: NOW,
      });

      expect(result.regional[0]?.matchedKeywords).toEqual([]);
    });

    it('does not filter on keywords — a CPV hit with no keyword is still a hit', async () => {
      // `keywordsInclude` annotates; it must never narrow. If it did, adding
      // the parameter would silently empty every page that passes it.
      await seedTender({
        sourceId: 'nokeyword',
        cpv: '45000000',
        regions: ['NO071'],
        title: 'Anskaffelse uten gjenkjennelige ord',
      });

      const result = await searchPublicTenders({
        cpvInclude: ['45000000'],
        keywordsInclude: ['rehabilitering'],
        now: NOW,
      });

      expect(result.regional).toHaveLength(1);
      expect(result.regional[0]?.matchedKeywords).toEqual([]);
    });

    it('returns an empty keyword list when the caller supplies none', async () => {
      await seedTender({ sourceId: 'plain', cpv: '45000000', regions: ['NO071'] });
      const result = await searchPublicTenders({ cpvInclude: ['45000000'], now: NOW });
      expect(result.regional[0]?.matchedKeywords).toEqual([]);
    });
  });
});
