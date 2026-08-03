import type { AlertProfile, Tender } from '@luma/domain';

/**
 * Test fixtures for the matching engine.
 *
 * Exported as `@luma/matching/testing` so that other packages can exercise the
 * engine against the same tenders instead of inventing their own, which is how
 * two test suites end up disagreeing about what a realistic notice looks like.
 * Nothing in the runtime path imports this module.
 *
 * The tenders are modelled on real Norwegian notices: a cleaning framework
 * agreement, a ventilation refurbishment published as a prior information
 * notice, an award notice, and an IT consultancy framework.
 */

/** A fixed instant every fixture is dated relative to: 2026-08-03T09:00:00Z. */
export const FIXED_NOW = new Date('2026-08-03T09:00:00.000Z');

function daysFromNow(days: number): Date {
  return new Date(FIXED_NOW.getTime() + days * 86_400_000);
}

const BASE_TENDER: Tender = {
  id: '11111111-1111-4111-8111-111111111111',
  source: 'doffin',
  sourceId: 'doffin-000000',
  sourceUrl: 'https://doffin.no/notices/000000',
  title: 'Kunngjøring',
  buyerName: 'Offentlig virksomhet',
  cpvCodes: [],
  regions: [],
  municipalities: [],
  noticeCategory: 'competition',
  publishedAt: daysFromNow(-3),
  status: 'open',
  sourcePayloadHash: 'hash-000000',
  rawPayload: {},
  createdAt: daysFromNow(-3),
  updatedAt: daysFromNow(-3),
  lastSyncedAt: FIXED_NOW,
};

export function makeTender(overrides: Partial<Tender> = {}): Tender {
  return { ...BASE_TENDER, ...overrides };
}

const BASE_PROFILE: AlertProfile = {
  id: '22222222-2222-4222-8222-222222222222',
  userId: '33333333-3333-4333-8333-333333333333',
  name: 'Varslingsprofil',
  active: true,
  cpvInclude: [],
  cpvExclude: [],
  keywordsInclude: [],
  keywordsExclude: [],
  regionsInclude: [],
  municipalitiesInclude: [],
  buyerInclude: [],
  buyerExclude: [],
  noticeTypes: [],
  includePlannedProcurements: true,
  procedureTypes: [],
  frequency: 'daily',
  digestHourLocal: 7,
  timezone: 'Europe/Oslo',
  minimumMatchScore: 40,
  createdAt: daysFromNow(-60),
  updatedAt: daysFromNow(-60),
};

export function makeProfile(overrides: Partial<AlertProfile> = {}): AlertProfile {
  return { ...BASE_PROFILE, ...overrides };
}

/* -------------------------------------------------------------------------- */
/* Golden corpus                                                              */
/* -------------------------------------------------------------------------- */

export const CLEANING_FRAMEWORK: Tender = makeTender({
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  sourceId: 'doffin-2026-014392',
  noticeId: '2026/S 148-014392',
  sourceUrl: 'https://doffin.no/notices/2026-014392',
  title: 'Rammeavtale for renhold av kommunale bygg',
  description:
    'Bærum kommune inviterer til konkurranse om rammeavtale for daglig renhold og periodisk renhold av skoler, barnehager og administrasjonsbygg. Avtalen har en varighet på to år med opsjon på ett pluss ett år. Leverandøren skal levere renholdstjenester etter NS-INSTA 800.',
  buyerName: 'Bærum kommune',
  buyerOrganizationNumber: '935 478 715',
  cpvCodes: ['90910000', '90911200'],
  regions: ['Akershus'],
  municipalities: ['Bærum'],
  noticeType: 'Kunngjøring av konkurranse',
  noticeCategory: 'competition',
  procedureType: 'Åpen anbudskonkurranse',
  // Doffin returns a single scalar, so both bounds carry the same figure.
  estimatedValueMinNok: 14_000_000,
  estimatedValueMaxNok: 14_000_000,
  currency: 'NOK',
  publishedAt: daysFromNow(-4),
  deadlineAt: daysFromNow(31),
  sourcePayloadHash: 'hash-2026-014392',
});

/**
 * A nationwide framework agreement. `anyw` is Doffin's literal `locationId`
 * for "whole country" and is its most common geography value; it also has no
 * stated value, which is the majority case at 53%.
 */
export const NATIONWIDE_CLEANING: Tender = makeTender({
  id: 'aaaaaaaa-0000-4000-8000-000000000005',
  sourceId: 'doffin-2026-014720',
  sourceUrl: 'https://doffin.no/notices/2026-014720',
  title: 'Rammeavtale for renholdstjenester til statlige virksomheter',
  description:
    'Statens innkjøpssenter inngår rammeavtale om renhold for statlige virksomheter i hele landet. Leveransen omfatter daglig renhold etter NS-INSTA 800 og periodisk renhold.',
  buyerName: 'Statens innkjøpssenter',
  buyerOrganizationNumber: '986 252 932',
  cpvCodes: ['90910000'],
  regions: ['anyw'],
  noticeType: 'Kunngjøring av konkurranse',
  noticeCategory: 'competition',
  procedureType: 'Åpen anbudskonkurranse',
  publishedAt: daysFromNow(-2),
  deadlineAt: daysFromNow(24),
  sourcePayloadHash: 'hash-2026-014720',
});

/**
 * An intensjonskunngjøring. Doffin rolls these up under `RESULT` next to real
 * awards and they name the intended supplier, but spec section 13 classifies
 * them as `planned`. The winner data sits in `rawPayload` precisely so tests
 * can prove the award exclusion ignores it.
 */
export const INTENT_NOTICE: Tender = makeTender({
  id: 'aaaaaaaa-0000-4000-8000-000000000006',
  sourceId: 'doffin-2026-014655',
  sourceUrl: 'https://doffin.no/notices/2026-014655',
  title: 'Intensjonskunngjøring: renhold av rådhuset',
  description:
    'Bærum kommune har til hensikt å inngå kontrakt om renhold av rådhuset uten forutgående kunngjøring av konkurranse.',
  buyerName: 'Bærum kommune',
  cpvCodes: ['90910000'],
  regions: ['Akershus'],
  municipalities: ['Bærum'],
  noticeType: 'Intensjonskunngjøring',
  noticeCategory: 'planned',
  status: 'unknown',
  publishedAt: daysFromNow(-1),
  sourcePayloadHash: 'hash-2026-014655',
  rawPayload: { lots: [{ winner: [{ name: 'Et renholdsfirma AS' }] }] },
});

export const PLANNED_VENTILATION: Tender = makeTender({
  id: 'aaaaaaaa-0000-4000-8000-000000000002',
  sourceId: 'doffin-2026-014501',
  sourceUrl: 'https://doffin.no/notices/2026-014501',
  title: 'Veiledende kunngjøring: rehabilitering av ventilasjonsanlegg',
  description:
    'Oslo kommune varsler en kommende anskaffelse av rehabilitering av ventilasjonsanlegg i fire skolebygg. Konkurransen ventes kunngjort i fjerde kvartal. Formålet med denne kunngjøringen er å gi markedet tid til å forberede seg.',
  buyerName: 'Oslo kommune, Utdanningsetaten',
  buyerOrganizationNumber: '976 820 037',
  cpvCodes: ['45331200'],
  // Doffin exposes NUTS-3 at finest, so a real notice carries no municipality.
  regions: ['Oslo'],
  municipalities: [],
  noticeType: 'Veiledende kunngjøring',
  noticeCategory: 'planned',
  publishedAt: daysFromNow(-1),
  sourcePayloadHash: 'hash-2026-014501',
});

export const AWARDED_ROADWORK: Tender = makeTender({
  id: 'aaaaaaaa-0000-4000-8000-000000000003',
  sourceId: 'doffin-2026-013880',
  sourceUrl: 'https://doffin.no/notices/2026-013880',
  title: 'Tildeling: drift og vedlikehold av kommunale veier',
  description:
    'Kontrakt for drift og vedlikehold av kommunale veier er tildelt. Kontraktsverdi og leverandør framgår av kunngjøringen.',
  buyerName: 'Trondheim kommune',
  cpvCodes: ['45233141'],
  regions: ['Trøndelag'],
  municipalities: ['Trondheim'],
  noticeType: 'Kunngjøring av kontraktstildeling',
  noticeCategory: 'award',
  status: 'awarded',
  publishedAt: daysFromNow(-6),
  sourcePayloadHash: 'hash-2026-013880',
});

export const IT_CONSULTANCY: Tender = makeTender({
  id: 'aaaaaaaa-0000-4000-8000-000000000004',
  sourceId: 'doffin-2026-014610',
  sourceUrl: 'https://doffin.no/notices/2026-014610',
  title: 'Rammeavtale IT-konsulenttjenester og systemutvikling',
  description:
    'Sykehusinnkjøp HF skal inngå rammeavtale om IT-konsulenttjenester innen systemutvikling, arkitektur og test. Avtalen omfatter bistand til pågående moderniseringsarbeid i spesialisthelsetjenesten.',
  buyerName: 'Sykehusinnkjøp HF',
  buyerOrganizationNumber: '916 879 067',
  cpvCodes: ['72000000', '72200000'],
  regions: ['Nordland'],
  municipalities: ['Vefsn'],
  noticeType: 'Kunngjøring av konkurranse',
  noticeCategory: 'competition',
  procedureType: 'Konkurranse med forhandling',
  estimatedValueMinNok: 40_000_000,
  estimatedValueMaxNok: 40_000_000,
  currency: 'NOK',
  publishedAt: daysFromNow(-2),
  deadlineAt: daysFromNow(9),
  sourcePayloadHash: 'hash-2026-014610',
});

export const CLEANING_PROFILE: AlertProfile = makeProfile({
  id: 'bbbbbbbb-0000-4000-8000-000000000001',
  name: 'Renhold Akershus',
  cpvInclude: ['90910000'],
  keywordsInclude: ['renhold', 'rammeavtale', 'NS-INSTA 800'],
  keywordsExclude: ['vinduspuss'],
  regionsInclude: ['Akershus'],
  municipalitiesInclude: ['Bærum', 'Asker'],
  buyerInclude: ['Bærum kommune'],
  procedureTypes: ['Åpen anbudskonkurranse'],
  estimatedValueMinNok: 5_000_000,
  estimatedValueMaxNok: 25_000_000,
  deadlineMinimumDays: 10,
  minimumMatchScore: 40,
});

export const VENTILATION_PROFILE: AlertProfile = makeProfile({
  id: 'bbbbbbbb-0000-4000-8000-000000000002',
  name: 'Ventilasjon Oslo',
  cpvInclude: ['45300000'],
  keywordsInclude: ['ventilasjon', 'rehabilitering'],
  regionsInclude: ['Oslo'],
  minimumMatchScore: 30,
});

export const IT_PROFILE: AlertProfile = makeProfile({
  id: 'bbbbbbbb-0000-4000-8000-000000000003',
  name: 'IT og systemutvikling',
  cpvInclude: ['72200000'],
  keywordsInclude: ['systemutvikling', 'arkitektur'],
  estimatedValueMinNok: 1_000_000,
  estimatedValueMaxNok: 20_000_000,
  minimumMatchScore: 40,
});

export interface GoldenCase {
  readonly name: string;
  readonly tender: Tender;
  readonly profile: AlertProfile;
}

/**
 * The pairs pinned by the golden-file test. Each one exercises a distinct
 * shape: a strong ordinary match, an early-warning planned notice, an award
 * notice that must be excluded, a value-range exclusion, and a profile whose
 * geography rules the tender out.
 */
export const GOLDEN_CASES: readonly GoldenCase[] = [
  { name: 'renhold: sterk match', tender: CLEANING_FRAMEWORK, profile: CLEANING_PROFILE },
  { name: 'planlagt ventilasjon', tender: PLANNED_VENTILATION, profile: VENTILATION_PROFILE },
  { name: 'tildeling ekskluderes', tender: AWARDED_ROADWORK, profile: CLEANING_PROFILE },
  { name: 'IT over verdiintervall', tender: IT_CONSULTANCY, profile: IT_PROFILE },
  { name: 'renhold utenfor geografi', tender: CLEANING_FRAMEWORK, profile: VENTILATION_PROFILE },
  { name: 'landsdekkende uten verdi', tender: NATIONWIDE_CLEANING, profile: CLEANING_PROFILE },
  { name: 'intensjonskunngjøring', tender: INTENT_NOTICE, profile: CLEANING_PROFILE },
];
