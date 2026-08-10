import { MAGIC_LINK_GENERIC_RESPONSE_NB } from '@luma/auth';
import { SIGNUP_GENERIC_RESPONSE_NB } from '../registration';

/**
 * Confirmation and error messages for server actions.
 *
 * The app renders forms that work without client JavaScript, so an action
 * cannot hand a result back through `useActionState`. Instead it redirects with
 * a short code, and the page turns the code into Norwegian text inside a live
 * region. Keeping the codes in one closed map means a redirect can never put
 * attacker-supplied text on the page, and means no message can be written in
 * English by accident (spec section 6).
 */

export const ACTION_MESSAGES_NB = {
  lagret: { tone: 'success', text: 'Anbudet er lagret.' },
  avvist: {
    tone: 'success',
    text: 'Anbudet er avvist og vises ikke lenger i oversikten.',
  },
  tilbakestilt: { tone: 'success', text: 'Anbudet er tilbakestilt.' },
  feedback: {
    tone: 'success',
    text: 'Takk. Tilbakemeldingen er lagret og brukes til å måle kvaliteten på treffene.',
  },
  'deling-opprettet': {
    tone: 'success',
    text: 'Delingslenken er laget. Du finner den under Delinger.',
  },
  'deling-finnes': {
    tone: 'info',
    text: 'Du har allerede en aktiv delingslenke for dette anbudet. Den finner du under Delinger.',
  },
  'deling-opphevet': {
    tone: 'success',
    text: 'Delingslenken er opphevet og virker ikke lenger.',
  },
  'deling-mangler': {
    tone: 'warning',
    text: 'Fant ingen aktiv delingslenke å oppheve.',
  },
  'profil-opprettet': {
    tone: 'success',
    text: 'Varslingsprofilen er opprettet. Se forhåndsvisningen nedenfor før du aktiverer den.',
  },
  'profil-lagret': { tone: 'success', text: 'Endringene i varslingsprofilen er lagret.' },
  'profil-pauset': {
    tone: 'success',
    text: 'Varslingsprofilen er satt på pause. Du får ingen varsler fra den før du starter den igjen.',
  },
  'profil-startet': { tone: 'success', text: 'Varslingsprofilen er aktiv igjen.' },
  'profil-slettet': { tone: 'success', text: 'Varslingsprofilen er slettet.' },
  'innstillinger-lagret': { tone: 'success', text: 'Varslingspreferansene er lagret.' },
  'samtykke-gitt': {
    tone: 'success',
    text: 'Markedsføringssamtykket er registrert med dato og tekstversjon. Du kan trekke det tilbake når som helst.',
  },
  'samtykke-trukket': {
    tone: 'success',
    text: 'Markedsføringssamtykket er trukket tilbake. Anbudsvarslene fortsetter som før.',
  },
  /**
   * The answer to every login-link request that was not rate limited.
   *
   * The text is `MAGIC_LINK_GENERIC_RESPONSE_NB` from `@luma/auth`, imported
   * rather than retyped: spec section 10's defence against account enumeration
   * only works if the sentence is the same one whether or not the address is
   * registered, and a copy in this file is a copy that can drift.
   */
  'lenke-sendt': { tone: 'success', text: MAGIC_LINK_GENERIC_RESPONSE_NB },
  /**
   * The answer to every signup submission that was not rate limited.
   *
   * Imported from `registration.ts` for the same reason `lenke-sendt` imports
   * from `@luma/auth`: the enumeration defence only works if the sentence is
   * identical whether or not the address already has an account, and a copy in
   * this file is a copy that can drift into "welcome back".
   */
  'sjekk-e-post': { tone: 'success', text: SIGNUP_GENERIC_RESPONSE_NB },
  'for-mange-lenker': {
    tone: 'warning',
    text: 'Vi har allerede sendt flere innloggingslenker til denne adressen. Vent litt før du prøver igjen.',
  },
  'bekreftelse-feilet': {
    tone: 'danger',
    text: 'Vi klarte ikke å bekrefte adressen. Sett opp varslingen på nytt, så sender vi en ny lenke.',
  },
  'innhenting-ferdig': { tone: 'success', text: 'Innhentingen er kjørt.' },
  'innhenting-delvis': {
    tone: 'warning',
    text: 'Innhentingen kjørte, men noen kunngjøringer feilet. Sjekkpunktet står stille til en kjøring går helt gjennom.',
  },
  'innhenting-feilet': {
    tone: 'danger',
    text: 'Innhentingen kunne ikke kjøres. Se kjøringene under.',
  },
  'backfill-ferdig': {
    tone: 'success',
    text: 'Etterfyllingen er ferdig. Korpuset dekker nå hele perioden du ba om.',
  },
  'backfill-delvis': {
    tone: 'warning',
    text: 'Etterfyllingen er ferdig, men minst ett tidsvindu traff taket på 1000 treff og kan mangle kunngjøringer. Kjør på nytt med færre dager om gangen.',
  },
  'backfill-tidsavbrudd': {
    tone: 'info',
    // Deliberately not an error: the run is inline and long, so an aborted
    // request usually means the work is still going. Telling an operator it
    // failed is how a second one gets started on top of the first.
    text: 'Etterfyllingen svarte ikke innen tidsfristen, men er trolig fortsatt i gang. Vent litt og last siden på nytt før du prøver igjen.',
  },
  'backfill-feilet': {
    tone: 'danger',
    text: 'Etterfyllingen kunne ikke kjøres.',
  },
  ugyldig: {
    tone: 'danger',
    text: 'Forespørselen var ugyldig. Last siden på nytt og prøv igjen.',
  },
  'ukjent-anbud': { tone: 'danger', text: 'Fant ikke anbudet.' },
  'ukjent-profil': { tone: 'danger', text: 'Fant ikke varslingsprofilen.' },
} as const satisfies Record<
  string,
  { tone: 'success' | 'info' | 'warning' | 'danger'; text: string }
>;

export type ActionMessageCode = keyof typeof ACTION_MESSAGES_NB;

export interface ActionMessage {
  readonly tone: 'success' | 'info' | 'warning' | 'danger';
  readonly text: string;
}

/** Resolves a `melding` query parameter. Unknown codes produce nothing. */
export function resolveActionMessage(code: string | string[] | undefined): ActionMessage | null {
  if (typeof code !== 'string') return null;
  if (!(code in ACTION_MESSAGES_NB)) return null;
  return ACTION_MESSAGES_NB[code as ActionMessageCode];
}

/** Builds the redirect target for an action. */
export function withMessage(path: string, code: ActionMessageCode): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}melding=${code}`;
}
