import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
// Imported statically on purpose: `notice-indexing` has no database import, so
// pulling it in here cannot load `./db` early and defeat the `vi.doMock` below.
// That is exactly what happened when this function lived in `public-tenders`.
import { shouldIndexNotice } from './notice-indexing';
import type {
  listIndexableNotices as ListIndexableNotices,
  loadPublicTender as LoadPublicTender,
} from './public-tenders';

/**
 * The public notice page's reads (IDE Agent Spec v3, section 3.3).
 *
 * Two properties, and both fail silently if they break.
 *
 * **Suppression.** Nothing on this path calls `assertTenderAccess`, because an
 * unauthenticated page has no actor to check. The filter therefore lives in
 * the query, and if it is ever dropped a suppressed notice stays live on a URL
 * a crawler has already cached, with no session to revoke.
 *
 * **The noindex flip.** A closed competition removed from the sitemap is still
 * in the index — a sitemap governs discovery, not retention. Only the page's
 * own directive removes it, so `shouldIndexNotice` is what the page reads and
 * what is asserted here.
 */

const describeDb = hasDatabase ? describe : describe.skip;

describe('shouldIndexNotice', () => {
  it('indexes an open competition and a planned procurement', () => {
    expect(shouldIndexNotice({ status: 'open', noticeCategory: 'competition' })).toBe(true);
    expect(shouldIndexNotice({ status: 'open', noticeCategory: 'planned' })).toBe(true);
  });

  it('stops indexing once the competition is over', () => {
    for (const status of ['closed', 'cancelled', 'awarded'] as const) {
      expect(shouldIndexNotice({ status, noticeCategory: 'competition' })).toBe(false);
    }
  });

  it('never indexes an award notice, whatever its status says', () => {
    // Awards are ingested but are not opportunities until phase 8 (ADR-13).
    expect(shouldIndexNotice({ status: 'open', noticeCategory: 'award' })).toBe(false);
    expect(shouldIndexNotice({ status: 'unknown', noticeCategory: 'other' })).toBe(false);
  });

  it('indexes an unknown status rather than hiding a live competition', () => {
    // Doffin leaves `status` null on plenty of notices, and the derivation maps
    // that to `unknown` (docs/spec-deviations.md). Treating unknown as closed
    // would quietly de-index a large share of the corpus.
    expect(shouldIndexNotice({ status: 'unknown', noticeCategory: 'competition' })).toBe(true);
  });
});

describeDb('loadPublicTender', () => {
  let harness: TestDatabase;
  let db: TestDatabase['db'];
  let loadPublicTender: typeof LoadPublicTender;
  let listIndexableNotices: typeof ListIndexableNotices;

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db;
    vi.doMock('./db', async () => {
      const actual = await vi.importActual<Record<string, unknown>>('./db');
      return { ...actual, getWebDb: () => db };
    });
    ({ loadPublicTender, listIndexableNotices } = await import('./public-tenders'));
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table ${schema.tenders} restart identity cascade`);
  });

  async function seed(input: {
    sourceId: string;
    suppressed?: boolean;
    category?: 'planned' | 'competition' | 'award';
    status?: 'open' | 'closed' | 'cancelled' | 'awarded' | 'unknown';
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
        status: input.status ?? 'open',
        publishedAt: new Date('2026-08-01T00:00:00Z'),
        sourcePayloadHash: `hash-${input.sourceId}`,
        rawPayload: {},
        lastSyncedAt: new Date('2026-08-09T09:00:00Z'),
        ...(input.suppressed ? { suppressedAt: new Date('2026-08-09T09:00:00Z') } : {}),
      })
      .returning({ id: schema.tenders.id });
    return row!.id;
  }

  it('serves an open competition', async () => {
    const id = await seed({ sourceId: 'live' });
    const tender = await loadPublicTender(id);
    expect(tender?.title).toBe('Notice live');
  });

  it('refuses a suppressed notice, indistinguishably from one that never existed', async () => {
    const id = await seed({ sourceId: 'gone', suppressed: true });
    expect(await loadPublicTender(id)).toBeNull();
    expect(await loadPublicTender('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('refuses an award notice', async () => {
    const id = await seed({ sourceId: 'award', category: 'award' });
    expect(await loadPublicTender(id)).toBeNull();
  });

  it('still serves a closed competition, because the page de-indexes rather than 404s', async () => {
    // Deliberate: someone following a link to a competition that just closed
    // should read that it closed, not hit a dead end. The page emits noindex;
    // it does not disappear.
    const id = await seed({ sourceId: 'closed', status: 'closed' });
    const tender = await loadPublicTender(id);
    expect(tender).not.toBeNull();
    expect(shouldIndexNotice(tender!)).toBe(false);
  });

  it('lists only open and planned notices in the sitemap source', async () => {
    await seed({ sourceId: 'open-one' });
    await seed({ sourceId: 'planned-one', category: 'planned' });
    await seed({ sourceId: 'closed-one', status: 'closed' });
    await seed({ sourceId: 'suppressed-one', suppressed: true });
    await seed({ sourceId: 'award-one', category: 'award' });

    const listed = await listIndexableNotices();
    expect(listed).toHaveLength(2);
  });
});
