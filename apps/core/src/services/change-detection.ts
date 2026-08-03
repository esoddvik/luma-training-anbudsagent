import type { NoticeCategory, TenderChangeKind, TenderStatus } from '@luma/domain';

/**
 * Detecting material changes to a tender (spec §13).
 *
 * "Material" means worth telling a user about. The payload hash already tells
 * us *that* something changed; this module decides whether the change is one a
 * supplier would want an email about. A buyer fixing a typo in a description
 * must not produce a notification, and a moved deadline must.
 *
 * Every summary is Norwegian, because it is shown to the user directly in the
 * digest's "endringer i lagrede anbud" section.
 */

export interface ComparableTender {
  title: string;
  description?: string | null;
  buyerName: string;
  noticeCategory: NoticeCategory;
  status: TenderStatus;
  deadlineAt?: Date | null;
  estimatedValueMinNok?: number | null;
  procedureType?: string | null;
  cpvCodes: readonly string[];
}

export interface DetectedChange {
  kind: TenderChangeKind;
  /** Norwegian, shown to the user. */
  summary: string;
  previousValue?: string;
  currentValue?: string;
}

/**
 * A description edit below this ratio is treated as a correction rather than a
 * change of substance. Buyers routinely fix spelling and reformat whitespace,
 * and a notification for that trains users to ignore the ones that matter.
 */
const DESCRIPTION_CHANGE_THRESHOLD = 0.15;

function formatDate(value: Date | null | undefined): string {
  if (!value) return 'ingen frist';
  return value.toISOString().slice(0, 10);
}

function formatValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'ikke oppgitt';
  return `${value.toLocaleString('nb-NO')} kr`;
}

/**
 * Rough edit distance as a fraction of the longer string.
 *
 * Deliberately cheap rather than a true Levenshtein: descriptions run to
 * thousands of characters and this runs for every notice on every sync. Length
 * difference plus a prefix comparison distinguishes a reworded scope from a
 * fixed typo well enough for the decision being made.
 */
function changeRatio(before: string, after: string): number {
  if (before === after) return 0;
  const longer = Math.max(before.length, after.length);
  if (longer === 0) return 0;

  const lengthDelta = Math.abs(before.length - after.length);
  let sharedPrefix = 0;
  const limit = Math.min(before.length, after.length);
  while (sharedPrefix < limit && before[sharedPrefix] === after[sharedPrefix]) sharedPrefix += 1;

  return Math.max(lengthDelta, longer - sharedPrefix) / longer;
}

export function detectChanges(before: ComparableTender, after: ComparableTender): DetectedChange[] {
  const changes: DetectedChange[] = [];

  // Ordered by how much a supplier cares. A cancellation makes everything else
  // moot, and a moved deadline is the single most actionable change there is.
  if (before.status !== 'cancelled' && after.status === 'cancelled') {
    changes.push({
      kind: 'cancelled',
      summary: 'Konkurransen er avlyst.',
      previousValue: before.status,
      currentValue: after.status,
    });
    // Nothing below this matters once the competition is gone.
    return changes;
  }

  if (before.deadlineAt?.getTime() !== after.deadlineAt?.getTime()) {
    const moved = after.deadlineAt && before.deadlineAt && after.deadlineAt > before.deadlineAt;
    changes.push({
      kind: 'deadline_changed',
      summary: after.deadlineAt
        ? `Fristen er ${moved ? 'utsatt' : 'endret'} til ${formatDate(after.deadlineAt)}.`
        : 'Fristen er fjernet fra kunngjøringen.',
      previousValue: formatDate(before.deadlineAt),
      currentValue: formatDate(after.deadlineAt),
    });
  }

  // The transition spec §13 names explicitly: a planned procurement becoming a
  // live competition is the moment the user has been waiting for.
  if (before.noticeCategory === 'planned' && after.noticeCategory === 'competition') {
    changes.push({
      kind: 'planned_became_competition',
      summary: 'Den planlagte anskaffelsen er nå en aktiv konkurranse.',
      previousValue: before.noticeCategory,
      currentValue: after.noticeCategory,
    });
  }

  if (before.status !== after.status) {
    changes.push({
      kind: 'status_changed',
      summary: `Statusen er endret fra ${before.status} til ${after.status}.`,
      previousValue: before.status,
      currentValue: after.status,
    });
  }

  if (before.title !== after.title) {
    changes.push({
      kind: 'title_changed',
      summary: 'Tittelen på kunngjøringen er endret.',
      previousValue: before.title,
      currentValue: after.title,
    });
  }

  const beforeDescription = before.description ?? '';
  const afterDescription = after.description ?? '';
  if (changeRatio(beforeDescription, afterDescription) > DESCRIPTION_CHANGE_THRESHOLD) {
    changes.push({
      kind: 'description_changed',
      summary: 'Beskrivelsen av oppdraget er vesentlig endret.',
    });
  }

  const beforeCpv = [...before.cpvCodes].sort().join(',');
  const afterCpv = [...after.cpvCodes].sort().join(',');
  if (beforeCpv !== afterCpv) {
    changes.push({
      kind: 'cpv_changed',
      summary: 'CPV-kodene på kunngjøringen er endret.',
      previousValue: beforeCpv,
      currentValue: afterCpv,
    });
  }

  if (before.buyerName !== after.buyerName) {
    changes.push({
      kind: 'buyer_changed',
      summary: `Oppdragsgiver er endret til ${after.buyerName}.`,
      previousValue: before.buyerName,
      currentValue: after.buyerName,
    });
  }

  if (before.estimatedValueMinNok !== after.estimatedValueMinNok) {
    changes.push({
      kind: 'value_changed',
      summary: `Anslått verdi er endret til ${formatValue(after.estimatedValueMinNok)}.`,
      previousValue: formatValue(before.estimatedValueMinNok),
      currentValue: formatValue(after.estimatedValueMinNok),
    });
  }

  if ((before.procedureType ?? null) !== (after.procedureType ?? null)) {
    changes.push({
      kind: 'procedure_changed',
      summary: 'Prosedyren for konkurransen er endret.',
      previousValue: before.procedureType ?? 'ikke oppgitt',
      currentValue: after.procedureType ?? 'ikke oppgitt',
    });
  }

  return changes;
}

/** True when any detected change warrants notifying a user who saved the tender. */
export function isNotifiable(changes: readonly DetectedChange[]): boolean {
  return changes.length > 0;
}
