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
    deadlineAt?: Date;
    title?: string;
    description?: string;
    estimatedValueMinNok?: number;
  }): Promise<string> {
    const [row] = await db
      .insert(schema.tenders)
      .values({
        source: 'doffin',
        sourceId: input.sourceId,
        sourceUrl: `https://doffin.no/notices/${input.sourceId}`,
        title: input.title ?? `Notice ${input.sourceId}`,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.estimatedValueMinNok === undefined
          ? {}
          : { estimatedValueMinNok: input.estimatedValueMinNok }),
        buyerName: 'Testkommune',
        noticeCategory: input.category ?? 'competition',
        status: 'open',
        publishedAt: input.publishedAt ?? new Date('2026-08-01T00:00:00Z'),
        ...(input.deadlineAt === undefined ? {} : { deadlineAt: input.deadlineAt }),
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
    await seedTender({ sourceId: 'visible', cpv: '45100000', regions: ['NO071'] });
    await seedTender({
      sourceId: 'suppressed',
      cpv: '45100000',
      regions: ['NO071'],
      suppressed: true,
    });

    const result = await searchPublicTenders({ cpvInclude: ['45100000'], now: NOW });
    const titles = result.regional.map((tender) => tender.title);

    expect(titles).toContain('Notice visible');
    expect(titles).not.toContain('Notice suppressed');
  });

  it('never lists an award notice', async () => {
    // Awards are ingested but are not opportunities until phase 8 (ADR-13). A
    // public page listing them would advertise competitions already lost.
    await seedTender({ sourceId: 'award', cpv: '45100000', regions: ['NO071'], category: 'award' });
    const result = await searchPublicTenders({ cpvInclude: ['45100000'], now: NOW });
    expect([...result.regional, ...result.nationwide]).toHaveLength(0);
  });

  it('separates nationwide notices from regional ones rather than merging them', async () => {
    // The whole reason the two lists exist: merged, six landsdel pages for a
    // template whose hits are mostly nationwide become ~86% identical content.
    await seedTender({ sourceId: 'regional', cpv: '45100000', regions: ['NO071'] });
    await seedTender({ sourceId: 'national', cpv: '45100000', regions: ['anyw'] });

    const result = await searchPublicTenders({
      cpvInclude: ['45100000'],
      landsdel: landsdelBySlug('nord-norge')!,
      now: NOW,
    });

    expect(result.regional.map((t) => t.title)).toEqual(['Notice regional']);
    expect(result.nationwide.map((t) => t.title)).toEqual(['Notice national']);
  });

  it('cuts to the landsdel asked for and excludes the others', async () => {
    await seedTender({ sourceId: 'nord', cpv: '45100000', regions: ['NO071'] });
    await seedTender({ sourceId: 'oslo', cpv: '45100000', regions: ['NO081'] });

    const nord = await searchPublicTenders({
      cpvInclude: ['45100000'],
      landsdel: landsdelBySlug('nord-norge')!,
      now: NOW,
    });
    expect(nord.regional.map((t) => t.title)).toEqual(['Notice nord']);

    // And the national page keeps both, because there is no cut to apply.
    const national = await searchPublicTenders({ cpvInclude: ['45100000'], now: NOW });
    expect(national.regional).toHaveLength(2);
  });

  it('drops a notice whose region code is not a recognised Norwegian county', async () => {
    // A foreign buyer's code, or one Norway introduces later. It must fall out
    // of the regional cut rather than be filed somewhere plausible.
    await seedTender({ sourceId: 'foreign', cpv: '45100000', regions: ['SE110'] });
    const result = await searchPublicTenders({
      cpvInclude: ['45100000'],
      landsdel: landsdelBySlug('nord-norge')!,
      now: NOW,
    });
    expect(result.regional).toHaveLength(0);
  });

  it('ignores a notice published outside the window', async () => {
    await seedTender({
      sourceId: 'ancient',
      cpv: '45100000',
      regions: ['NO071'],
      publishedAt: new Date('2025-01-01T00:00:00Z'),
    });
    const result = await searchPublicTenders({ cpvInclude: ['45100000'], now: NOW });
    expect(result.regional).toHaveLength(0);
  });

  it('returns nothing for a template with no CPV codes rather than everything', async () => {
    // An empty include list must not degrade into "match all" — that would put
    // every notice in the corpus on one trade's page.
    await seedTender({ sourceId: 'any', cpv: '45100000', regions: ['NO071'] });
    const result = await searchPublicTenders({ cpvInclude: [], now: NOW });
    expect(result.totalConsidered).toBe(0);
  });

  /**
   * R5, and the reason this module stopped selecting on `publishedAt`.
   *
   * The old query ordered by publication date and cut at the limit, which on a
   * dense trade meant the page showed the 30 most recently *announced*
   * competitions and then sorted those by deadline. A competition closing in
   * three days that was announced five weeks ago never reached the browser at
   * all, so «første kort har den nærmeste fristen» was false in exactly the
   * case R5 was written for. Measured on the real corpus,
   * `bygg-og-anlegg-utforende` had 168 open competitions of which the nearest
   * deadline was absent from the selected 37.
   *
   * Each test below cuts the limit to a number smaller than the seeded set,
   * because a limit that does not bind proves nothing about the cut.
   */
  describe('which notices the limit keeps', () => {
    const soon = new Date('2026-08-12T10:00:00Z');
    const later = new Date('2026-11-01T10:00:00Z');
    const past = new Date('2026-08-05T10:00:00Z');

    it('keeps the competition closing soonest, however long ago it was announced', async () => {
      await seedTender({
        sourceId: 'urgent-old',
        cpv: '45100000',
        regions: ['NO071'],
        title: 'Frist om to dager, kunngjort i juni',
        publishedAt: new Date('2026-06-10T00:00:00Z'),
        deadlineAt: soon,
      });
      for (let i = 0; i < 5; i += 1) {
        await seedTender({
          sourceId: `fresh-${i}`,
          cpv: '45100000',
          regions: ['NO071'],
          title: `Kunngjort i går, frist i november ${i}`,
          publishedAt: new Date('2026-08-08T00:00:00Z'),
          deadlineAt: later,
        });
      }

      const result = await searchPublicTenders({
        cpvInclude: ['45100000'],
        now: NOW,
        limit: 2,
      });

      expect(result.regional[0]?.title).toBe('Frist om to dager, kunngjort i juni');
      expect(result.regional).toHaveLength(2);
    });

    it('caps expired competitions instead of letting them fill the page', async () => {
      for (let i = 0; i < 9; i += 1) {
        await seedTender({
          sourceId: `expired-${i}`,
          cpv: '45100000',
          regions: ['NO071'],
          title: `Utløpt ${i}`,
          deadlineAt: new Date(past.getTime() - i * 86_400_000),
        });
      }

      const result = await searchPublicTenders({
        cpvInclude: ['45100000'],
        now: NOW,
        expiredLimit: 3,
      });

      // The three most recently closed, which is the order `compareExpired`
      // puts them in and the freshest market signal of the nine.
      expect(result.regional.map((t) => t.title)).toEqual(['Utløpt 0', 'Utløpt 1', 'Utløpt 2']);
    });

    it('does not let expired competitions cost an open one its place', async () => {
      // The failure the split exists to make impossible: one shared cut, and
      // notices that closed weeks ago push out one that is still live.
      for (let i = 0; i < 9; i += 1) {
        await seedTender({
          sourceId: `closed-${i}`,
          cpv: '45100000',
          regions: ['NO071'],
          title: `Utløpt ${i}`,
          deadlineAt: new Date(past.getTime() - i * 86_400_000),
        });
      }
      await seedTender({
        sourceId: 'live',
        cpv: '45100000',
        regions: ['NO071'],
        title: 'Fortsatt åpen',
        deadlineAt: soon,
      });

      const result = await searchPublicTenders({
        cpvInclude: ['45100000'],
        now: NOW,
        limit: 1,
        expiredLimit: 2,
      });

      const titles = result.regional.map((t) => t.title);
      expect(titles).toContain('Fortsatt åpen');
      expect(titles.filter((title) => title.startsWith('Utløpt'))).toHaveLength(2);
    });

    it('keeps a planned procurement even when open competitions could fill the page', async () => {
      // A plan has no deadline to compete with (ADR-13) and none is invented
      // for it, so it is selected on its own budget or not at all.
      for (let i = 0; i < 5; i += 1) {
        await seedTender({
          sourceId: `open-${i}`,
          cpv: '45100000',
          regions: ['NO071'],
          title: `Åpen ${i}`,
          deadlineAt: new Date(soon.getTime() + i * 86_400_000),
        });
      }
      await seedTender({
        sourceId: 'plan',
        cpv: '45100000',
        regions: ['NO071'],
        category: 'planned',
        title: 'Planlagt anskaffelse',
      });

      const result = await searchPublicTenders({ cpvInclude: ['45100000'], now: NOW, limit: 1 });

      expect(result.regional.map((t) => t.title)).toEqual(['Åpen 0', 'Planlagt anskaffelse']);
    });

    it('keeps a competition whose deadline the source never stated, behind the dated ones', async () => {
      // Not expired — the field is missing, not passed — so it stays in the
      // open population and sorts last there, as `compareByDeadline` does.
      await seedTender({
        sourceId: 'dated',
        cpv: '45100000',
        regions: ['NO071'],
        title: 'Med frist',
        deadlineAt: soon,
      });
      await seedTender({
        sourceId: 'undated',
        cpv: '45100000',
        regions: ['NO071'],
        title: 'Uten frist',
      });

      const result = await searchPublicTenders({ cpvInclude: ['45100000'], now: NOW });
      expect(result.regional.map((t) => t.title)).toEqual(['Med frist', 'Uten frist']);
    });

    it('gives the nationwide list its own budget rather than sharing the regional one', async () => {
      // `PUBLIC_RESULT_LIMIT` is per array. A page whose regional half is full
      // must still show the nationwide competitions a reader can bid on.
      for (let i = 0; i < 3; i += 1) {
        await seedTender({
          sourceId: `reg-${i}`,
          cpv: '45100000',
          regions: ['NO071'],
          title: `Regional ${i}`,
          deadlineAt: new Date(soon.getTime() + i * 86_400_000),
        });
      }
      await seedTender({
        sourceId: 'nat',
        cpv: '45100000',
        regions: ['anyw'],
        title: 'Landsdekkende',
        deadlineAt: later,
      });

      const result = await searchPublicTenders({ cpvInclude: ['45100000'], now: NOW, limit: 1 });
      expect(result.regional.map((t) => t.title)).toEqual(['Regional 0']);
      expect(result.nationwide.map((t) => t.title)).toEqual(['Landsdekkende']);
    });
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
        cpv: '45100000',
        regions: ['NO071'],
        estimatedValueMinNok: 2_500_000,
      });
      await seedTender({ sourceId: 'unpriced', cpv: '45100000', regions: ['NO071'] });

      const result = await searchPublicTenders({ cpvInclude: ['45100000'], now: NOW });
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
        cpv: '45100000',
        regions: ['NO071'],
        title: 'Rammeavtale for rehabilitering av skolebygg',
      });

      const result = await searchPublicTenders({
        cpvInclude: ['45100000'],
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
        cpv: '45100000',
        regions: ['NO071'],
        title: 'Innkjøp av badevakter til svømmehall',
      });

      const result = await searchPublicTenders({
        cpvInclude: ['45100000'],
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
        cpv: '45100000',
        regions: ['NO071'],
        title: 'Anskaffelse uten gjenkjennelige ord',
      });

      const result = await searchPublicTenders({
        cpvInclude: ['45100000'],
        keywordsInclude: ['rehabilitering'],
        now: NOW,
      });

      expect(result.regional).toHaveLength(1);
      expect(result.regional[0]?.matchedKeywords).toEqual([]);
    });

    it('returns an empty keyword list when the caller supplies none', async () => {
      await seedTender({ sourceId: 'plain', cpv: '45100000', regions: ['NO071'] });
      const result = await searchPublicTenders({ cpvInclude: ['45100000'], now: NOW });
      expect(result.regional[0]?.matchedKeywords).toEqual([]);
    });

    it('reports a keyword found only in the description, separately from the title ones', async () => {
      await seedTender({
        sourceId: 'desc',
        cpv: '45100000',
        regions: ['NO071'],
        title: 'Rammeavtale for rehabilitering av skolebygg',
        description: 'Arbeidet omfatter riving av eksisterende konstruksjoner.',
      });

      const result = await searchPublicTenders({
        cpvInclude: ['45100000'],
        keywordsInclude: ['rehabilitering', 'riving'],
        now: NOW,
      });

      expect(result.regional[0]?.matchedKeywords).toEqual(['rehabilitering']);
      expect(result.regional[0]?.descriptionKeywords).toEqual(['riving']);
    });

    it('does not repeat a title word in the description list', async () => {
      // The two lists carry different weight in `buildPublicReasons`. A word in
      // both places must appear once, or it is counted twice.
      await seedTender({
        sourceId: 'both',
        cpv: '45100000',
        regions: ['NO071'],
        title: 'Rehabilitering av skolebygg',
        description: 'Rehabilitering av fasade og tak.',
      });

      const result = await searchPublicTenders({
        cpvInclude: ['45100000'],
        keywordsInclude: ['rehabilitering'],
        now: NOW,
      });

      expect(result.regional[0]?.matchedKeywords).toEqual(['rehabilitering']);
      expect(result.regional[0]?.descriptionKeywords).toEqual([]);
    });
  });

  /**
   * R1 — a notice whose only signal is a broad CPV code is not shown.
   *
   * The rule that removed advokattjenester, frisørmøbler, four lås-og-beslag
   * contracts and the transport of dead animals from
   * `renhold-og-facility-management`, all of which were tagged 98300000
   * «Diverse tjenester» and nothing else the template asked for.
   *
   * These are integration tests rather than unit tests of `isBroadCpv` because
   * the interesting part is not the predicate — that is asserted next to the
   * table it reads — but that this query is where the notice actually
   * disappears, for every caller including `landsdelerWithHits`.
   */
  describe('broad CPV codes cannot qualify a notice on their own', () => {
    it('drops a notice matching only a broad code, with nothing else to go on', async () => {
      await seedTender({
        sourceId: 'junk',
        cpv: '98300000',
        regions: ['NO071'],
        title: 'Rammeavtale for kjøp av lås og beslag',
      });

      const result = await searchPublicTenders({
        cpvInclude: ['90910000', '98300000'],
        keywordsInclude: ['renhold'],
        now: NOW,
      });

      expect([...result.regional, ...result.nationwide]).toHaveLength(0);
    });

    it('keeps the same notice when the trade word is in its title', async () => {
      // Broad code plus a real signal is not the case R1 excludes. The notice
      // is shown, and `buildPublicReasons` grades it Lav rather than hiding it.
      await seedTender({
        sourceId: 'broad-but-relevant',
        cpv: '98300000',
        regions: ['NO071'],
        title: 'Rammeavtale renhold av kommunale bygg',
      });

      const result = await searchPublicTenders({
        cpvInclude: ['98300000'],
        keywordsInclude: ['renhold'],
        now: NOW,
      });

      expect(result.regional).toHaveLength(1);
    });

    it('keeps a notice that also carries a precise code from the template', async () => {
      await seedTender({
        sourceId: 'mixed',
        cpv: ['98300000', '90910000'],
        regions: ['NO071'],
        title: 'Anskaffelse uten gjenkjennelige ord',
      });

      const result = await searchPublicTenders({
        cpvInclude: ['98300000', '90910000'],
        now: NOW,
      });

      expect(result.regional).toHaveLength(1);
      expect([...(result.regional[0]?.cpvCodes ?? [])].sort()).toEqual(['90910000', '98300000']);
    });

    it('keeps a notice whose only word is in the description', async () => {
      await seedTender({
        sourceId: 'desc-only',
        cpv: '98300000',
        regions: ['NO071'],
        title: 'Anskaffelse uten gjenkjennelige ord',
        description: 'Oppdraget omfatter renhold av fellesarealer.',
      });

      const result = await searchPublicTenders({
        cpvInclude: ['98300000'],
        keywordsInclude: ['renhold'],
        now: NOW,
      });

      expect(result.regional).toHaveLength(1);
      expect(result.regional[0]?.descriptionKeywords).toEqual(['renhold']);
    });

    it('drops a broad-only notice from the nationwide list too, not just the regional one', async () => {
      // Two lists, one rule. A notice filtered out of `regional` but left in
      // `nationwide` would put the junk back on every page.
      await seedTender({
        sourceId: 'junk-national',
        cpv: '98300000',
        regions: ['anyw'],
        title: 'Transport av døde dyr',
      });

      const result = await searchPublicTenders({
        cpvInclude: ['98300000'],
        keywordsInclude: ['renhold'],
        now: NOW,
      });

      expect(result.nationwide).toHaveLength(0);
    });

    it('leaves bygg-og-anlegg-utforende a list, even though 45000000 is broad', async () => {
      // The template's core code is a division and therefore broad, which made
      // this the change's most dangerous case: if breadth disqualified the
      // notice rather than the *signal*, the trade's page would empty out. A
      // notice tagged only 45000000 does go, and everything carrying one of the
      // template's four precise codes stays.
      await seedTender({ sourceId: 'bare', cpv: '45000000', regions: ['NO071'] });
      await seedTender({ sourceId: 'sitework', cpv: ['45000000', '45100000'], regions: ['NO071'] });
      await seedTender({ sourceId: 'building', cpv: ['45000000', '45200000'], regions: ['NO071'] });
      await seedTender({
        sourceId: 'named',
        cpv: '45000000',
        regions: ['NO071'],
        title: 'Totalentreprise for nytt bygg',
      });

      const result = await searchPublicTenders({
        cpvInclude: ['45000000', '45100000', '45200000', '45400000', '45500000'],
        keywordsInclude: ['totalentreprise'],
        now: NOW,
      });

      expect(result.regional.map((t) => t.title).sort()).toEqual([
        'Notice building',
        'Notice sitework',
        'Totalentreprise for nytt bygg',
      ]);
    });
  });
});
