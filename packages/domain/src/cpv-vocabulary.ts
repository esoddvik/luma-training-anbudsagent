import { normalizeSearchText } from './text.js';
import { cpvDepth, normalizeCpv } from './cpv.js';

/**
 * Norwegian names for the CPV codes this product actually uses.
 *
 * `cpv.ts` next door can parse a code and reason about its hierarchy, but it
 * cannot tell anyone what 90911200 *is*. Until now the only place that
 * knowledge existed was as `//` comments beside the codes in
 * `packages/content/src/service-templates.ts` — in English, invisible to the
 * running program, and therefore unable to reach a page that has to show a
 * supplier why a notice matched.
 *
 * Two deliberate limits:
 *
 * 1. **This is not the full CPV register.** The official vocabulary has some
 *    9 500 codes. This table covers the codes the eight service templates
 *    reference, plus a parent for each so a code can always be placed in a
 *    branch. Anything outside it resolves to the bare code rather than to a
 *    wrong name — see `cpvLabel`.
 * 2. **`synonyms` are supplier words, not procurement words.** They exist so
 *    that someone who types «vask av vinduer» finds 90911300, which no
 *    substring of the official name would have done. They are search input
 *    only and are never displayed.
 *
 * `packages/content/src/cpv-vocabulary-covers-seeds.test.ts` fails if a seed
 * ever introduces a code that is not in here. That test lives in `@luma/content`
 * rather than beside this file because `@luma/domain` is the bottom of the
 * dependency graph and must not import from the workspace.
 */

export interface CpvEntry {
  /** Eight digits, no check digit. */
  readonly code: string;
  /** Norwegian name, as it is shown to a reader. */
  readonly name: string;
  /** One sentence explaining what falls under the code. */
  readonly about: string;
  /** The CPV division's Norwegian name. Used as a section label. */
  readonly group: string;
  /** Plain words a supplier would type. Search only; never rendered. */
  readonly synonyms: readonly string[];
}

const BYGG = 'Bygge- og anleggsarbeid';
const IT = 'IT-tjenester';
const PROGRAMVARE = 'Programvare og informasjonssystemer';
const FORRETNING = 'Forretningstjenester';
const RENHOLD = 'Avløps-, avfalls-, renholds- og miljøtjenester';
const SERVERING = 'Hotell-, restaurant- og varehandelstjenester';
const VEDLIKEHOLD = 'Reparasjons- og vedlikeholdstjenester';
const INSTALLASJON = 'Installasjonstjenester';
const RADGIVNING = 'Arkitekt-, ingeniør- og inspeksjonstjenester';
const GARTNER = 'Jordbruks-, skogbruks- og gartnertjenester';
const SAMFUNN = 'Andre samfunnstjenester og personlige tjenester';
const SIKKERHETSUTSTYR = 'Sikkerhets-, brannvern- og forsvarsutstyr';
const DATAUTSTYR = 'Kontor- og datamaskiner, utstyr og rekvisita';
const MAT = 'Næringsmidler, drikkevarer og tobakk';
const TRANSPORT = 'Transporttjenester';

export const CPV_VOCABULARY: readonly CpvEntry[] = [
  {
    code: '15000000',
    name: 'Næringsmidler, drikkevarer og tobakk',
    about: 'Kjøp av selve matvarene og drikkevarene, ikke drift av kjøkken eller servering.',
    group: MAT,
    synonyms: ['matvarer', 'dagligvarer', 'engros', 'drikkevarer', 'mat'],
  },
  {
    code: '30000000',
    name: 'Kontor- og datamaskiner, utstyr og rekvisita',
    about: 'Innkjøp av kontorutstyr, maskiner og forbruksmateriell.',
    group: DATAUTSTYR,
    synonyms: ['kontorutstyr', 'rekvisita', 'kontormaskiner'],
  },
  {
    code: '30200000',
    name: 'Datautstyr og rekvisita',
    about: 'Maskinvare som PC-er, skjermer og tilbehør – varehandel, ikke IT-tjenester.',
    group: DATAUTSTYR,
    synonyms: ['maskinvare', 'hardware', 'pc', 'datamaskiner', 'skjermer', 'kjøp av pc'],
  },
  {
    code: '35000000',
    name: 'Sikkerhets-, brannvern- og forsvarsutstyr',
    about: 'Utstyr til sikkerhet, beredskap og forsvar, som produkt og ikke som tjeneste.',
    group: SIKKERHETSUTSTYR,
    synonyms: ['sikkerhetsutstyr', 'beredskapsutstyr', 'brannvern'],
  },
  {
    code: '35100000',
    name: 'Nød- og sikkerhetsutstyr',
    about: 'Utstyr for nødsituasjoner, varsling og personsikkerhet.',
    group: SIKKERHETSUTSTYR,
    synonyms: ['nødutstyr', 'varslingsutstyr', 'sikringsutstyr'],
  },
  {
    code: '35120000',
    name: 'Overvåkings- og sikringssystemer',
    about: 'Kameraovervåking, adgangskontroll og alarmanlegg som anskaffes som system.',
    group: SIKKERHETSUTSTYR,
    synonyms: [
      'kameraovervåking',
      'kamera',
      'videoovervåking',
      'adgangskontroll',
      'alarmanlegg',
      'sikringsanlegg',
    ],
  },
  {
    code: '45000000',
    name: 'Bygge- og anleggsarbeid',
    about: 'All utførende bygging, rehabilitering og anleggsarbeid.',
    group: BYGG,
    synonyms: [
      'bygg',
      'anlegg',
      'entreprise',
      'totalentreprise',
      'byggearbeid',
      'nybygg',
      'rehabilitering',
    ],
  },
  {
    code: '45100000',
    name: 'Grunnarbeider og klargjøring av byggeplass',
    about: 'Riving, graving, sprengning og annet arbeid før bygget reises.',
    group: BYGG,
    synonyms: ['grunnarbeider', 'graving', 'riving', 'sprengning', 'masseutskifting'],
  },
  {
    code: '45200000',
    name: 'Bygging av hele eller deler av bygg og anlegg',
    about: 'Selve oppføringen av bygg, veier, ledningsnett og andre anlegg.',
    group: BYGG,
    synonyms: ['oppføring', 'veibygging', 'betongarbeider', 'råbygg', 'anleggsarbeid'],
  },
  {
    code: '45300000',
    name: 'Tekniske installasjoner i bygg',
    about: 'Elektro, rør, ventilasjon og andre tekniske anlegg som monteres i et bygg.',
    group: BYGG,
    synonyms: ['tekniske installasjoner', 'installasjon', 'byggtekniske fag'],
  },
  {
    code: '45310000',
    name: 'Elektroinstallasjon',
    about: 'Elektriske anlegg, kabling, belysning og tilhørende montasje.',
    group: BYGG,
    synonyms: ['elektro', 'elektriker', 'elektroinstallasjon', 'belysning', 'kabling'],
  },
  {
    code: '45312000',
    name: 'Installasjon av alarm- og antenneanlegg',
    about: 'Montering av brannalarm, innbruddsalarm, kamera og antenneanlegg.',
    group: BYGG,
    synonyms: ['brannalarm', 'innbruddsalarm', 'alarmanlegg', 'antenne', 'montering av alarm'],
  },
  {
    code: '45330000',
    name: 'Rørleggerarbeid og sanitæranlegg',
    about: 'Rør, sanitær og vannbåren varme i bygg.',
    group: BYGG,
    synonyms: ['rørlegger', 'VVS', 'sanitær', 'rørarbeid', 'vann og avløp i bygg'],
  },
  {
    code: '45331000',
    name: 'Installasjon av varme, ventilasjon og kjøling',
    about: 'Montering og utskifting av varmeanlegg, ventilasjonsanlegg og kjøleanlegg.',
    group: BYGG,
    synonyms: ['ventilasjon', 'varmeanlegg', 'kjøling', 'VVS', 'luftbehandling'],
  },
  {
    code: '45400000',
    name: 'Innrednings- og ferdigstillelsesarbeid',
    about: 'Arbeidet som gjør bygget ferdig: gulv, tak, maling, innredning.',
    group: BYGG,
    synonyms: ['innredning', 'maling', 'gulvlegging', 'tømrerarbeid', 'ferdigstillelse'],
  },
  {
    code: '45500000',
    name: 'Utleie av anleggsmaskiner med fører',
    about: 'Maskiner leid ut sammen med operatør, ikke tørrleie.',
    group: BYGG,
    synonyms: ['maskinutleie', 'anleggsmaskiner', 'gravemaskin med fører', 'maskinleie'],
  },
  {
    code: '48000000',
    name: 'Programvare og informasjonssystemer',
    about: 'Anskaffelse av programvare og ferdige fagsystemer.',
    group: PROGRAMVARE,
    synonyms: ['programvare', 'software', 'fagsystem', 'lisenser', 'saksbehandlingssystem'],
  },
  {
    code: '50000000',
    name: 'Reparasjon og vedlikehold',
    about: 'Løpende vedlikehold og reparasjon av anlegg, utstyr og bygg.',
    group: VEDLIKEHOLD,
    synonyms: ['vedlikehold', 'reparasjon', 'serviceavtale', 'drift og vedlikehold'],
  },
  {
    code: '50700000',
    name: 'Reparasjon og vedlikehold av bygningsinstallasjoner',
    about: 'Service på heis, ventilasjon, varme, elektro og andre faste installasjoner.',
    group: VEDLIKEHOLD,
    synonyms: ['heis', 'ventilasjonsservice', 'eiendomsdrift', 'teknisk drift', 'SD-anlegg'],
  },
  {
    code: '51000000',
    name: 'Installasjonstjenester',
    about: 'Montering og idriftsetting av utstyr som er kjøpt separat.',
    group: INSTALLASJON,
    synonyms: ['montering', 'idriftsetting', 'installasjon av utstyr'],
  },
  {
    code: '55000000',
    name: 'Hotell-, restaurant- og varehandelstjenester',
    about: 'Overnatting, servering og tilgrensende tjenester.',
    group: SERVERING,
    synonyms: ['hotell', 'restaurant', 'overnatting', 'servering'],
  },
  {
    code: '55300000',
    name: 'Restaurant- og serveringstjenester',
    about: 'Servering av mat og drikke til gjester på stedet.',
    group: SERVERING,
    synonyms: ['servering', 'restaurantdrift', 'bevertning'],
  },
  {
    code: '55320000',
    name: 'Måltidsservering',
    about: 'Servering av ferdige måltider, typisk i institusjon eller kantine.',
    group: SERVERING,
    synonyms: ['måltidsservering', 'matservering', 'servering av måltider'],
  },
  {
    code: '55500000',
    name: 'Kantine- og cateringtjenester',
    about: 'Drift av kantine og levering av catering hos oppdragsgiveren.',
    group: SERVERING,
    synonyms: ['kantine', 'catering', 'kantinedrift', 'storkjøkken'],
  },
  {
    code: '55510000',
    name: 'Kantinetjenester',
    about: 'Daglig drift av en kantine, inkludert bemanning og meny.',
    group: SERVERING,
    synonyms: ['kantine', 'kantinedrift', 'kantinetjenester', 'personalkantine'],
  },
  {
    code: '55520000',
    name: 'Cateringtjenester',
    about: 'Mat levert og servert ved arrangementer og møter.',
    group: SERVERING,
    synonyms: ['catering', 'møtemat', 'arrangementsmat', 'selskapsmat'],
  },
  {
    code: '55521200',
    name: 'Måltidslevering',
    about: 'Ferdige måltider levert til mottakeren, for eksempel hjemmeboende.',
    group: SERVERING,
    synonyms: ['måltidslevering', 'matombringing', 'middagslevering', 'levering av mat'],
  },
  {
    code: '60000000',
    name: 'Transporttjenester (unntatt avfallstransport)',
    about: 'Transport av personer og gods på vei, bane, sjø og i luften.',
    group: TRANSPORT,
    synonyms: ['transport', 'transporttjenester', 'frakt', 'befordring'],
  },
  {
    code: '60130000',
    name: 'Spesialisert persontransport',
    about: 'Persontransport på bestilling for en avgrenset gruppe, som elever eller pasienter.',
    group: TRANSPORT,
    synonyms: [
      'skoleskyss',
      'skoletransport',
      'pasienttransport',
      'persontransport',
      'drosje',
      'taxi',
      'TT-transport',
    ],
  },
  {
    code: '71000000',
    name: 'Arkitekt-, ingeniør- og inspeksjonstjenester',
    about: 'Rådgivning og prosjektering, ikke utførelse.',
    group: RADGIVNING,
    synonyms: ['rådgivning', 'prosjektering', 'arkitekt', 'ingeniør', 'RIF'],
  },
  {
    code: '71200000',
    name: 'Arkitekttjenester',
    about: 'Arkitektfaglig prosjektering, plan- og formgivningsarbeid.',
    group: RADGIVNING,
    synonyms: ['arkitekt', 'landskapsarkitekt', 'reguleringsplan', 'formgivning'],
  },
  {
    code: '71300000',
    name: 'Ingeniørtjenester',
    about: 'Teknisk prosjektering innen bygg, anlegg og installasjoner.',
    group: RADGIVNING,
    synonyms: ['ingeniør', 'prosjektering', 'RIB', 'RIE', 'teknisk rådgivning'],
  },
  {
    code: '71500000',
    name: 'Byggerelaterte tjenester',
    about: 'Byggeledelse, prosjektledelse og oppfølging på byggeplass.',
    group: RADGIVNING,
    synonyms: ['byggeledelse', 'prosjektledelse', 'byggherreombud', 'SHA-koordinator'],
  },
  {
    code: '71600000',
    name: 'Teknisk prøving, analyse og rådgivning',
    about: 'Måling, prøvetaking, kontroll og tekniske utredninger.',
    group: RADGIVNING,
    synonyms: ['uavhengig kontroll', 'tilstandsanalyse', 'måling', 'prøvetaking', 'utredning'],
  },
  {
    code: '72000000',
    name: 'IT-tjenester',
    about: 'Rådgivning, utvikling, drift og støtte innen IT.',
    group: IT,
    synonyms: ['IT', 'IT-konsulent', 'digitalisering', 'IT-drift', 'konsulenttjenester IT'],
  },
  {
    code: '72200000',
    name: 'Programmering og IT-rådgivning',
    about: 'Systemutvikling, integrasjon og rådgivning om programvare.',
    group: IT,
    synonyms: ['systemutvikling', 'programmering', 'integrasjon', 'utviklingstjenester', 'koding'],
  },
  {
    code: '72500000',
    name: 'Datarelaterte tjenester',
    about: 'Drift, forvaltning, brukerstøtte og skytjenester.',
    group: IT,
    synonyms: ['drift', 'forvaltning', 'brukerstøtte', 'skytjenester', 'sky', 'hosting'],
  },
  {
    code: '77000000',
    name: 'Jordbruks-, skogbruks- og gartnertjenester',
    about: 'Tjenester knyttet til dyrking, skog og grøntanlegg.',
    group: GARTNER,
    synonyms: ['jordbruk', 'skogbruk', 'gartner', 'grøntanlegg'],
  },
  {
    code: '77300000',
    name: 'Gartnertjenester',
    about: 'Skjøtsel av uteområder: plen, beplantning, busker og trær.',
    group: GARTNER,
    synonyms: ['grøntvedlikehold', 'plenklipp', 'uteområder', 'beplantning', 'skjøtsel', 'gartner'],
  },
  {
    code: '79000000',
    name: 'Forretningstjenester',
    about: 'Samlebetegnelse for administrative, juridiske og markedsrettede tjenester.',
    group: FORRETNING,
    synonyms: ['forretningstjenester', 'administrative tjenester'],
  },
  {
    code: '79400000',
    name: 'Virksomhets- og ledelsesrådgivning',
    about: 'Rådgivning om organisasjon, strategi og styring.',
    group: FORRETNING,
    synonyms: ['ledelsesrådgivning', 'organisasjonsutvikling', 'strategi', 'management consulting'],
  },
  {
    code: '79600000',
    name: 'Rekrutteringstjenester',
    about: 'Å finne og ansette personell på vegne av oppdragsgiveren.',
    group: FORRETNING,
    synonyms: ['rekruttering', 'headhunting', 'ansettelse', 'search'],
  },
  {
    code: '79610000',
    name: 'Formidling av personell',
    about: 'Formidling av arbeidstakere til en oppdragsgiver som ansetter selv.',
    group: FORRETNING,
    synonyms: ['formidling', 'jobbformidling', 'arbeidsformidling'],
  },
  {
    code: '79620000',
    name: 'Utleie av personell, inkludert vikarer',
    about: 'Innleie av personell der byrået beholder arbeidsgiveransvaret.',
    group: FORRETNING,
    synonyms: ['bemanning', 'innleie', 'vikarbyrå', 'vikartjenester', 'personalutleie'],
  },
  {
    code: '79621000',
    name: 'Utleie av kontorpersonell',
    about: 'Innleie av merkantilt og administrativt personell.',
    group: FORRETNING,
    synonyms: ['kontorpersonell', 'merkantil bemanning', 'administrativ vikar'],
  },
  {
    code: '79624000',
    name: 'Utleie av pleiepersonell',
    about: 'Innleie av sykepleiere, helsefagarbeidere og annet pleiepersonell.',
    group: FORRETNING,
    synonyms: ['helsevikar', 'sykepleiervikar', 'pleiepersonell', 'helsebemanning'],
  },
  {
    code: '79630000',
    name: 'Personaltjenester utenom formidling og utleie',
    about: 'Øvrige HR-tjenester, som omstilling, testing og personaladministrasjon.',
    group: FORRETNING,
    synonyms: ['HR-tjenester', 'omstilling', 'personaladministrasjon', 'karriereveiledning'],
  },
  {
    code: '79700000',
    name: 'Etterforsknings- og sikkerhetstjenester',
    about: 'Fysisk sikkerhet, vakthold og etterforskning som tjeneste.',
    group: FORRETNING,
    synonyms: ['sikkerhetstjenester', 'vakthold', 'etterforskning'],
  },
  {
    code: '79710000',
    name: 'Sikkerhetstjenester',
    about: 'Bemannet sikkerhet og sikring av bygg, områder og arrangementer.',
    group: FORRETNING,
    synonyms: ['sikkerhet', 'sikring', 'sikkerhetstjenester', 'vakt'],
  },
  {
    code: '79711000',
    name: 'Alarmmottak',
    about: 'Mottak og håndtering av alarmer fra tilknyttede anlegg.',
    group: FORRETNING,
    synonyms: ['alarmmottak', 'alarmsentral', 'vaktsentral', 'utrykning'],
  },
  {
    code: '79713000',
    name: 'Vakttjenester',
    about: 'Vektere og ordensvakter som er fysisk til stede.',
    group: FORRETNING,
    synonyms: ['vekter', 'vektertjenester', 'ordensvakt', 'vakthold', 'resepsjonsvakt'],
  },
  {
    code: '79714000',
    name: 'Overvåkingstjenester',
    about: 'Overvåking av områder og anlegg, bemannet eller kamerabasert.',
    group: FORRETNING,
    synonyms: ['overvåking', 'kameraovervåking', 'områdeovervåking', 'patruljering'],
  },
  {
    code: '79990000',
    name: 'Diverse forretningstjenester',
    about: 'Forretningstjenester som ikke hører hjemme i de øvrige gruppene.',
    group: FORRETNING,
    synonyms: ['diverse tjenester', 'andre forretningstjenester'],
  },
  {
    code: '79993000',
    name: 'Bygnings- og eiendomsforvaltning',
    about: 'Samlet forvaltning av bygg og eiendom, ofte kalt facility management.',
    group: FORRETNING,
    synonyms: ['facility management', 'FM', 'eiendomsforvaltning', 'FDV', 'bygningsforvaltning'],
  },
  {
    code: '90000000',
    name: 'Avløps-, avfalls-, renholds- og miljøtjenester',
    about: 'Tjenester som holder bygg, områder og miljø i stand.',
    group: RENHOLD,
    synonyms: ['miljøtjenester', 'avfall', 'avløp', 'renovasjon'],
  },
  {
    code: '90900000',
    name: 'Renholds- og renovasjonstjenester',
    about: 'Renhold og sanitærtjenester samlet.',
    group: RENHOLD,
    synonyms: ['renhold', 'renovasjon', 'sanitærtjenester', 'renholdstjenester'],
  },
  {
    code: '90910000',
    name: 'Renholdstjenester',
    about: 'Renhold som tjeneste, uansett hva som skal rengjøres.',
    group: RENHOLD,
    synonyms: ['renhold', 'rengjøring', 'renholdstjenester', 'vask', 'daglig renhold'],
  },
  {
    code: '90911000',
    name: 'Renhold av boliger, bygninger og vinduer',
    about: 'Renhold rettet mot bygg og bygningsdeler, inkludert vinduer.',
    group: RENHOLD,
    synonyms: ['bygningsrenhold', 'boligrenhold', 'renhold av bygg'],
  },
  {
    code: '90911200',
    name: 'Renhold av bygninger',
    about: 'Daglig og periodisk renhold innvendig i bygg.',
    group: RENHOLD,
    synonyms: [
      'daglig renhold',
      'hovedrengjøring',
      'byggrenhold',
      'kontorrenhold',
      'renhold av bygninger',
    ],
  },
  {
    code: '90911300',
    name: 'Vinduspuss',
    about: 'Innvendig og utvendig vask av vinduer og glassflater.',
    group: RENHOLD,
    synonyms: ['vinduspuss', 'vindusvask', 'vask av vinduer', 'pusse vinduer', 'glassvask'],
  },
  {
    code: '98000000',
    name: 'Andre samfunnstjenester og personlige tjenester',
    about: 'Tjenester til fellesskapet og til enkeltpersoner som ikke dekkes ellers.',
    group: SAMFUNN,
    synonyms: ['samfunnstjenester', 'personlige tjenester'],
  },
  {
    code: '98300000',
    name: 'Diverse tjenester',
    about: 'Blandet sekk av tjenester, ofte brukt når ingen mer presis kode finnes.',
    group: SAMFUNN,
    synonyms: ['diverse tjenester', 'andre tjenester', 'matteservice', 'skadedyrkontroll'],
  },
];

const BY_CODE: ReadonlyMap<string, CpvEntry> = new Map(
  CPV_VOCABULARY.map((entry) => [entry.code, entry]),
);

/**
 * The Norwegian name for a code, or the code itself.
 *
 * Falling back to the bare code is the point: a page that shows `50411000`
 * tells the reader something true and checkable, whereas one that guessed at a
 * name from the nearest parent would be confidently wrong about what a notice
 * covers. Never throws — this runs inside render.
 */
export function cpvLabel(code: string): string {
  const digits = normalizeCpv(code);
  if (!digits) return code;
  return BY_CODE.get(digits)?.name ?? code;
}

/** The full entry, when a caller needs `about` or `group` too. */
export function cpvEntry(code: string): CpvEntry | undefined {
  const digits = normalizeCpv(code);
  return digits ? BY_CODE.get(digits) : undefined;
}

/*
 * ── Breadth ───────────────────────────────────────────────────────────────
 *
 * Some CPV codes say almost nothing about what is being bought. 98300000
 * «Diverse tjenester» is the clearest case: it is the code a buyer reaches for
 * when no precise one fits, and on the renhold page it was pulling in
 * advokattjenester, frisørmøbler, lås og beslag, and transport av døde dyr —
 * all of them tagged, correctly, as «miscellaneous services», and all of them
 * shown as a strong match because the surface could not tell a vague code from
 * a precise one.
 *
 * So breadth is **data, not code**. The default rule reads the digits: a code
 * at division level — two significant digits, six trailing zeros — covers a
 * whole branch of the vocabulary and cannot be evidence of a specific trade.
 * Two lists sit on top of it, and both exist because the digits are only a
 * good default and never a law:
 *
 * - `EXPLICIT_BROAD_CPV` names codes that are broad despite being deeper than
 *   a division. 98300000 and 79900000 are group-level codes whose *meaning* is
 *   «the rest», which no arithmetic on their digits can discover.
 * - `EXPLICIT_PRECISE_CPV` is the escape hatch in the other direction, for a
 *   division that genuinely is the trade rather than a branch above it. It is
 *   empty today and is here so that adding to it is an edit to a table rather
 *   than an exception written into a matching rule.
 *
 * The lists win over the digits, and `EXPLICIT_PRECISE_CPV` wins over
 * `EXPLICIT_BROAD_CPV`, so an editor can always override the layer below.
 */

/** Broad even though the digits alone would not say so. */
export const EXPLICIT_BROAD_CPV: readonly string[] = [
  '45000000', // Bygge- og anleggsarbeid — a division, listed so it is visible
  '72000000', // IT-tjenester — a division, listed so it is visible
  '79900000', // Diverse forretningstjenester: a group meaning «the rest»
  '85000000', // Helse- og sosialtjenester — a division, listed so it is visible
  '98300000', // Diverse tjenester: the code a buyer picks when none fits
];

/**
 * Precise despite being a division. Empty, and deliberately kept as a table.
 *
 * A template that depends on a whole division being treated as evidence adds
 * its code here rather than teaching the rule an exception.
 */
export const EXPLICIT_PRECISE_CPV: readonly string[] = [];

const BROAD_SET: ReadonlySet<string> = new Set(EXPLICIT_BROAD_CPV);
const PRECISE_SET: ReadonlySet<string> = new Set(EXPLICIT_PRECISE_CPV);

/**
 * True when a code is too broad to be evidence of a trade on its own.
 *
 * Never throws and returns `false` for nonsense: an unparseable code is not a
 * *broad* code, and treating it as one would silently suppress notices on the
 * strength of a typo.
 */
export function isBroadCpv(code: string): boolean {
  const digits = normalizeCpv(code);
  if (!digits) return false;
  if (PRECISE_SET.has(digits)) return false;
  if (BROAD_SET.has(digits)) return true;
  return cpvDepth(digits) <= 2;
}

/*
 * ── Families ──────────────────────────────────────────────────────────────
 *
 * A notice tagged 90910000, 90911200 and 90911300 has told the reader one
 * thing, not three, and an explanation that lists it three times reads as three
 * independent confirmations. Codes sharing their first four digits are
 * therefore one family (IDE Agent Spec, R3).
 */

/** The four-digit family a code belongs to, or `null` for an unparseable one. */
export function cpvFamilyOf(code: string): string | null {
  return normalizeCpv(code)?.slice(0, 4) ?? null;
}

/**
 * The Norwegian name for a four-digit family, or `undefined`.
 *
 * Derived rather than curated. Every family the service templates reach has a
 * `XXXX0000` entry in the table above, so the family name is that entry's name
 * — which keeps one list to maintain instead of two that can disagree about
 * what 9091 is called.
 *
 * `undefined` rather than the bare digits when nothing is known, because a row
 * headed «CPV: 5041» would be worse than no merge at all. The caller's rule is
 * then to leave those codes as their own rows, where `cpvLabel`'s existing
 * fallback prints the full eight-digit code — something a reader can at least
 * look up.
 */
export function cpvFamilyLabel(family: string): string | undefined {
  if (!/^\d{4}$/.test(family)) return undefined;
  return BY_CODE.get(`${family}0000`)?.name;
}

const DEFAULT_SEARCH_LIMIT = 12;

/**
 * Rank tiers, best first. Kept as named constants because the ordering is the
 * whole contract: an exact code beats a name, a name beats a synonym, and a
 * word found in the middle of something beats nothing at all.
 */
const RANK_CODE_EXACT = 0;
const RANK_CODE_PREFIX = 1;
const RANK_NAME_EXACT = 2;
const RANK_NAME_PREFIX = 3;
const RANK_SYNONYM_EXACT = 4;
const RANK_SYNONYM_PREFIX = 5;
const RANK_NAME_CONTAINS = 6;
const RANK_SYNONYM_CONTAINS = 7;

function rankOf(entry: CpvEntry, query: string, digits: string): number {
  if (digits.length > 0) {
    if (entry.code === digits) return RANK_CODE_EXACT;
    if (entry.code.startsWith(digits)) return RANK_CODE_PREFIX;
  }

  const name = normalizeSearchText(entry.name);
  if (name === query) return RANK_NAME_EXACT;
  if (name.startsWith(query)) return RANK_NAME_PREFIX;

  let best = Number.POSITIVE_INFINITY;
  for (const synonym of entry.synonyms) {
    const value = normalizeSearchText(synonym);
    if (value === query) return RANK_SYNONYM_EXACT;
    if (value.startsWith(query)) best = Math.min(best, RANK_SYNONYM_PREFIX);
    else if (value.includes(query)) best = Math.min(best, RANK_SYNONYM_CONTAINS);
  }

  if (name.includes(query)) best = Math.min(best, RANK_NAME_CONTAINS);
  return best;
}

/**
 * Plain-word search over the vocabulary. Pure; no I/O.
 *
 * Case- and diacritic-insensitive through `normalizeSearchText`, so «vinduspuss»
 * and «VINDUSPUSS» are the same query and «måltid» folds the same way the
 * matcher folds it.
 *
 * An empty or whitespace-only query returns nothing rather than everything. A
 * picker that dumps 60 codes the moment it is focused is not a search result,
 * it is a wall, and the caller can render the grouped list itself if that is
 * what it wants.
 */
export function searchCpv(
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
): readonly CpvEntry[] {
  const normalized = normalizeSearchText(query);
  if (normalized.length === 0 || limit <= 0) return [];

  const digits = normalized.replace(/\D/g, '');

  const scored: { entry: CpvEntry; rank: number }[] = [];
  for (const entry of CPV_VOCABULARY) {
    const rank = rankOf(entry, normalized, digits);
    if (Number.isFinite(rank)) scored.push({ entry, rank });
  }

  scored.sort((a, b) => a.rank - b.rank || a.entry.code.localeCompare(b.entry.code));
  return scored.slice(0, limit).map((hit) => hit.entry);
}
