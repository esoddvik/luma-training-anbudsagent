import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import * as schema from '@luma/db/schema';
import type { Database } from './db';
import {
  countMatchesByCategory,
  getTenderDetail,
  listMatchedBuyers,
  listMatches,
  listSavedTenders,
} from './tenders';
import { listProfiles, loadProfile, previewMatches } from './profiles';
import { getAccountSettings, promotionAllowed } from './settings';
import {
  OTHER_USER_EMAIL,
  PROFILE_KEYWORD,
  SHARER_EMAIL,
  seedMatch,
  seedProfile,
  seedTender,
  seedUser,
} from './testing/fixtures';

/**
 * The dashboard queries (spec section 16).
 *
 * Three things are worth an integration test rather than a unit test, because
 * all three are properties of the SQL rather than of any TypeScript:
 *
 * - a user sees only their own profiles' matches;
 * - planned procurements are separable from competitions, which is launch
 *   blocker 51.10;
 * - a dismissed match disappears unless it is asked for by name.
 */

const describeWithDatabase = hasDatabase ? describe : describe.skip;

describeWithDatabase('treffspørringene', () => {
  let harness: TestDatabase;
  let db: Database;

  let userId: string;
  let otherUserId: string;
  let profileId: string;
  let competitionId: string;
  let plannedId: string;
  let dismissedId: string;
  let suppressedId: string;

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db as unknown as Database;

    userId = (await seedUser(db, SHARER_EMAIL)).id;
    otherUserId = (await seedUser(db, OTHER_USER_EMAIL)).id;
    profileId = await seedProfile(db, { userId });

    competitionId = await seedTender(db, {
      title: 'Konkurranse om vintervedlikehold',
      buyerName: 'Alfakommune',
      noticeCategory: 'competition',
      publishedAt: new Date(Date.now() - 2 * 86_400_000),
      deadlineAt: new Date(Date.now() + 10 * 86_400_000),
      cpvCodes: ['45213316'],
      estimatedValueNok: 2_500_000,
      currency: 'NOK',
    });
    plannedId = await seedTender(db, {
      title: 'Planlagt anskaffelse av renholdstjenester',
      buyerName: 'Betakommune',
      noticeCategory: 'planned',
      publishedAt: new Date(Date.now() - 1 * 86_400_000),
      // Planlagte anskaffelser har ingen tilbudsfrist.
      deadlineAt: null,
    });
    dismissedId = await seedTender(db, {
      title: 'Konkurranse brukeren har avvist',
      buyerName: 'Gammakommune',
      noticeCategory: 'competition',
      publishedAt: new Date(Date.now() - 3 * 86_400_000),
    });
    suppressedId = await seedTender(db, {
      title: 'Ugyldig kunngjøring',
      noticeCategory: 'competition',
      suppressed: true,
    });

    for (const tenderId of [competitionId, plannedId, dismissedId, suppressedId]) {
      await seedMatch(db, { tenderId, alertProfileId: profileId });
    }

    await db.insert(schema.userTenderStates).values({
      userId,
      tenderId: dismissedId,
      state: 'dismissed',
      dismissedAt: new Date(),
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  it('viser bare treff fra brukerens egne profiler', async () => {
    const mine = await listMatches(db, { userId });
    const theirs = await listMatches(db, { userId: otherUserId });

    expect(mine.length).toBeGreaterThan(0);
    expect(theirs).toHaveLength(0);
  });

  it('sorterer nyeste kunngjøring først', async () => {
    const matches = await listMatches(db, { userId });
    const dates = matches.map((match) => match.tender.publishedAt.getTime());
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it('skiller planlagte anskaffelser fra konkurranser', async () => {
    const competitions = await listMatches(db, { userId, filters: { category: 'competition' } });
    const planned = await listMatches(db, { userId, filters: { category: 'planned' } });

    expect(competitions.map((match) => match.tender.id)).toContain(competitionId);
    expect(competitions.map((match) => match.tender.id)).not.toContain(plannedId);
    expect(planned.map((match) => match.tender.id)).toEqual([plannedId]);
    expect(planned[0]?.tender.deadlineAt).toBeNull();
  });

  it('skjuler avviste treff, men henter dem fram når de etterspørres', async () => {
    const normal = await listMatches(db, { userId });
    expect(normal.map((match) => match.tender.id)).not.toContain(dismissedId);

    const dismissed = await listMatches(db, { userId, filters: { state: 'dismissed' } });
    expect(dismissed.map((match) => match.tender.id)).toEqual([dismissedId]);
  });

  it('utelater kunngjøringer administrator har undertrykt', async () => {
    const matches = await listMatches(db, { userId });
    expect(matches.map((match) => match.tender.id)).not.toContain(suppressedId);
  });

  it('filtrerer på oppdragsgiver', async () => {
    const matches = await listMatches(db, { userId, filters: { buyer: 'Alfa' } });
    expect(matches.map((match) => match.tender.id)).toEqual([competitionId]);
  });

  it('filtrerer på CPV med hierarki, ikke bare eksakt kode', async () => {
    // Anbudet har 45213316. En profil som filtrerer på 45000000 skal treffe det.
    const broad = await listMatches(db, { userId, filters: { cpv: '45000000' } });
    expect(broad.map((match) => match.tender.id)).toContain(competitionId);

    const unrelated = await listMatches(db, { userId, filters: { cpv: '79000000' } });
    expect(unrelated).toHaveLength(0);
  });

  it('filtrerer på frist og slipper ikke gjennom kunngjøringer uten frist', async () => {
    const soon = await listMatches(db, { userId, filters: { deadlineWithinDays: 30 } });
    const ids = soon.map((match) => match.tender.id);
    expect(ids).toContain(competitionId);
    // Den planlagte har ingen frist, og et fristfilter er et utsagn om
    // konkurranser. Den skal falle ut, ikke bli med som «ukjent frist».
    expect(ids).not.toContain(plannedId);
  });

  it('lister oppdragsgivere til filteret uten duplikater', async () => {
    const buyers = await listMatchedBuyers(db, userId);
    expect(new Set(buyers).size).toBe(buyers.length);
    expect(buyers).toContain('Alfakommune');
  });

  it('teller treff per kategori uten å telle avviste', async () => {
    const counts = await countMatchesByCategory(db, userId);
    expect(counts.planned).toBe(1);
    expect(counts.competition).toBe(1);
  });

  it('bygger matchforklaringen fra de lagrede begrunnelsene', async () => {
    const detail = await getTenderDetail(db, { tenderId: competitionId, userId });
    expect(detail).not.toBeNull();
    expect(detail!.matches).toHaveLength(1);

    const explanation = detail!.matches[0]!.explanation;
    expect(explanation.confidenceText).toBe('Høy relevans');
    expect(explanation.reasons.map((reason) => reason.type).sort()).toEqual(['cpv', 'keyword']);
    // Begrunnelsen til den innloggede eieren *skal* vise verdiene bak treffet.
    // Det er den delte visningen som ikke får det.
    expect(explanation.reasons.flatMap((reason) => reason.evidence)).toContain(PROFILE_KEYWORD);
  });

  it('viser ingen matchforklaring til en bruker som ikke eier profilen', async () => {
    const detail = await getTenderDetail(db, { tenderId: competitionId, userId: otherUserId });
    expect(detail).not.toBeNull();
    expect(detail!.matches).toHaveLength(0);
  });

  it('gir null for en undertrykt kunngjøring', async () => {
    const detail = await getTenderDetail(db, { tenderId: suppressedId, userId });
    expect(detail).toBeNull();
  });

  it('lister lagrede anbud, og bare brukerens egne', async () => {
    await db.insert(schema.userTenderStates).values({
      userId,
      tenderId: competitionId,
      state: 'saved',
      savedAt: new Date(),
    });

    const saved = await listSavedTenders(db, userId);
    expect(saved.map((tender) => tender.id)).toEqual([competitionId]);
    expect(await listSavedTenders(db, otherUserId)).toHaveLength(0);
  });
});

describeWithDatabase('varslingsprofiler og forhåndsvisning', () => {
  let harness: TestDatabase;
  let db: Database;
  let userId: string;
  let profileId: string;

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db as unknown as Database;
    userId = (await seedUser(db, SHARER_EMAIL)).id;
    profileId = await seedProfile(db, { userId });

    await seedTender(db, {
      title: `Rammeavtale for ${PROFILE_KEYWORD} og tilhørende arbeid`,
      noticeCategory: 'competition',
      publishedAt: new Date(Date.now() - 5 * 86_400_000),
      cpvCodes: ['45213316'],
      regionCodes: ['NO081'],
    });
    await seedTender(db, {
      title: 'Kunngjøring som ikke har noe med profilen å gjøre',
      noticeCategory: 'competition',
      publishedAt: new Date(Date.now() - 5 * 86_400_000),
      cpvCodes: ['79000000'],
      regionCodes: ['NO0A2'],
    });
    // For gammel til å bli med i forhåndsvisningsvinduet.
    await seedTender(db, {
      title: `Gammel kunngjøring om ${PROFILE_KEYWORD}`,
      noticeCategory: 'competition',
      publishedAt: new Date(Date.now() - 200 * 86_400_000),
      cpvCodes: ['45213316'],
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  it('setter sammen profilen fra kriterietabellene', async () => {
    const profile = await loadProfile(db, { profileId, userId });
    expect(profile).not.toBeNull();
    expect(profile!.keywordsInclude).toContain(PROFILE_KEYWORD);
    expect(profile!.keywordsExclude.length).toBeGreaterThan(0);
    expect(profile!.cpvInclude).toContain('45000000');
    expect(profile!.regionsInclude).toContain('NO081');
    // Kommuner fylles aldri ut: kilden har ingen kommunefelt.
    expect(profile!.municipalitiesInclude).toEqual([]);
  });

  it('nekter å laste en annen brukers profil', async () => {
    const other = await seedUser(db, OTHER_USER_EMAIL);
    expect(await loadProfile(db, { profileId, userId: other.id })).toBeNull();
  });

  it('kjører den ekte matchemotoren i forhåndsvisningen', async () => {
    const profile = await loadProfile(db, { profileId, userId });
    const preview = await previewMatches(db, { profile: profile!, now: new Date() });

    expect(preview.candidatesConsidered).toBeGreaterThan(0);
    expect(preview.items.length).toBeGreaterThan(0);
    // Forhåndsvisningen viser bare treff som faktisk ville blitt tatt med.
    expect(preview.items.every((item) => item.result.included)).toBe(true);
    // Og bare fra vinduet: den 200 dager gamle kunngjøringen er ikke med.
    expect(preview.items.map((item) => item.title)).not.toContain(
      `Gammel kunngjøring om ${PROFILE_KEYWORD}`,
    );
  });

  it('teller treff per profil i listen', async () => {
    const profiles = await listProfiles(db, userId);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.name).toBeTypeOf('string');
    expect(profiles[0]?.matchCount).toBe(0);
  });
});

describeWithDatabase('innstillinger', () => {
  let harness: TestDatabase;
  let db: Database;
  let userId: string;

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db as unknown as Database;
    userId = (await seedUser(db, SHARER_EMAIL)).id;
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  it('bruker spec 22 sine standardvalg når brukeren ikke har lagret noe', async () => {
    const settings = await getAccountSettings(db, userId);
    expect(settings.preferences.includeLumaPromotionsInTenderEmails).toBe(true);
    expect(settings.preferences.marketingEmailConsent).toBe(false);
    expect(settings.preferences.tenderAlertsEnabled).toBe(true);
    expect(await promotionAllowed(db, userId)).toBe(true);
  });

  it('utleder markedsføringssamtykke fra siste hendelse, ikke fra en kolonne', async () => {
    await db.insert(schema.consentTextVersions).values({
      consentType: 'marketing_email',
      version: 'test-1',
      body: 'Testtekst',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });

    await db.insert(schema.consentEvents).values({
      userId,
      consentType: 'marketing_email',
      status: 'granted',
      source: 'account_settings',
      consentTextVersion: 'test-1',
      occurredAt: new Date('2026-02-01T00:00:00Z'),
    });
    expect((await getAccountSettings(db, userId)).preferences.marketingEmailConsent).toBe(true);

    // Tilbaketrekking er en ny hendelse, ikke en endring av den forrige.
    await db.insert(schema.consentEvents).values({
      userId,
      consentType: 'marketing_email',
      status: 'withdrawn',
      source: 'account_settings',
      consentTextVersion: 'test-1',
      occurredAt: new Date('2026-03-01T00:00:00Z'),
    });

    const after = await getAccountSettings(db, userId);
    expect(after.preferences.marketingEmailConsent).toBe(false);
    expect(after.marketingConsentTextVersion).toBe('test-1');

    // Begge hendelsene finnes fortsatt: loggen er append-only (ADR-9).
    const events = await db.select().from(schema.consentEvents);
    expect(events).toHaveLength(2);
  });

  it('slår av promotering uten å røre anbudsvarslene', async () => {
    await db.insert(schema.notificationPreferences).values({
      userId,
      includeLumaPromotionsInTenderEmails: false,
    });

    const settings = await getAccountSettings(db, userId);
    expect(settings.preferences.includeLumaPromotionsInTenderEmails).toBe(false);
    expect(settings.preferences.tenderAlertsEnabled).toBe(true);
    expect(await promotionAllowed(db, userId)).toBe(false);
  });
});
