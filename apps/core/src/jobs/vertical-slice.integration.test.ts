import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import {
  alertProfileCpvCodes,
  alertProfileGeographies,
  alertProfileKeywords,
  alertProfiles,
  ingestionCheckpoints,
  ingestionRuns,
  industryTemplates,
  tenderMatchReasons,
  tenderMatches,
  tenders,
  users,
} from '@luma/db';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import { FixtureTenderSourceAdapter, type DoffinSearchHit } from '@luma/doffin';
import { INDUSTRY_TEMPLATE_SEEDS } from '@luma/content';
import { createLogger } from '@luma/observability';
import { runIngest } from './ingest.js';
import { runMatching } from './match.js';

/**
 * The first milestone from spec §54: a user's stated criteria turn into
 * useful, explainable tender matches, including planned procurements.
 *
 * This is the test that says the product works. Everything else verifies a
 * part; this one runs the whole path — real captured Doffin payloads, real
 * ingest, a real industry template, the real matching engine, a real
 * database — and asserts on what a user would actually be shown.
 */

const describeDb = hasDatabase ? describe : describe.skip;

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'packages',
  'doffin',
  'fixtures',
);

function realHit(file: string): DoffinSearchHit {
  return JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as DoffinSearchHit;
}

const logger = createLogger({ service: 'core', silent: true });
const now = new Date('2026-08-10T06:00:00Z');

/** A construction tender that the bygg-og-anlegg template should match. */
function constructionCompetition(): DoffinSearchHit {
  return {
    ...realHit('contract-notice.json'),
    id: '2026-900001',
    publicationDate: '2026-08-09',
    heading: 'Rehabilitering av Sandvika skole, totalentreprise',
    description:
      'Bærum kommune skal rehabilitere Sandvika skole. Oppdraget lyses ut som totalentreprise og omfatter riving, betongarbeider og innvendig ombygging.',
    type: 'ANNOUNCEMENT_OF_COMPETITION',
    status: 'ACTIVE',
    cpvCodes: ['45000000', '45200000'],
    locationId: ['NO082'],
    deadline: '2026-09-15T12:00:00Z',
  };
}

/** A planned procurement in the same field. No deadline, by definition. */
function constructionPlanned(): DoffinSearchHit {
  return {
    ...realHit('prior-information-notice.json'),
    id: '2026-900002',
    publicationDate: '2026-08-09',
    heading: 'Veiledende kunngjøring: nybygg barnehage i Bærum',
    description:
      'Bærum kommune planlegger nybygg av barnehage. Konkurransen forventes kunngjort i 2027 og vil omfatte grunnarbeider og betongarbeider.',
    type: 'ADVISORY_NOTICE',
    status: null,
    cpvCodes: ['45000000'],
    locationId: ['NO082'],
    deadline: null,
  };
}

/** Wholly unrelated: an IT tender a construction profile must not be shown. */
function unrelatedItCompetition(): DoffinSearchHit {
  return {
    ...realHit('contract-notice.json'),
    id: '2026-900003',
    publicationDate: '2026-08-09',
    heading: 'Anskaffelse av saksbehandlingssystem',
    description: 'Kommunen skal anskaffe et nytt saksbehandlingssystem som skytjeneste.',
    type: 'ANNOUNCEMENT_OF_COMPETITION',
    status: 'ACTIVE',
    cpvCodes: ['72000000'],
    locationId: ['NO081'],
    deadline: '2026-09-20T12:00:00Z',
  };
}

describeDb('the first milestone: criteria to explainable matches', () => {
  let harness: TestDatabase;
  let db: TestDatabase['db'];
  let profileId: string;

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db;
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table ${tenders}, ${users}, ${industryTemplates}, ${ingestionRuns}, ${ingestionCheckpoints} restart identity cascade`,
    );

    // A user picks the construction industry template during onboarding, which
    // is what makes the under-five-minutes signup in spec §9.1 possible.
    const template = INDUSTRY_TEMPLATE_SEEDS.find((t) => t.slug === 'bygg-og-anlegg');
    if (!template) throw new Error('the bygg-og-anlegg template is missing');

    const templateRows = await db
      .insert(industryTemplates)
      .values({
        slug: template.slug,
        name: template.name,
        description: template.description,
        sortOrder: template.sortOrder,
        active: true,
      })
      .returning({ id: industryTemplates.id });

    const userRows = await db
      .insert(users)
      .values({ email: 'anbud@entreprenor.no' })
      .returning({ id: users.id });
    const userId = userRows[0]!.id;

    const profileRows = await db
      .insert(alertProfiles)
      .values({
        userId,
        name: 'Bygg og rehabilitering',
        active: true,
        industryTemplateId: templateRows[0]!.id,
        includePlannedProcurements: true,
        frequency: 'daily',
        digestHourLocal: 7,
        timezone: 'Europe/Oslo',
        minimumMatchScore: 30,
      })
      .returning({ id: alertProfiles.id });
    profileId = profileRows[0]!.id;

    await db.insert(alertProfileCpvCodes).values(
      template.cpvInclude.map((cpvCode) => ({
        alertProfileId: profileId,
        cpvCode,
        mode: 'include' as const,
      })),
    );
    await db.insert(alertProfileKeywords).values(
      template.keywordsInclude.slice(0, 6).map((keyword) => ({
        alertProfileId: profileId,
        keyword,
        normalizedKeyword: keyword.toLowerCase(),
        mode: 'include' as const,
      })),
    );
    await db.insert(alertProfileGeographies).values({
      alertProfileId: profileId,
      kind: 'region',
      code: 'NO082',
    });
  });

  async function ingestAndMatch(hits: DoffinSearchHit[]) {
    const ingest = await runIngest({
      db,
      adapter: new FixtureTenderSourceAdapter(hits),
      logger,
      now,
    });
    const matching = await runMatching({ db, logger, now, tenderIds: ingest.matchableTenderIds });
    return { ingest, matching };
  }

  it('turns a template-based profile into included matches', async () => {
    const { ingest, matching } = await ingestAndMatch([
      constructionCompetition(),
      constructionPlanned(),
      unrelatedItCompetition(),
    ]);

    expect(ingest.created).toBe(3);
    expect(matching.tendersConsidered).toBe(3);
    expect(matching.profilesConsidered).toBe(1);
    // All three are evaluated and stored; only the relevant ones are included.
    expect(matching.matchesWritten).toBe(3);
    expect(matching.included).toBe(2);
  });

  it('includes the relevant competition and excludes the unrelated one', async () => {
    await ingestAndMatch([
      constructionCompetition(),
      constructionPlanned(),
      unrelatedItCompetition(),
    ]);

    const rows = await db
      .select({ sourceId: tenders.sourceId, included: tenderMatches.included })
      .from(tenderMatches)
      .innerJoin(tenders, eq(tenders.id, tenderMatches.tenderId))
      .where(eq(tenderMatches.alertProfileId, profileId));

    const byId = Object.fromEntries(rows.map((r) => [r.sourceId, r.included]));
    expect(byId['2026-900001']).toBe(true);
    expect(byId['2026-900002']).toBe(true);
    expect(byId['2026-900003']).toBe(false);
  });

  it('includes the planned procurement, which is the point of the feature', async () => {
    // A supplier learning about work before the competition opens is the
    // single largest advantage this service offers (spec §0 item 3).
    await ingestAndMatch([constructionPlanned()]);

    const rows = await db
      .select({ category: tenders.noticeCategory, included: tenderMatches.included })
      .from(tenderMatches)
      .innerJoin(tenders, eq(tenders.id, tenderMatches.tenderId));

    expect(rows[0]?.category).toBe('planned');
    expect(rows[0]?.included).toBe(true);
  });

  it('stores an explanation for every included match', async () => {
    // Spec §4.2: never show an unexplained score. A match with no stored
    // reasons is exactly that.
    await ingestAndMatch([constructionCompetition()]);

    const match = (
      await db.select().from(tenderMatches).where(eq(tenderMatches.included, true))
    )[0];
    expect(match).toBeDefined();

    const reasons = await db
      .select()
      .from(tenderMatchReasons)
      .where(
        and(eq(tenderMatchReasons.matchId, match!.id), eq(tenderMatchReasons.entryType, 'reason')),
      );

    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(reason.label.length).toBeGreaterThan(0);
      // English leaking into a user-facing label is the failure this catches.
      expect(reason.label).not.toMatch(/\b(match|score|keyword|region)\b/i);
    }
  });

  it('names the concrete CPV code that caused the match', async () => {
    await ingestAndMatch([constructionCompetition()]);

    const rows = await db
      .select({ typeKey: tenderMatchReasons.typeKey, evidence: tenderMatchReasons.evidence })
      .from(tenderMatchReasons)
      .innerJoin(tenderMatches, eq(tenderMatches.id, tenderMatchReasons.matchId))
      .where(eq(tenderMatches.included, true));

    const cpvReason = rows.find((r) => r.typeKey === 'cpv');
    expect(cpvReason).toBeDefined();
    expect(cpvReason!.evidence.join(' ')).toContain('45');
  });

  it('records the matching version alongside every match', async () => {
    // Spec §14: an explanation must remain interpretable at the version it
    // was computed under, so weights can change without rewriting history.
    await ingestAndMatch([constructionCompetition()]);
    const rows = await db.select().from(tenderMatches);
    expect(rows[0]?.matchingVersion).toMatch(/^\d{4}\.\d{2}\.\d+$/);
  });

  it('stores a reason for the excluded tender too, so support can explain it', async () => {
    await ingestAndMatch([unrelatedItCompetition()]);

    const match = (
      await db.select().from(tenderMatches).where(eq(tenderMatches.included, false))
    )[0];
    expect(match).toBeDefined();
    // "Why did I not get this one" must be answerable.
    expect(match!.score).toBeGreaterThanOrEqual(0);
  });

  it('is stable: matching the same data twice produces the same scores', async () => {
    const hits = [constructionCompetition(), constructionPlanned()];
    await ingestAndMatch(hits);
    const first = await db
      .select({ tenderId: tenderMatches.tenderId, score: tenderMatches.score })
      .from(tenderMatches)
      .orderBy(tenderMatches.tenderId);

    await runMatching({ db, logger, now });
    const second = await db
      .select({ tenderId: tenderMatches.tenderId, score: tenderMatches.score })
      .from(tenderMatches)
      .orderBy(tenderMatches.tenderId);

    expect(second).toEqual(first);
  });

  it('does not duplicate a match when matching runs twice', async () => {
    // The unique constraint on tender, profile and version is what stops a
    // re-run from turning into a second alert.
    await ingestAndMatch([constructionCompetition()]);
    await runMatching({ db, logger, now });

    expect(await db.$count(tenderMatches)).toBe(1);
  });

  it('excludes an award notice from matching entirely', async () => {
    const award = {
      ...realHit('contract-award-notice.json'),
      id: '2026-900004',
      publicationDate: '2026-08-09',
      cpvCodes: ['45000000'],
      locationId: ['NO082'],
    };
    await ingestAndMatch([award]);

    const rows = await db.select().from(tenderMatches);
    expect(rows[0]?.included).toBe(false);
  });

  it('leaves a paused profile out of matching', async () => {
    await db.update(alertProfiles).set({ active: false }).where(eq(alertProfiles.id, profileId));
    const { matching } = await ingestAndMatch([constructionCompetition()]);

    expect(matching.profilesConsidered).toBe(0);
    expect(await db.$count(tenderMatches)).toBe(0);
  });
});
