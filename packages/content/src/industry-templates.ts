import { cpvCodeSchema } from '@luma/domain';
import { z } from 'zod';

/**
 * Industry templates for onboarding (spec section 11.2).
 *
 * The five templates exist for one measurable reason: spec section 9.1 sets an
 * acceptance criterion that a new user completes registration in under five
 * minutes, and picking a trade is the only way to fill in dozens of CPV codes
 * and keywords in one click.
 *
 * IMPORTANT — spec section 11.2 requires this content to be reviewed by Luma
 * before launch. What follows is a considered starting point drawn from the
 * standard CPV divisions, not verified editorial content. The codes are real
 * CPV divisions; whether each one belongs in a given trade's default profile
 * is a judgment only Luma can make. Once seeded, templates are edited in admin
 * without a deploy, so this file is a starting state rather than the source of
 * truth in production.
 *
 * `industryTemplateId` is recorded on the profile for analytics only. It must
 * not influence matching beyond the values it filled in.
 */

export const industryTemplateSeedSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  sortOrder: z.number().int(),
  cpvInclude: z.array(cpvCodeSchema).min(1),
  cpvExclude: z.array(cpvCodeSchema),
  keywordsInclude: z.array(z.string().min(2)).min(1),
  keywordsExclude: z.array(z.string().min(2)),
  /** Why these exclusions are here, so a future editor does not undo them blindly. */
  exclusionRationale: z.string().min(1),
});

export type IndustryTemplateSeed = z.infer<typeof industryTemplateSeedSchema>;

export const INDUSTRY_TEMPLATE_SEEDS: readonly IndustryTemplateSeed[] = [
  {
    slug: 'bygg-og-anlegg',
    name: 'Bygg og anlegg',
    description:
      'For entreprenører som bygger, rehabiliterer og vedlikeholder bygg, veier og annen infrastruktur.',
    sortOrder: 1,
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
    slug: 'radgivende-ingeniorer',
    name: 'Rådgivende ingeniører',
    description:
      'For rådgivere som leverer prosjektering, byggeledelse, utredninger og teknisk kontroll.',
    sortOrder: 2,
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
    slug: 'drift-renhold-og-fm',
    name: 'Drift, renhold og facility management',
    description:
      'For leverandører av renhold, drift, vaktmestertjenester og forvaltning av bygg og eiendom.',
    sortOrder: 3,
    cpvInclude: [
      '90900000', // Cleaning and sanitation services
      '90910000', // Cleaning services
      '90911200', // Building-cleaning services
      '79993000', // Building and facilities management services
      '50700000', // Repair and maintenance of building installations
      '77300000', // Horticultural services
      '98300000', // Miscellaneous services
    ],
    cpvExclude: [
      '45000000', // Construction work
    ],
    keywordsInclude: [
      'renhold',
      'renholdstjenester',
      'daglig renhold',
      'hovedrengjøring',
      'vaktmestertjenester',
      'drift og vedlikehold',
      'facility management',
      'eiendomsdrift',
      'kantine',
      'vinduspuss',
      'rammeavtale renhold',
    ],
    keywordsExclude: ['byggerenhold ved nybygg'],
    exclusionRationale:
      'Byggerenhold i en entreprise er en underleveranse i et byggeprosjekt, ikke en driftskontrakt, og har helt andre kvalifikasjonskrav.',
  },
  {
    slug: 'tekniske-tjenester',
    name: 'Tekniske tjenester',
    description:
      'For elektro, rør, ventilasjon, automasjon og annen teknisk installasjon og service.',
    sortOrder: 4,
    cpvInclude: [
      '45300000', // Building installation work
      '45310000', // Electrical installation work
      '45330000', // Plumbing and sanitary works
      '45331000', // Heating, ventilation and air conditioning installation
      '50000000', // Repair and maintenance services
      '50700000', // Repair and maintenance of building installations
      '51000000', // Installation services
      '31000000', // Electrical machinery and apparatus
    ],
    cpvExclude: [],
    keywordsInclude: [
      'elektroarbeider',
      'elektroinstallasjon',
      'rørlegger',
      'rørarbeider',
      'ventilasjon',
      'VVS',
      'automasjon',
      'SD-anlegg',
      'brannalarm',
      'adgangskontroll',
      'heis',
      'serviceavtale',
      'rammeavtale elektro',
    ],
    keywordsExclude: [],
    exclusionRationale:
      'Ingen standard eksklusjoner. Segmentet er bredt, og en tom eksklusjonsliste gir færre falske negativer enn en gjetning. Brukeren legger til sine egne etter første uke.',
  },
  {
    slug: 'it-og-konsulenttjenester',
    name: 'IT og konsulenttjenester',
    description:
      'For leverandører av systemutvikling, IT-drift, skytjenester og digital rådgivning.',
    sortOrder: 5,
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
];

/** Look-up used by onboarding and by the seed script. */
export function findIndustryTemplate(slug: string): IndustryTemplateSeed | undefined {
  return INDUSTRY_TEMPLATE_SEEDS.find((template) => template.slug === slug);
}
