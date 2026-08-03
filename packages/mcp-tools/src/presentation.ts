import {
  confidenceLabel,
  SCORE_DISCLAIMER_NB,
  type MatchConfidence,
  type MatchExclusion,
  type MatchReason,
  type MatchResult,
  type NoticeCategory,
  type Tender,
  type TenderChangeEvent,
  type TenderStatus,
} from '@luma/domain';
import { isNationwide } from '@luma/matching';
import { quarantineTenderText, sanitizeShortField, type ExternalTenderText } from './untrusted.js';
import type { UserTenderState } from './ports.js';

/**
 * The shapes tool results are made of.
 *
 * These are read by a language model, not by a browser, which sets the rules:
 * flat, labelled Norwegian fields; dates as ISO strings; no raw database row;
 * `null` plus a Norwegian note wherever the source has nothing, never an
 * invented value (spec section 41: do not fabricate a deadline or a value).
 *
 * Three absences are deliberate and each has a reason in the data:
 *
 * - **No `kommuner` field.** `locationId` on Doffin is NUTS-3 at its finest,
 *   which is county level. `Tender.municipalities` therefore arrives empty for
 *   every real notice, and an always-empty array reads to a model as "this
 *   tender covers no municipality" rather than "this is not published".
 * - **No `rawPayload`.** It is the source row, it is unbounded, and it is
 *   untrusted text with no envelope. `kildedata` carries the provenance fields
 *   spec section 4.5 actually requires, and the source link carries the rest.
 * - **No percentage anywhere.** A score is points out of 100 against a
 *   profile; rendering it with a `%` is exactly the "94 % chance of winning"
 *   reading spec section 4.3 forbids.
 */

/* -------------------------------------------------------------------------- */
/* Norwegian labels                                                           */
/* -------------------------------------------------------------------------- */

export const CATEGORY_LABEL_NB: Readonly<Record<NoticeCategory, string>> = {
  planned: 'Planlagt anskaffelse',
  competition: 'Aktiv konkurranse',
  award: 'Tildelingskunngjøring',
  other: 'Annen kunngjøring',
};

export const STATUS_LABEL_NB: Readonly<Record<TenderStatus, string>> = {
  open: 'Åpen',
  closed: 'Lukket',
  cancelled: 'Avlyst',
  awarded: 'Tildelt',
  /**
   * Doffin leaves `status` null on every non-competition notice, so this is
   * the normal state of a planned procurement rather than a data problem.
   */
  unknown: 'Ikke oppgitt av kilden',
};

export const NATIONWIDE_LABEL_NB = 'Hele landet';
export const NO_GEOGRAPHY_LABEL_NB = 'Område ikke oppgitt';

/** Spec section 32.1 `find_matching_tenders`: planned notices have no deadline. */
export const PLANNED_NO_DEADLINE_NB =
  'Planlagt anskaffelse. Konkurransen er ikke publisert ennå, så det finnes ingen tilbudsfrist.';

export const MISSING_DEADLINE_NB = 'Ingen frist oppgitt i kunngjøringen.';

/**
 * Just over half of all notices carry no value at all (Doffin findings section
 * 9: null in 530 of 1000). Saying so is the honest answer; guessing is not.
 */
export const MISSING_VALUE_NB = 'Anslått verdi er ikke oppgitt i kunngjøringen.';

/** The currency is not always NOK, so a bare number would be misleading. */
export function foreignCurrencyNoteNb(currency: string): string {
  return `Beløpet er oppgitt i ${currency}, ikke i norske kroner. Kilden oppgir ingen omregningskurs.`;
}

/* -------------------------------------------------------------------------- */
/* Tender view                                                                */
/* -------------------------------------------------------------------------- */

export interface TenderView {
  readonly id: string;
  /** The Doffin notice number, e.g. `2026-014392`. */
  readonly doffinId: string;
  readonly kunngjoringsId: string | null;
  /** Spec section 31: the source link travels with every tender result. */
  readonly kildelenke: string;
  readonly tittel: string;
  readonly oppdragsgiver: string;
  readonly oppdragsgiverOrgnr: string | null;
  readonly kategori: NoticeCategory;
  readonly kategoriLabel: string;
  readonly status: TenderStatus;
  readonly statusLabel: string;
  readonly kunngjoringstype: string | null;
  readonly prosedyre: string | null;
  readonly cpvKoder: readonly string[];
  readonly omrader: readonly string[];
  readonly omradeLabel: string;
  /** Date only: Doffin publishes `publicationDate` without a time component. */
  readonly publisert: string;
  readonly frist: string | null;
  readonly fristMerknad: string | null;
  readonly anslattVerdiMin: number | null;
  readonly anslattVerdiMaks: number | null;
  readonly verdiValuta: string | null;
  readonly verdiMerknad: string | null;
  /** Luma-authored, facts only. Something a model can quote without drifting. */
  readonly oppsummering: string;
  readonly eksternTekst: ExternalTenderText;
}

export interface SourceMetadataView {
  readonly kilde: string;
  readonly kildeId: string;
  readonly kunngjoringsId: string | null;
  readonly kildelenke: string;
  readonly kilderevisjon: string | null;
  readonly sistEndret: string | null;
  readonly sistSynkronisert: string;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoInstant(date: Date): string {
  return date.toISOString();
}

/** `14 000 000` — plain spaces, so the string is byte-stable across runtimes. */
function groupDigits(amount: number): string {
  const rounded = Math.round(amount);
  const digits = Math.abs(rounded).toString();
  let grouped = '';
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) grouped += ' ';
    grouped += digits.charAt(index);
  }
  return `${rounded < 0 ? '-' : ''}${grouped}`;
}

export function geographyLabel(tender: Tender): string {
  if (isNationwide(tender)) return NATIONWIDE_LABEL_NB;
  if (tender.regions.length === 0) return NO_GEOGRAPHY_LABEL_NB;
  return tender.regions.join(', ');
}

function deadlineNote(tender: Tender): string | null {
  if (tender.deadlineAt !== undefined) return null;
  return tender.noticeCategory === 'planned' ? PLANNED_NO_DEADLINE_NB : MISSING_DEADLINE_NB;
}

function valueNote(tender: Tender): string | null {
  if (tender.estimatedValueMinNok === undefined && tender.estimatedValueMaxNok === undefined) {
    return MISSING_VALUE_NB;
  }
  const currency = tender.currency;
  if (currency !== undefined && currency !== 'NOK') return foreignCurrencyNoteNb(currency);
  return null;
}

/**
 * A short Norwegian sentence per tender, assembled only from fields that are
 * actually present.
 *
 * It exists so a model has something faithful to quote instead of composing
 * its own gloss from the description. It states the category, the buyer, the
 * title, the dates and the value, and where the source is silent it says so.
 * The title and buyer name come from the notice, so both pass through
 * `sanitizeShortField`; everything else is Luma's own wording.
 */
export function tenderSummaryNb(tender: Tender): string {
  const parts: string[] = [];
  const tittel = sanitizeShortField(tender.title);
  const oppdragsgiver = sanitizeShortField(tender.buyerName);

  parts.push(`${CATEGORY_LABEL_NB[tender.noticeCategory]} fra ${oppdragsgiver}: «${tittel}».`);
  parts.push(`Publisert ${isoDate(tender.publishedAt)}.`);

  if (tender.deadlineAt !== undefined) {
    parts.push(`Tilbudsfrist ${isoInstant(tender.deadlineAt)}.`);
  } else if (tender.noticeCategory === 'planned') {
    parts.push('Ingen tilbudsfrist ennå, fordi konkurransen ikke er publisert.');
  } else {
    parts.push('Ingen frist oppgitt.');
  }

  const min = tender.estimatedValueMinNok;
  const max = tender.estimatedValueMaxNok;
  const currency = tender.currency ?? 'NOK';
  if (min !== undefined && max !== undefined && min !== max) {
    parts.push(`Anslått verdi ${groupDigits(min)}–${groupDigits(max)} ${currency}.`);
  } else if (min !== undefined || max !== undefined) {
    parts.push(`Anslått verdi ${groupDigits((min ?? max) as number)} ${currency}.`);
  } else {
    parts.push('Verdi ikke oppgitt.');
  }

  parts.push(`Område: ${geographyLabel(tender)}.`);
  if (tender.cpvCodes.length > 0) parts.push(`CPV: ${tender.cpvCodes.join(', ')}.`);

  return parts.join(' ');
}

export function toTenderView(tender: Tender): TenderView {
  return {
    id: tender.id,
    doffinId: tender.sourceId,
    kunngjoringsId: tender.noticeId ?? null,
    kildelenke: tender.sourceUrl,
    tittel: sanitizeShortField(tender.title),
    oppdragsgiver: sanitizeShortField(tender.buyerName),
    oppdragsgiverOrgnr: tender.buyerOrganizationNumber ?? null,
    kategori: tender.noticeCategory,
    kategoriLabel: CATEGORY_LABEL_NB[tender.noticeCategory],
    status: tender.status,
    statusLabel: STATUS_LABEL_NB[tender.status],
    kunngjoringstype: tender.noticeType ?? null,
    prosedyre: tender.procedureType ?? null,
    cpvKoder: tender.cpvCodes,
    omrader: tender.regions,
    omradeLabel: geographyLabel(tender),
    publisert: isoDate(tender.publishedAt),
    frist: tender.deadlineAt !== undefined ? isoInstant(tender.deadlineAt) : null,
    fristMerknad: deadlineNote(tender),
    anslattVerdiMin: tender.estimatedValueMinNok ?? null,
    anslattVerdiMaks: tender.estimatedValueMaxNok ?? null,
    verdiValuta: tender.currency ?? null,
    verdiMerknad: valueNote(tender),
    oppsummering: tenderSummaryNb(tender),
    eksternTekst: quarantineTenderText(tender.description),
  };
}

export function toSourceMetadataView(tender: Tender): SourceMetadataView {
  return {
    kilde: tender.source,
    kildeId: tender.sourceId,
    kunngjoringsId: tender.noticeId ?? null,
    kildelenke: tender.sourceUrl,
    kilderevisjon: tender.sourceRevision ?? null,
    sistEndret: tender.modifiedAt !== undefined ? isoInstant(tender.modifiedAt) : null,
    sistSynkronisert: isoInstant(tender.lastSyncedAt),
  };
}

/* -------------------------------------------------------------------------- */
/* Match view                                                                 */
/* -------------------------------------------------------------------------- */

export interface ReasonView {
  readonly type: string;
  readonly label: string;
  readonly poeng: number;
  readonly grunnlag: readonly string[];
}

export interface ExclusionView {
  readonly type: string;
  readonly label: string;
  readonly grunnlag: readonly string[];
}

export interface SavedStateView {
  readonly lagret: boolean;
  readonly lagretTidspunkt: string | null;
  readonly avvist: boolean;
  readonly avvistTidspunkt: string | null;
}

export interface MatchView {
  readonly anbud: TenderView;
  readonly varslingsprofilId: string;
  /** Points out of 100 against the profile. Never rendered as a percentage. */
  readonly treffscore: number;
  readonly sikkerhet: MatchConfidence;
  /** Approved wording from `CONFIDENCE_LABEL_NB` (spec section 4.3). */
  readonly sikkerhetLabel: string;
  /** `SCORE_DISCLAIMER_NB`, present wherever a score is (spec section 4.3). */
  readonly forbehold: string;
  readonly begrunnelser: readonly ReasonView[];
  readonly eksklusjoner: readonly ExclusionView[];
  readonly regelversjon: string;
  /** Null when the caller's token has no `saved:read` scope. */
  readonly lagretstatus: SavedStateView | null;
}

export function toReasonView(reason: MatchReason): ReasonView {
  return {
    type: reason.type,
    label: reason.label,
    poeng: reason.contribution,
    grunnlag: reason.evidence,
  };
}

export function toExclusionView(exclusion: MatchExclusion): ExclusionView {
  return { type: exclusion.type, label: exclusion.label, grunnlag: exclusion.evidence };
}

export function toSavedStateView(state: UserTenderState | undefined): SavedStateView {
  return {
    lagret: state?.saved ?? false,
    lagretTidspunkt: state?.savedAt ? isoInstant(state.savedAt) : null,
    avvist: state?.dismissed ?? false,
    avvistTidspunkt: state?.dismissedAt ? isoInstant(state.dismissedAt) : null,
  };
}

export function toMatchView(
  tender: Tender,
  result: MatchResult,
  savedState: SavedStateView | null,
): MatchView {
  return {
    anbud: toTenderView(tender),
    varslingsprofilId: result.alertProfileId,
    treffscore: result.score,
    sikkerhet: result.confidence,
    sikkerhetLabel: confidenceLabel(result.confidence),
    forbehold: SCORE_DISCLAIMER_NB,
    begrunnelser: result.reasons.map(toReasonView),
    eksklusjoner: result.exclusions.map(toExclusionView),
    regelversjon: result.matchingVersion,
    lagretstatus: savedState,
  };
}

/* -------------------------------------------------------------------------- */
/* Change history                                                             */
/* -------------------------------------------------------------------------- */

export interface ChangeView {
  readonly type: string;
  readonly beskrivelse: string;
  readonly fra: string | null;
  readonly til: string | null;
  readonly oppdaget: string;
}

export function toChangeView(change: TenderChangeEvent): ChangeView {
  return {
    type: change.kind,
    beskrivelse: change.summary,
    fra: change.previousValue ?? null,
    til: change.currentValue ?? null,
    oppdaget: isoInstant(change.detectedAt),
  };
}
