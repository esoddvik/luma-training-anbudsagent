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

export const SIGNUP_HEADING = 'Kom i gang';

export const SIGNUP_INTRO =
  'Skriv inn e-postadressen din, så sender vi deg en lenke for å sette opp varslingsprofilen. Du velger selv bransjemal og kriterier i neste steg.';

export const SIGNUP_EMAIL_LABEL = 'E-postadresse';

export const SIGNUP_EMAIL_HINT = 'Vi bruker adressen til å sende anbudsvarsler og innlogging.';

export const SIGNUP_SUBMIT = 'Opprett varslingsprofil';
