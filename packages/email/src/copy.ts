/**
 * Every customer-facing string in an email, in one place.
 *
 * Spec section 6 requires all customer-facing content to be Norwegian bokmål,
 * and section 43 fixes the approved wording for the trust-sensitive parts.
 * Collecting the strings here means a Norwegian speaker reviews one file
 * rather than nine templates, and it lets the forbidden-phrasing test scan a
 * single surface in addition to the rendered output.
 *
 * Rules that apply to everything below:
 *
 * - No claim about winning, no guarantee, no "du må", no scarcity or urgency
 *   (spec sections 4.3, 23.5, 42). A test asserts this over every rendered
 *   template, not just over this file.
 * - Terminology follows the list in spec section 6: anbud, oppdragsgiver,
 *   varslingsprofil, planlagt anskaffelse, treff, varsel, frist, faktura.
 * - Nothing here is a placeholder. An English string in this file is a bug.
 */

import { INVOICE_COPY_NB } from '@luma/domain';

/** Product and sender identity (spec section 42). */
export const BRAND_NB = {
  productName: 'Luma Anbudsvarsling',
  freeServiceByline: 'En gratis tjeneste fra Luma Training',
  companyName: 'Luma Training',
} as const;

/** Shared labels used by more than one template. */
export const COMMON_NB = {
  senderHeading: 'Avsender',
  contactHeading: 'Kontakt',
} as const;

/** The tender card (spec section 25). */
export const CARD_NB = {
  buyerLabel: 'Oppdragsgiver',
  deadlineLabel: 'Frist',
  /** Used instead of a deadline for a planned procurement. Never fabricate one. */
  plannedLabel: 'Planlagt anskaffelse',
  noDeadlineExplanation: 'Konkurransen er ikke publisert ennå, så det finnes ingen frist.',
  matchLevelLabel: 'Treffnivå',
  reasonsHeading: 'Derfor passer dette varslingsprofilen din',
  detailLink: 'Se anbudet',
  doffinLink: 'Åpne kunngjøringen på Doffin',
  saveLink: 'Lagre',
  dismissLink: 'Avvis',
  publishedLabel: 'Publisert',
  valueLabel: 'Anslått verdi',
} as const;

/** The digest and immediate alert (spec section 26). */
export const DIGEST_NB = {
  dailyTitle: 'Nye anbud i dag',
  weeklyTitle: 'Nye anbud denne uken',
  immediateTitle: 'Nytt anbud som passer varslingsprofilen din',

  competitionsHeading: 'Aktive konkurranser',
  plannedHeading: 'Planlagte anskaffelser',
  /** The explanatory line required by spec section 26, item 5. */
  plannedExplanation:
    'Konkurransene er ikke publisert ennå. Godt tidspunkt å begynne forberedelsene.',
  changesHeading: 'Endringer i lagrede anbud',
  profileAdminHeading: 'Profiladministrasjon',
  notificationSettingsHeading: 'Varslingsinnstillinger',

  emptyStateHeading: 'Ingen nye treff denne gangen',
  emptyStateBody:
    'Vi fant ingen nye anbud som passer varslingsprofilen din i denne perioden. Du kan justere kriteriene dine når som helst.',
  emptyStateAction: 'Justér varslingsprofilen',

  /** Spec section 5, point 2: absence of alerts is not absence of opportunity. */
  coverageNote:
    'Tjenesten dekker kunngjøringer publisert på Doffin. At du ikke får varsel, betyr ikke at det ikke finnes muligheter.',
} as const;

/** Counting sentences. Norwegian needs the singular form spelled out. */
export function newMatchesSentence(count: number, profileName: string): string {
  if (count === 0) {
    return `Ingen nye anbud passet varslingsprofilen «${profileName}» i denne perioden.`;
  }
  if (count === 1) {
    return `Du har ett nytt anbud som passer varslingsprofilen «${profileName}».`;
  }
  return `Du har ${count} nye anbud som passer varslingsprofilen «${profileName}».`;
}

export function plannedHeadingWithCount(count: number): string {
  return `${DIGEST_NB.plannedHeading} (${count})`;
}

/** The footer (spec section 25). */
export const FOOTER_NB = {
  whyHeading: 'Hvorfor mottar jeg denne e-posten?',
  whyTenderAlerts:
    'Du mottar denne e-posten fordi du har opprettet en varslingsprofil i Luma Anbudsvarsling.',
  whyTransactional: 'Du mottar denne e-posten fordi den gjelder kontoen din i Luma Anbudsvarsling.',
  manageProfile: 'Administrer varslingsprofil',
  pauseAlerts: 'Pause varsler',
  unsubscribeTenderAlerts: 'Avslutt anbudsvarsling',
  /** Spec section 26, item 8 and section 22. Used inside the promotion block. */
  disablePromotion: 'Slå av Luma-informasjon i anbudsvarslene',
  /**
   * The same destination, worded neutrally. Used in the notification-settings
   * section, which renders identically whether or not promotion is on, so the
   * label cannot say "slå av" to someone who already did.
   */
  promotionSetting: 'Luma-informasjon i anbudsvarslene',
  notificationSettings: 'Varslingsinnstillinger',
  privacy: 'Personvern',
  terms: 'Vilkår for bruk',
  accountSettings: 'Kontoinnstillinger',
} as const;

/** The promotion block (spec sections 23 and 43). Headings come from @luma/domain. */
export const PROMOTION_NB = {
  /** Shown as the last line of the block, next to the off switch. */
  offSwitchIntro: 'Du kan slå av denne delen uten å stoppe anbudsvarslene.',
  readMore: 'Les mer',
} as const;

/** auth-magic-link-v1 (spec section 10). */
export const MAGIC_LINK_NB = {
  subject: 'Logg inn i Luma Anbudsvarsling',
  heading: 'Logg inn',
  intro: 'Bruk lenken under for å logge inn i Luma Anbudsvarsling.',
  action: 'Logg inn',
  singleUse: 'Lenken kan brukes én gang.',
  notRequested:
    'Har du ikke bedt om denne e-posten, kan du se bort fra den. Da skjer det ingenting med kontoen din.',
  fallbackIntro: 'Fungerer ikke knappen? Kopier denne adressen inn i nettleseren:',
} as const;

export function magicLinkValiditySentence(minutes: number): string {
  return `Lenken er gyldig i ${minutes} minutter.`;
}

/** alert-confirmation-v1 (spec section 11). */
export const ALERT_CONFIRMATION_NB = {
  heading: 'Varslingsprofilen er aktiv',
  intro:
    'Vi følger med på nye kunngjøringer på Doffin og sender deg treff som passer kriteriene dine.',
  frequencyLabel: 'Varslingsfrekvens',
  criteriaHeading: 'Kriteriene dine',
  cpvLabel: 'CPV-koder',
  keywordsLabel: 'Søkeord',
  regionsLabel: 'Geografi',
  buyersLabel: 'Oppdragsgivere',
  valueLabel: 'Verdiintervall',
  plannedIncludedLabel: 'Planlagte anskaffelser',
  plannedIncludedYes: 'Inkludert',
  plannedIncludedNo: 'Ikke inkludert',
  noCriteria: 'Ingen',
  action: 'Se varslingsprofilen',
  /** Spec section 43, "Dekningstekst". Reproduced verbatim. */
  coverageText:
    'Tjenesten dekker kunngjøringer publisert på Doffin. Anskaffelser under terskelverdiene publiseres ikke alltid der, og spørsmål og svar i konkurranser skjer i oppdragsgivers konkurranseverktøy. Følg derfor alltid konkurransens egne kanaler når du jobber med et anbud. At du ikke får varsel, betyr ikke at det ikke finnes muligheter.',
  /** Spec section 43, "Tillitstekst". Reproduced verbatim. */
  trustText:
    'Vi rangerer anbud etter hvor godt de passer varslingsprofilen din. Kurs, annonser eller kommersielle hensyn påvirker aldri hvilke anbud du får se.',
} as const;

export function alertConfirmationSubject(profileName: string): string {
  return `Varslingsprofilen «${profileName}» er aktiv`;
}

export const FREQUENCY_LABEL_NB = {
  immediate: 'Umiddelbart',
  daily: 'Daglig sammendrag',
  weekly: 'Ukentlig sammendrag',
} as const;

/** tender-material-change-v1 (spec section 13). */
export const MATERIAL_CHANGE_NB = {
  heading: 'Endring i et anbud du følger',
  intro: 'Oppdragsgiver har endret kunngjøringen. Dette er registrert siden sist:',
  previousLabel: 'Før',
  currentLabel: 'Nå',
  /** Spec section 5, point 1: the KGV communication stream is not covered. */
  kgvNote:
    'Spørsmål og svar i konkurransen skjer i oppdragsgivers eget konkurranseverktøy og fanges ikke opp her. Følg derfor alltid konkurransens egne kanaler.',
  verifyAtSource: 'Kontrollér alltid kunngjøringen på Doffin før du planlegger videre.',
} as const;

export function materialChangeSubject(title: string): string {
  return `Endring i anbudet: ${title}`;
}

export function immediateSubject(title: string): string {
  return `Nytt anbud: ${title}`;
}

export function dailyDigestSubject(count: number, profileName: string): string {
  if (count === 0) return `Ingen nye anbud i dag – «${profileName}»`;
  if (count === 1) return `Ett nytt anbud i dag – «${profileName}»`;
  return `${count} nye anbud i dag – «${profileName}»`;
}

export function weeklyDigestSubject(count: number, profileName: string): string {
  if (count === 0) return `Ingen nye anbud denne uken – «${profileName}»`;
  if (count === 1) return `Ett nytt anbud denne uken – «${profileName}»`;
  return `${count} nye anbud denne uken – «${profileName}»`;
}

/** order-request-received-v1 (spec section 28.2). */
export const ORDER_RECEIVED_NB = {
  subject: 'Vi har mottatt bestillingen din',
  heading: 'Bestillingen er mottatt',
  intro: 'Takk for bestillingen. Vi behandler den manuelt og tar kontakt hvis noe er uklart.',
  productLabel: 'Produkt',
  companyLabel: 'Fakturamottaker',
  organizationNumberLabel: 'Organisasjonsnummer',
  addressLabel: 'Fakturaadresse',
  invoiceEmailLabel: 'Faktura-e-post',
  contactPersonLabel: 'Kontaktperson',
  customerReferenceLabel: 'Deres referanse',
  purchaseOrderLabel: 'Bestillingsnummer',
  statusLabel: 'Status',
  paymentHeading: INVOICE_COPY_NB.paymentMethod,
  priceExcludesVat: INVOICE_COPY_NB.priceExcludesVat,
  invoiceWillBeSent: INVOICE_COPY_NB.invoiceWillBeSent,
  activationAfterHandling: INVOICE_COPY_NB.activationAfterHandling,
  freeServiceReminder:
    'Anbudsvarslingen er og forblir gratis. Denne bestillingen gjelder bare produktet over.',
} as const;

/** paid-access-activated-v1 (spec section 28.2, step 5). */
export const PAID_ACCESS_NB = {
  subject: 'Tilgangen din er aktivert',
  heading: 'Tilgangen er aktivert',
  action: 'Kom i gang',
  invoiceNote: 'Faktura sendes til fakturaadressen du oppga i bestillingen.',
} as const;

export function paidAccessIntro(productName: string): string {
  return `Tilgangen til ${productName} er nå aktivert.`;
}

/** account-delete-confirmation-v1 (spec sections 4.4 and 18). */
export const ACCOUNT_DELETE_NB = {
  subject: 'Kontoen din i Luma Anbudsvarsling er slettet',
  heading: 'Kontoen er slettet',
  intro: 'Kontoen din i Luma Anbudsvarsling er slettet.',
  deletedHeading: 'Dette er fjernet',
  deletedItems: [
    'Varslingsprofilene dine og kriteriene i dem',
    'Treff, lagrede anbud og relevansfeedback',
    'Delingslenker og MCP-tokener',
    'Påmeldingen til anbudsvarsler',
  ],
  retainedHeading: 'Dette beholder vi',
  retainedBody:
    'Samtykkehistorikk, aksept av vilkår og eventuelle fakturaopplysninger beholdes så lenge regnskaps- og dokumentasjonsplikten krever det. Se personvernerklæringen for lagringstider.',
  noMoreEmails: 'Du får ingen flere anbudsvarsler fra oss.',
  comeBack: 'Du er velkommen til å opprette en ny konto senere. Tjenesten er gratis.',
} as const;

/** Empty-state and fallback strings shared across surfaces. */
export const FALLBACK_NB = {
  unknownBuyer: 'Ukjent oppdragsgiver',
  unknownDeadline: 'Ikke oppgitt',
} as const;
