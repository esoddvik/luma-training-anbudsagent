/**
 * Customer-facing copy, Norwegian bokmål (spec section 6).
 *
 * The strings marked "seksjon 43" are the wording proposed in the
 * specification and are reproduced verbatim. `COVERAGE_TEXT` in particular is
 * a launch blocker (section 51, point 3): it has to appear on the landing page
 * *and* in the terms, so it lives in one constant that both pages import and
 * the e2e test asserts on.
 */

export const SERVICE_NAME = 'Luma Anbudsvarsling';

export const SERVICE_TAGLINE = 'En gratis tjeneste fra Luma Training';

/** Seksjon 43, overskrift. */
export const LANDING_HEADING = 'Få beskjed når relevante anbud publiseres';

/** Seksjon 43, introduksjon. */
export const LANDING_INTRO = [
  'Fortell oss hvilke oppdrag virksomheten din ser etter. Luma Anbudsvarsling følger med på nye offentlige anbud og sender deg treff som passer kriteriene dine. Du får også beskjed om planlagte anskaffelser, slik at du kan forberede deg før konkurransen publiseres.',
  'Tjenesten er gratis og leveres av Luma Training.',
] as const;

/** Seksjon 43, tillitstekst. */
export const TRUST_TEXT =
  'Vi rangerer anbud etter hvor godt de passer varslingsprofilen din. Kurs, annonser eller kommersielle hensyn påvirker aldri hvilke anbud du får se.';

/** Seksjon 43, dekningstekst. Obligatorisk på landingsside og i vilkår. */
export const COVERAGE_HEADING = 'Hva tjenesten dekker — og ikke dekker';

export const COVERAGE_TEXT =
  'Tjenesten dekker kunngjøringer publisert på Doffin. Anskaffelser under terskelverdiene publiseres ikke alltid der, og spørsmål og svar i konkurranser skjer i oppdragsgivers konkurranseverktøy. Følg derfor alltid konkurransens egne kanaler når du jobber med et anbud. At du ikke får varsel, betyr ikke at det ikke finnes muligheter.';

/** Seksjon 43, MCP-seksjon. */
export const MCP_HEADING = 'Bruk anbudsvarslene direkte i AI-verktøyet ditt';

export const MCP_TEXT =
  'Koble varslingsprofilen til ChatGPT, Claude eller et annet MCP-kompatibelt AI-verktøy. Da kan du søke etter relevante anbud, undersøke hvorfor de matcher og følge endringer uten å forlate samtalen. Dette er samme arbeidsmåte som vi lærer bort i kurset «Vinn flere anbud med AI», bare uten limbåndet.';

/** Seksjon 43, delt-visning. */
export const SHARE_INVITATION =
  'En kollega delte dette anbudet med deg via Luma Anbudsvarsling. Få dine egne anbudsvarsler, gratis, fra Luma Training.';

/** Seksjon 43, merking av promotering. */
export const PROMOTION_LABEL = 'Fra Luma Training';

/* ---------------------------------------------------------------------------
 * Landingssiden, seksjon for seksjon.
 *
 * Alt som står på siden bor her framfor i JSX-en, slik at teksten kan leses og
 * rettes uten å lese markup — og slik at e2e-testene kan importere nøyaktig den
 * strengen siden faktisk viser.
 * ------------------------------------------------------------------------- */

/** Hovedhandlingen i heroen. Fører til bransjevelgeren, ikke til skjemaet. */
export const LANDING_HERO_CTA = 'Finn anbud for din bransje';

/** Den sekundære lenken i heroen, som hopper ned til forklaringen. */
export const LANDING_HERO_SECONDARY = 'Slik fungerer det';

/**
 * Setningen under knappene.
 *
 * Den svarer på de to spørsmålene folk faktisk har før de skriver inn en
 * e-postadresse: koster dette noe, og kommer jeg meg ut igjen.
 */
export const LANDING_HERO_REASSURANCE =
  'Ingen kortopplysninger. Du kan pause eller slette når som helst.';

/**
 * Overskriften over kunngjøringene i heroen.
 *
 * Designet skriver «Publisert på Doffin i dag». Det ville vært en påstand om
 * data vi ikke har: listen hentes fra et 90-dagersvindu og siden bygges på nytt
 * hver time, så en kunngjøring her kan være noen dager gammel. Ordlyden er
 * derfor senket til noe som er sant uansett hva spørringen returnerer.
 */
export const LANDING_LIVE_HEADING = 'Nylig publisert på Doffin';

export const LANDING_STEPS_HEADING = 'Slik fungerer det';

export const LANDING_STEPS = [
  {
    title: 'Velg bransje og område',
    body: 'Ferdige maler for de vanligste bransjene. Du kan justere CPV-koder og søkeord etterpå.',
  },
  {
    title: 'Se treffene før du melder deg på',
    body: 'Ekte kunngjøringer fra Doffin, ikke eksempler.',
  },
  {
    title: 'Få dem på e-post',
    body: 'Daglig sammendrag eller straks. Med forklaring på hvert eneste treff.',
  },
] as const;

/** Bildeteksten under tillitsteksten, som sier hvem løftet kommer fra. */
export const LANDING_TRANSPARENCY_CAPTION = 'Vårt løfte om åpenhet';

export const LANDING_TRANSPARENCY_SUPPORT =
  'Ingen svarte bokser. Hvert treff kan åpnes og vise nøyaktig hva som traff — CPV-kode, søkeord og område.';

/** Etiketten over MCP-panelet. Panelet er den ene mørke flaten på siden. */
export const ASSISTANT_LABEL = 'Spør assistenten din';

export const ASSISTANT_SAMPLE_QUESTION =
  'Hvilke renholdsanbud i Vestland har frist de neste to ukene?';

/**
 * Svaret i eksempelet.
 *
 * Bevisst uten tall, navn og datoer: et illustrasjonssvar som ser ut som ekte
 * treffdata blir lest som ekte treffdata. Dette beskriver hva assistenten gjør,
 * uten å oppgi kunngjøringer som ikke finnes.
 */
export const ASSISTANT_SAMPLE_ANSWER =
  'Assistenten svarer med kunngjøringene fra din egen profil, med frist, oppdragsgiver og hvorfor hver enkelt traff.';

export const ASSISTANT_LINK = 'Se hvordan du kobler til';

/** Kursbåndet nederst. Merkingen kommer fra `Promotion` i @luma/ui. */
export const LANDING_PROMOTION_HEADING = 'En gratis tjeneste fra Luma Training';

export const LANDING_PROMOTION_TEXT =
  'Vi lever av kurs i anbudsarbeid. Varslingen er gratis, og blir det. Du betaler eventuelt for arbeid vi gjør for deg, aldri for data.';

export const LANDING_PROMOTION_LINK = 'Se kursdatoer';

export const LANDING_FAQ_HEADING = 'Ofte stilte spørsmål';

/**
 * Spørsmålene siden faktisk får, med svar som kan etterprøves.
 *
 * Hvert svar peker på en egenskap ved tjenesten som finnes i dag — ikke på en
 * plan. Rekkefølgen er den de stilles i: pris først, så kilde, så hva som
 * kommer i innboksen, så hvordan man kommer seg ut igjen.
 */
export const LANDING_FAQ = [
  {
    q: 'Hva koster det?',
    a: 'Ingenting. Luma Training lever av kurs i anbudsarbeid, ikke av å selge data eller oppmerksomhet. Du betaler aldri for varslene.',
  },
  {
    q: 'Hvor kommer anbudene fra?',
    a: 'Fra kunngjøringer publisert på Doffin, den offisielle databasen for offentlige anskaffelser i Norge. Vi endrer ikke innholdet i en kunngjøring, og vi lenker alltid til originalen.',
  },
  {
    q: 'Hvor ofte får jeg varsler?',
    a: 'Du velger selv: daglig sammendrag, eller varsel med en gang et treff dukker opp. Varslingsprofilen starter på pause, så du rekker å se over kriteriene før det første varselet går ut.',
  },
  {
    q: 'Hvorfor fikk jeg akkurat dette treffet?',
    a: 'Hvert treff kan åpnes og viser hva som traff: CPV-koden, søkeordet og området. Rangeringen påvirkes aldri av kurs, annonser eller kommersielle hensyn.',
  },
  {
    q: 'Kan jeg slutte?',
    a: 'Ja. Du kan pause varslingen, eller slette varslingsprofilen og opplysningene om deg, når som helst. Vi ber aldri om kortopplysninger.',
  },
] as const;

/* ---------------------------------------------------------------------------
 * Bransjevelgeren (/finn-anbud).
 * ------------------------------------------------------------------------- */

export const PICKER_HEADING = 'Finn anbud i din bransje';

export const PICKER_INTRO =
  'Velg hva virksomheten din leverer, så viser vi kunngjøringene som er publisert på Doffin de siste 90 dagene. Du trenger ikke registrere deg for å se dem.';

export const PICKER_HELPER =
  'Velg det som ligner mest. Vi fyller ut CPV-koder og søkeord for deg, og du kan justere alt etterpå.';

export const SIGNUP_HEADING = 'Kom i gang';

export const SIGNUP_INTRO =
  'Velg hva virksomheten din leverer og skriv inn e-postadressen din, så sender vi deg en lenke for å bekrefte. Varslingsprofilen starter på pause, så du rekker å se over kriteriene før det første varselet går ut.';

export const SIGNUP_TEMPLATE_LABEL = 'Hva leverer virksomheten?';

export const SIGNUP_TEMPLATE_HINT =
  'Vi fyller ut kriteriene for deg. Du kan endre alt sammen etterpå.';

export const SIGNUP_EMAIL_LABEL = 'E-postadresse';

export const SIGNUP_EMAIL_HINT = 'Vi bruker adressen til å sende anbudsvarsler og innlogging.';

export const SIGNUP_SUBMIT = 'Opprett varslingsprofil';
