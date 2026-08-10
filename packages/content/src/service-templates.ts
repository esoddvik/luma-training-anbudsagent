import { cpvCodeSchema, supplierFormSchema } from '@luma/domain';
import { z } from 'zod';
import { SERVICE_CATEGORY_KEYS } from './service-categories.js';

/**
 * Service templates for onboarding (spec section 11.2, ADR-17).
 *
 * The templates exist for one measurable reason: spec section 9.1 sets an
 * acceptance criterion that a new user completes registration in under five
 * minutes, and picking what you deliver is the only way to fill in dozens of
 * CPV codes and keywords in one click.
 *
 * **What a template may narrow, and what it may not.** A template narrows the
 * *service* side — CPV codes, keywords, and the exclusion terms that keep the
 * neighbouring trade out. It narrows nothing on the buyer side. There is no
 * `buyerInclude` here, no notice or procedure restriction, and no CPV code
 * from a buyer-sector division, because a cleaning company sells to hospitals,
 * schools, transit operators, museums and the armed forces, and any assumption
 * about which of those it wants is wrong for most of them — invisibly wrong,
 * because the tenders simply never arrive. `no-buyer-side-assumptions.test.ts`
 * is what enforces this; the paragraph is only the explanation.
 *
 * IMPORTANT — spec section 11.2 requires this content to be reviewed by Luma
 * before launch. What follows is a considered starting point drawn from the
 * standard CPV divisions, not verified editorial content. The codes are real
 * CPV divisions; whether each one belongs in a given template is a judgment
 * only Luma can make. Once seeded, templates are edited in admin without a
 * deploy, so this file is a starting state rather than the source of truth in
 * production.
 *
 * `serviceTemplateId` is recorded on the profile for analytics only. It must
 * not influence matching beyond the values it filled in, and neither may
 * `supplierForm` or `serviceCategory` — see
 * `packages/matching/src/no-sector-assumptions.test.ts`.
 */

export const serviceTemplateSeedSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  sortOrder: z.number().int(),
  /** The one segmentation key. Must be a key from `SERVICE_CATEGORIES`. */
  serviceCategory: z.string().refine((key) => SERVICE_CATEGORY_KEYS.includes(key), {
    message: 'not a known service category key',
  }),
  /** Weights onboarding and groups analysis. Never reaches matching (ADR-17). */
  supplierForm: supplierFormSchema,
  /** One sentence shown during onboarding, written for this template's form. */
  onboardingHint: z.string().min(1),
  cpvInclude: z.array(cpvCodeSchema).min(1),
  cpvExclude: z.array(cpvCodeSchema),
  keywordsInclude: z.array(z.string().min(2)).min(1),
  keywordsExclude: z.array(z.string().min(2)),
  /** Why these exclusions are here, so a future editor does not undo them blindly. */
  exclusionRationale: z.string().min(1),
});

export type ServiceTemplateSeed = z.infer<typeof serviceTemplateSeedSchema>;

export const SERVICE_TEMPLATE_SEEDS: readonly ServiceTemplateSeed[] = [
  {
    slug: 'bygg-og-anlegg-utforende',
    name: 'Bygg og anlegg, utførende',
    description:
      'For entreprenører som bygger, rehabiliterer og vedlikeholder bygg, veier og annen infrastruktur.',
    sortOrder: 1,
    serviceCategory: 'bygg-og-anlegg',
    supplierForm: 'sector_bound',
    onboardingHint:
      'Sett geografi og terskelverdier først – de avgjør mest for en entreprenør. Har du faste oppdragsgivere, kan du legge dem til, men la kjøperfeltene stå tomme hvis du er i tvil.',
    cpvInclude: [
      '45000000', // Construction work
      '45100000', // Site preparation work
      '45200000', // Works for complete or part construction and civil engineering
      '45400000', // Building completion work
      '45500000', // Hire of construction and civil engineering machinery with operator
    ],
    cpvExclude: [
      '71000000', // Architectural and engineering services: advisory, not contracting
    ],
    keywordsInclude: [
      'entreprise',
      'totalentreprise',
      'hovedentreprise',
      'rehabilitering',
      'nybygg',
      'ombygging',
      'grunnarbeider',
      'betongarbeider',
      'riving',
      'rammeavtale bygg',
    ],
    keywordsExclude: ['prosjektering', 'byggeledelse', 'uavhengig kontroll'],
    exclusionRationale:
      'Rådgivnings- og prosjekteringsoppdrag lyses ofte ut med samme CPV-hovedgruppe som utførende arbeid. Entreprenører som ikke selger rådgivning får dette som støy.',
  },
  {
    slug: 'radgivende-ingeniortjenester',
    name: 'Rådgivende ingeniørtjenester',
    description:
      'For rådgivere som leverer prosjektering, byggeledelse, utredninger og teknisk kontroll.',
    sortOrder: 2,
    serviceCategory: 'prosjektering-og-radgivning',
    supplierForm: 'sector_bound',
    onboardingHint:
      'Etterspørselen samler seg hos noen få typer oppdragsgivere. Velg fylke først, og legg eventuelt til oppdragsgivere du allerede jobber for hvis du vil spisse ytterligere.',
    cpvInclude: [
      '71000000', // Architectural, construction, engineering and inspection services
      '71200000', // Architectural and related services
      '71300000', // Engineering services
      '71500000', // Construction-related services
      '71600000', // Technical testing, analysis and consultancy services
      '79400000', // Business and management consultancy
    ],
    cpvExclude: [
      '45000000', // Construction work itself
    ],
    keywordsInclude: [
      'prosjektering',
      'rådgivning',
      'byggeledelse',
      'prosjektledelse',
      'utredning',
      'forprosjekt',
      'mulighetsstudie',
      'uavhengig kontroll',
      'teknisk rådgivning',
      'rammeavtale rådgivning',
    ],
    keywordsExclude: ['totalentreprise', 'utførelse'],
    exclusionRationale:
      'Utførende entrepriser deler CPV-hierarki med rådgivning i flere kunngjøringer. Et rådgivermiljø uten utførelseskapasitet skal ikke varsles om disse.',
  },
  {
    slug: 'renhold-og-facility-management',
    name: 'Renhold og facility management',
    description:
      'For leverandører av renhold, renholdsledelse og samlet forvaltning av bygg og eiendom.',
    sortOrder: 3,
    serviceCategory: 'renhold-og-facility-management',
    supplierForm: 'cross_sector',
    onboardingHint:
      'Kundene dine kan være hvem som helst – sykehus, skoler, kollektivselskaper, Forsvaret. Bruk geografi som hovedavgrensning, og la kjøperfeltene stå tomme.',
    cpvInclude: [
      '90900000', // Cleaning and sanitation services
      '90910000', // Cleaning services
      '90911200', // Building-cleaning services
      '79993000', // Building and facilities management services
      // 98300000 «Diverse tjenester» was here and is deliberately gone. It is
      // the code a buyer picks when none of the precise ones fit, so it
      // qualified advokattjenester, frisørmøbler, lås og beslag and transport
      // av døde dyr for a cleaning company's page — every one of them a true
      // CPV match and none of them a job anyone here can bid on. See
      // `isBroadCpv` in `@luma/domain`, which is what stops the same code
      // reaching the surface through a template stored in the database.
    ],
    cpvExclude: [
      '45000000', // Construction work
    ],
    keywordsInclude: [
      'renhold',
      'renholdstjenester',
      'daglig renhold',
      'hovedrengjøring',
      'facility management',
      'vinduspuss',
      'matteservice',
      'skadedyrkontroll',
      'rammeavtale renhold',
    ],
    keywordsExclude: ['byggerenhold ved nybygg'],
    exclusionRationale:
      'Byggerenhold i en entreprise er en underleveranse i et byggeprosjekt, ikke en driftskontrakt, og har helt andre kvalifikasjonskrav.',
  },
  {
    slug: 'it-tjenester-og-konsulentbistand',
    name: 'IT-tjenester og konsulentbistand',
    description:
      'For leverandører av systemutvikling, IT-drift, skytjenester og digital rådgivning.',
    sortOrder: 4,
    serviceCategory: 'it-tjenester',
    supplierForm: 'cross_sector',
    onboardingHint:
      'Oppdragene kommer fra alle deler av offentlig sektor. Avgrens på geografi og kontraktstørrelse, ikke på hvem som kjøper.',
    cpvInclude: [
      '72000000', // IT services: consulting, software development, Internet and support
      '48000000', // Software package and information systems
      '72200000', // Software programming and consultancy services
      '72500000', // Computer-related services
      '79400000', // Business and management consultancy
    ],
    cpvExclude: [
      '30200000', // Computer equipment and supplies: hardware procurement
    ],
    keywordsInclude: [
      'systemutvikling',
      'programvare',
      'IT-konsulent',
      'konsulenttjenester',
      'skytjenester',
      'integrasjon',
      'digitalisering',
      'saksbehandlingssystem',
      'forvaltning og drift',
      'rammeavtale konsulent',
      'utviklingstjenester',
    ],
    keywordsExclude: ['kjøp av PC', 'maskinvare', 'lisenser'],
    exclusionRationale:
      'Rene innkjøp av utstyr og lisenser bruker samme CPV-område som tjenester, men er varehandel. Et utviklingsmiljø har ingen nytte av dem.',
  },
  {
    slug: 'drift-og-vedlikehold-av-eiendom',
    name: 'Drift og vedlikehold av eiendom',
    description:
      'For leverandører av vaktmestertjenester, teknisk drift og vedlikehold av bygg og uteområder.',
    sortOrder: 5,
    serviceCategory: 'drift-og-vedlikehold-av-eiendom',
    supplierForm: 'cross_sector',
    onboardingHint:
      'Bygg som skal driftes finnes overalt. Sett geografi og reisevei først, og la kjøperfeltene stå tomme.',
    cpvInclude: [
      '50000000', // Repair and maintenance services
      '50700000', // Repair and maintenance of building installations
      '45300000', // Building installation work
      '45310000', // Electrical installation work
      '45330000', // Plumbing and sanitary works
      '45331000', // Heating, ventilation and air conditioning installation
      '51000000', // Installation services
      '77300000', // Horticultural services: grounds and outdoor areas
    ],
    cpvExclude: [],
    keywordsInclude: [
      'vaktmestertjenester',
      'drift og vedlikehold',
      'eiendomsdrift',
      'serviceavtale',
      'ventilasjon',
      'VVS',
      'automasjon',
      'SD-anlegg',
      'heis',
      'brannalarm',
      'elektroinstallasjon',
    ],
    keywordsExclude: [],
    exclusionRationale:
      'Ingen standard eksklusjoner. Segmentet er bredt, og en tom eksklusjonsliste gir færre falske negativer enn en gjetning. Brukeren legger til sine egne etter første uke.',
  },
  {
    slug: 'vakthold-og-sikkerhet',
    name: 'Vakthold og sikkerhet',
    description:
      'For leverandører av vakthold, vektertjenester, alarmmottak og fysisk adgangskontroll.',
    sortOrder: 6,
    serviceCategory: 'vakthold-og-sikkerhet',
    supplierForm: 'cross_sector',
    onboardingHint:
      'Vaktoppdrag lyses ut av alt fra museer til fylkeskommuner. Geografi er den viktigste avgrensningen; hvem som kjøper sier lite.',
    cpvInclude: [
      '79700000', // Investigation and security services
      '79710000', // Security services
      '79711000', // Alarm-monitoring services
      '79713000', // Guard services
      '79714000', // Surveillance services
      '35120000', // Surveillance and security systems and devices
      '45312000', // Alarm system and antenna installation work
    ],
    cpvExclude: [
      '72000000', // IT services: information security is a different trade
    ],
    keywordsInclude: [
      'vakthold',
      'vektertjenester',
      'vekter',
      'alarmmottak',
      'kameraovervåking',
      'adgangskontroll',
      'resepsjonstjenester',
      'ordensvakt',
      'sikkerhetstjenester',
      'rammeavtale vakthold',
    ],
    keywordsExclude: ['informasjonssikkerhet', 'cybersikkerhet', 'penetrasjonstesting'],
    exclusionRationale:
      'Ordet sikkerhet dekker både fysisk vakthold og informasjonssikkerhet, og kunngjøringene deler ordbruk. Et vaktselskap uten IT-avdeling har ingen nytte av de sistnevnte.',
  },
  {
    slug: 'kantine-og-matservering',
    name: 'Kantine og matservering',
    description:
      'For leverandører som drifter kantiner, leverer catering og står for matservering hos oppdragsgiveren.',
    sortOrder: 7,
    serviceCategory: 'kantine-og-matservering',
    supplierForm: 'cross_sector',
    onboardingHint:
      'Kantiner drives hos statlige etater, sykehus, skoler og private byggeiere. Avgrens på geografi, ikke på type oppdragsgiver.',
    cpvInclude: [
      '55000000', // Hotel, restaurant and retail trade services
      '55300000', // Restaurant and food-serving services
      '55320000', // Meal-serving services
      '55500000', // Canteen and catering services
      '55510000', // Canteen services
      '55520000', // Catering services
      '55521200', // Meal delivery service
    ],
    cpvExclude: [
      '15000000', // Food, beverages and tobacco: wholesale supply, not operation
    ],
    keywordsInclude: [
      'kantinedrift',
      'kantine',
      'kantinetjenester',
      'matservering',
      'catering',
      'storkjøkken',
      'måltidslevering',
      'servering',
      'rammeavtale kantine',
    ],
    keywordsExclude: ['matvarer', 'dagligvarer', 'engroslevering'],
    exclusionRationale:
      'Innkjøp av matvarer og dagligvarer lyses ut med tilgrensende CPV-koder, men er varehandel og ikke drift av kantine. En kantineoperatør uten grossistledd får dette som støy.',
  },
  {
    slug: 'bemanning-og-rekruttering',
    name: 'Bemanning og rekruttering',
    description:
      'For bemanningsbyråer og rekrutteringsselskaper som leier ut personell eller finner faste ansatte til oppdragsgiveren.',
    sortOrder: 8,
    serviceCategory: 'bemanning-og-rekruttering',
    supplierForm: 'cross_sector',
    onboardingHint:
      'Behovet for innleie finnes i hele offentlig sektor. Bruk geografi og fagområde som avgrensning, og la kjøperfeltene stå tomme.',
    cpvInclude: [
      '79600000', // Recruitment services
      '79610000', // Placement of personnel services
      '79620000', // Supply of personnel including temporary staff
      '79621000', // Supply of office personnel
      '79624000', // Supply of nursing personnel
      '79630000', // Personnel services except placement and supply
    ],
    cpvExclude: [
      '79400000', // Business and management consultancy: a different contract
    ],
    keywordsInclude: [
      'bemanning',
      'bemanningstjenester',
      'vikartjenester',
      'vikarbyrå',
      'innleie',
      'personalutleie',
      'rekruttering',
      'headhunting',
      'tilkallingsvikar',
      'rammeavtale bemanning',
    ],
    keywordsExclude: ['konsulentoppdrag', 'rådgivning'],
    exclusionRationale:
      'Konsulentkjøp og innleie av personell beskrives ofte med samme ord, men er ulike kontrakter med ulike kvalifikasjonskrav. Et bemanningsbyrå som ikke selger rådgivning får konsulentrammeavtalene som støy.',
  },
];

/** Look-up used by onboarding and by the seed script. */
export function findServiceTemplate(slug: string): ServiceTemplateSeed | undefined {
  return SERVICE_TEMPLATE_SEEDS.find((template) => template.slug === slug);
}
