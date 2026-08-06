import type {
  AlertProfile,
  ConsentEvent,
  CreateOrderInput,
  EditorialRecommendation,
  MatchResult,
  NotificationPreferences,
  Tender,
  TenderChangeEvent,
} from '@luma/domain';
import type { LinkContext, SenderIdentity, TenderCardItem, TenderChangeItem } from '../types.js';

/**
 * Realistic fixtures, shared by the snapshot suite and available to other
 * packages that need to render a preview.
 *
 * Realistic matters here. A snapshot suite built on "Test tender 1" makes copy
 * changes reviewable in theory only; Norwegian buyer names, plausible CPV
 * codes and a genuine mix of competitions and planned procurements make the
 * snapshot diff something a Norwegian speaker can actually read and judge.
 *
 * The data is invented, not copied from Doffin. Fixed UUIDs and fixed dates
 * keep the snapshots stable.
 */

export const FIXED_NOW = new Date('2026-03-12T08:00:00.000Z');

export const SENDER: SenderIdentity = {
  name: 'Luma Training AS',
  postalAddress: 'Storgata 1, 0155 Oslo',
  contactEmail: 'anbudsvarsling@luma-training.com',
};

export const LINK_CONTEXT: LinkContext = {
  appUrl: 'https://luma-training.com/anbudsvarsling',
  privacyUrl: 'https://luma-training.com/personvern',
  termsUrl: 'https://luma-training.com/anbudsvarsling/vilkar',
  actionToken: 'tok_7d1f2b6c9a',
  medium: 'digest',
};

export const PREFERENCES_PROMOTION_ON: NotificationPreferences = {
  tenderAlertsEnabled: true,
  immediateAlertsEnabled: false,
  digestEnabled: true,
  includeLumaPromotionsInTenderEmails: true,
  marketingEmailConsent: false,
};

export const PREFERENCES_PROMOTION_OFF: NotificationPreferences = {
  ...PREFERENCES_PROMOTION_ON,
  includeLumaPromotionsInTenderEmails: false,
};

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';

function tender(
  input: Partial<Tender> & Pick<Tender, 'id' | 'title' | 'buyerName' | 'sourceId'>,
): Tender {
  return {
    source: 'doffin',
    sourceUrl: `https://doffin.no/notices/${input.sourceId}`,
    noticeCategory: 'competition',
    cpvCodes: [],
    regions: [],
    municipalities: [],
    status: 'open',
    publishedAt: new Date('2026-03-10T09:00:00.000Z'),
    sourcePayloadHash: `hash-${input.sourceId}`,
    rawPayload: {},
    createdAt: new Date('2026-03-10T09:05:00.000Z'),
    updatedAt: new Date('2026-03-10T09:05:00.000Z'),
    lastSyncedAt: new Date('2026-03-12T06:00:00.000Z'),
    ...input,
  };
}

function match(input: Partial<MatchResult> & Pick<MatchResult, 'tenderId'>): MatchResult {
  return {
    alertProfileId: PROFILE_ID,
    score: 78,
    confidence: 'high',
    included: true,
    reasons: [],
    exclusions: [],
    matchingVersion: '1.0.0',
    ...input,
  };
}

export const COMPETITION_TENDERS: readonly Tender[] = [
  tender({
    id: '22222222-2222-4222-8222-000000000001',
    sourceId: '2026-401233',
    noticeId: '2026/S 049-140233',
    title: 'Rehabilitering av Bjørnsletta skole – bygg og tekniske fag',
    description:
      'Totalentreprise for rehabilitering av skolebygg fra 1974, inkludert fasade, ventilasjon og våtrom.',
    buyerName: 'Oslo kommune, Utdanningsetaten',
    buyerOrganizationNumber: '976820037',
    cpvCodes: ['45214210', '45331000'],
    regions: ['NO081'],
    municipalities: ['0301'],
    noticeType: 'ContractNotice',
    procedureType: 'Åpen anbudskonkurranse',
    estimatedValueMinNok: 42000000,
    estimatedValueMaxNok: 48000000,
    currency: 'NOK',
    deadlineAt: new Date('2026-04-15T10:00:00.000Z'),
  }),
  tender({
    id: '22222222-2222-4222-8222-000000000002',
    sourceId: '2026-401288',
    title: 'Rammeavtale for tømrertjenester',
    description: 'Rammeavtale på to år med opsjon på ett pluss ett år.',
    buyerName: 'Bærum kommune',
    buyerOrganizationNumber: '935478715',
    cpvCodes: ['45422100'],
    regions: ['NO082'],
    municipalities: ['3201'],
    noticeType: 'ContractNotice',
    procedureType: 'Åpen anbudskonkurranse',
    estimatedValueMinNok: 8000000,
    currency: 'NOK',
    publishedAt: new Date('2026-03-11T07:30:00.000Z'),
    deadlineAt: new Date('2026-04-02T12:00:00.000Z'),
  }),
];

export const PLANNED_TENDERS: readonly Tender[] = [
  tender({
    id: '33333333-3333-4333-8333-000000000001',
    sourceId: '2026-401301',
    title: 'Veiledende kunngjøring: nytt sykehjem i Groruddalen',
    description:
      'Oppdragsgiver vurderer å kunngjøre totalentreprise for nytt sykehjem med 96 plasser i løpet av høsten 2026.',
    buyerName: 'Oslo kommune, Omsorgsbygg',
    cpvCodes: ['45215210'],
    regions: ['NO081'],
    municipalities: ['0301'],
    noticeCategory: 'planned',
    noticeType: 'PriorInformationNotice',
    estimatedValueMinNok: 300000000,
    currency: 'NOK',
    publishedAt: new Date('2026-03-09T11:00:00.000Z'),
    status: 'unknown',
  }),
];

export const COMPETITION_ITEMS: readonly TenderCardItem[] = [
  {
    tender: COMPETITION_TENDERS[0] as Tender,
    match: match({
      tenderId: '22222222-2222-4222-8222-000000000001',
      score: 86,
      confidence: 'high',
      reasons: [
        {
          type: 'cpv',
          label: 'Matcher CPV-kodene i varslingsprofilen',
          contribution: 40,
          evidence: ['45214210', '45331000'],
        },
        {
          type: 'geography',
          label: 'Ligger i området du følger',
          contribution: 25,
          evidence: ['Oslo'],
        },
        {
          type: 'keyword',
          label: 'Inneholder søkeordene dine',
          contribution: 15,
          evidence: ['rehabilitering', 'skole'],
        },
        {
          type: 'value',
          label: 'Verdien ligger innenfor intervallet ditt',
          contribution: 6,
          evidence: ['42 000 000–48 000 000 NOK'],
        },
      ],
    }),
  },
  {
    tender: COMPETITION_TENDERS[1] as Tender,
    match: match({
      tenderId: '22222222-2222-4222-8222-000000000002',
      score: 61,
      confidence: 'medium',
      reasons: [
        {
          type: 'cpv',
          label: 'Matcher CPV-kodene i varslingsprofilen',
          contribution: 30,
          evidence: ['45422100'],
        },
        {
          type: 'geography',
          label: 'Ligger i området du følger',
          contribution: 20,
          evidence: ['Akershus'],
        },
      ],
    }),
  },
];

export const PLANNED_ITEMS: readonly TenderCardItem[] = [
  {
    tender: PLANNED_TENDERS[0] as Tender,
    match: match({
      tenderId: '33333333-3333-4333-8333-000000000001',
      score: 54,
      confidence: 'medium',
      reasons: [
        {
          type: 'notice_type',
          label: 'Planlagt anskaffelse i en kategori du følger',
          contribution: 22,
          evidence: ['Veiledende kunngjøring'],
        },
        {
          type: 'geography',
          label: 'Ligger i området du følger',
          contribution: 20,
          evidence: ['Oslo'],
        },
      ],
    }),
  },
];

const CHANGE_EVENTS: readonly TenderChangeEvent[] = [
  {
    id: '44444444-4444-4444-8444-000000000001',
    tenderId: '22222222-2222-4222-8222-000000000002',
    kind: 'deadline_changed',
    summary: 'Fristen er flyttet',
    previousValue: '26. mars 2026 kl. 12:00',
    currentValue: '2. april 2026 kl. 12:00',
    detectedAt: new Date('2026-03-12T05:15:00.000Z'),
    sourceRevision: '3',
  },
  {
    id: '44444444-4444-4444-8444-000000000002',
    tenderId: '22222222-2222-4222-8222-000000000002',
    kind: 'attachment_or_revision_changed',
    summary: 'Konkurransegrunnlaget er oppdatert',
    detectedAt: new Date('2026-03-12T05:15:00.000Z'),
    sourceRevision: '3',
  },
];

export const CHANGE_ITEM: TenderChangeItem = {
  tender: COMPETITION_TENDERS[1] as Tender,
  changes: CHANGE_EVENTS,
};

export const ALERT_PROFILE: AlertProfile = {
  id: PROFILE_ID,
  userId: '55555555-5555-4555-8555-000000000001',
  name: 'Bygg og rehabilitering',
  description: 'Rehabilitering og tømrerarbeid i Oslo og Akershus.',
  active: true,
  cpvInclude: ['45214210', '45331000', '45422100'],
  cpvExclude: ['45233140'],
  keywordsInclude: ['rehabilitering', 'tømrer', 'skole'],
  keywordsExclude: ['snørydding'],
  regionsInclude: ['NO081', 'NO082'],
  municipalitiesInclude: [],
  buyerInclude: [],
  buyerExclude: ['Forsvarsbygg'],
  noticeTypes: [],
  includePlannedProcurements: true,
  procedureTypes: [],
  estimatedValueMinNok: 2000000,
  estimatedValueMaxNok: 60000000,
  deadlineMinimumDays: 10,
  frequency: 'daily',
  digestHourLocal: 7,
  timezone: 'Europe/Oslo',
  minimumMatchScore: 45,
  createdAt: new Date('2026-01-08T10:00:00.000Z'),
  updatedAt: new Date('2026-02-20T14:30:00.000Z'),
};

/** Level 2, national. The default digest promotion (spec section 23.1). */
export const PAAFYLL_RECOMMENDATION: EditorialRecommendation = {
  id: '66666666-6666-4666-8666-000000000002',
  title: 'Påfyll: månedlig fagbrev om offentlige anskaffelser',
  description:
    'Ett brev i måneden med gjennomgang av konkrete konkurranser, tildelingskriterier og hva som skiller et godt tilbud fra et middelmådig. 395 kroner per måned eks. mva.',
  url: 'https://luma-training.com/paafyll',
  placement: 'digest_footer',
  relevanceTags: ['bygg', 'anskaffelser'],
  ladderLevel: 2,
  regionScope: 'national',
  marketingCategory: 'paid_newsletter',
  isPaid: true,
  active: true,
  createdAt: new Date('2026-01-02T09:00:00.000Z'),
  updatedAt: new Date('2026-01-02T09:00:00.000Z'),
};

/** Level 1, national. What a new user meets first. */
export const GUIDE_RECOMMENDATION: EditorialRecommendation = {
  id: '66666666-6666-4666-8666-000000000001',
  title: 'Gratis guide: slik leser du et konkurransegrunnlag',
  description:
    'En praktisk gjennomgang av kvalifikasjonskrav, tildelingskriterier og de vanligste avvisningsgrunnene. Tolv sider, ingen registrering.',
  url: 'https://luma-training.com/guider/konkurransegrunnlag',
  placement: 'digest_footer',
  relevanceTags: ['anskaffelser'],
  ladderLevel: 1,
  regionScope: 'national',
  marketingCategory: 'free_guide',
  isPaid: false,
  active: true,
  createdAt: new Date('2026-01-02T09:00:00.000Z'),
  updatedAt: new Date('2026-01-02T09:00:00.000Z'),
};

/** Level 4, Oslo only (spec section 23.2). */
export const FULL_DAY_COURSE_RECOMMENDATION: EditorialRecommendation = {
  id: '66666666-6666-4666-8666-000000000004',
  title: 'Heldagskurs i Oslo: Vinn flere anbud med AI',
  description:
    'En dag med praktisk arbeid i egne konkurranser, sammen med andre som jobber med tilbud. 14 500 kroner eks. mva.',
  url: 'https://luma-training.com/kurs/vinn-flere-anbud-med-ai',
  placement: 'digest_footer',
  relevanceTags: ['kurs'],
  ladderLevel: 4,
  regionScope: 'oslo_region',
  marketingCategory: 'course',
  isPaid: true,
  active: true,
  createdAt: new Date('2026-01-02T09:00:00.000Z'),
  updatedAt: new Date('2026-01-02T09:00:00.000Z'),
};

export const RECOMMENDATIONS: readonly EditorialRecommendation[] = [
  GUIDE_RECOMMENDATION,
  PAAFYLL_RECOMMENDATION,
  FULL_DAY_COURSE_RECOMMENDATION,
];

export const OSLO_REGION_CODES: readonly string[] = ['NO081', 'NO082'];

export const ORDER_INPUT: CreateOrderInput = {
  productCode: 'paafyll',
  productName: 'Påfyll – månedlig fagbrev',
  billingCompanyName: 'Nordvik Bygg AS',
  organizationNumber: '912345678',
  billingAddress: 'Industriveien 12',
  billingPostalCode: '1481',
  billingCity: 'Hagan',
  billingCountry: 'Norge',
  invoiceEmail: 'faktura@nordvikbygg.no',
  contactPerson: 'Ingrid Nordvik',
  customerReference: 'Avd. 400',
  purchaseOrderNumber: 'PO-2026-118',
};

/**
 * An order with every optional field left out.
 *
 * The admin notification is required to print those fields anyway, so this is
 * the fixture that proves the blanks are visible rather than dropped.
 */
export const ORDER_INPUT_MINIMAL: CreateOrderInput = {
  productCode: 'heldagskurs',
  productName: 'Heldagskurs – tilbudsarbeid i praksis',
  billingCompanyName: 'Fjordvik Anlegg AS',
  billingAddress: 'Havnegata 3',
  billingPostalCode: '5003',
  billingCity: 'Bergen',
  billingCountry: 'Norge',
  invoiceEmail: 'regnskap@fjordvikanlegg.no',
  contactPerson: 'Ola Fjordvik',
};

export const ORDER_REQUEST_ID = '88888888-8888-4888-8888-000000000001';

/** `BILLING_ADMIN_EMAIL` (spec section 28.2, step 2). Not a customer address. */
export const BILLING_ADMIN_EMAIL = 'faktura@luma-training.com';

/**
 * The admin order view. Built by the caller, tagged here.
 *
 * `/anbudsvarsling/admin/…`, not §16's `/admin/anbudsvarsling/…`: a single
 * Next `basePath` can only put the prefix first, and the deviation is recorded
 * in `docs/spec-deviations.md`. A fixture spelled the other way would be a
 * template test agreeing with a URL the app cannot serve.
 */
export const ADMIN_ORDER_URL = `https://luma-training.com/anbudsvarsling/admin/bestillinger/${ORDER_REQUEST_ID}`;

export function marketingConsentEvent(overrides?: Partial<ConsentEvent>): ConsentEvent {
  return {
    id: '77777777-7777-4777-8777-000000000001',
    userId: '55555555-5555-4555-8555-000000000001',
    consentType: 'marketing_email',
    status: 'granted',
    source: 'account_settings',
    consentTextVersion: '2026-01-15',
    occurredAt: new Date('2026-02-01T12:00:00.000Z'),
    createdAt: new Date('2026-02-01T12:00:00.000Z'),
    ...overrides,
  };
}

export const RECIPIENT_EMAIL = 'ingrid.nordvik@nordvikbygg.no';
