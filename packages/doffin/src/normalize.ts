import { createHash } from 'node:crypto';
import { normalizeCpv, type JsonValue, type Tender } from '@luma/domain';
import { deriveNoticeCategory, deriveStatus, type DerivationWarning } from './notice-type.js';
import type { DoffinSearchHit } from './source-notice.js';

/**
 * Turning a Doffin search hit into the normalised tender model (spec §13).
 *
 * The awkward parts are all documented in `docs/doffin-api-findings.md`; this
 * module is where they are handled once so nothing downstream has to know
 * about them.
 */

/**
 * The `locationId` value Doffin uses for a nationwide procurement. It is not a
 * NUTS code. It appeared on 182 of 1000 sampled notices, making it the single
 * most common geography value, so treating it as an unmatched region would
 * quietly drop roughly a fifth of everything.
 */
export const NATIONWIDE_LOCATION = 'anyw';

/** NUTS code meaning the location was not specified. */
export const UNSPECIFIED_LOCATION = 'NOZZZ';

export const DOFFIN_NOTICE_URL_BASE = 'https://www.doffin.no/notices';

export interface NormalizedTender {
  tender: Omit<Tender, 'id' | 'createdAt' | 'updatedAt'>;
  /**
   * eForms linkage keys, available only from the XML download. Undefined when
   * the XML was not fetched. They are stored from day one because a correction
   * arrives as a new notice that references the old one only by these values,
   * and they cannot be backfilled without a full re-ingest.
   */
  noticeUuid?: string;
  contractFolderId?: string;
  /** Non-fatal derivation problems, for the ingestion log. */
  warnings: DerivationWarning[];
}

/**
 * Builds the public URL for a notice.
 *
 * Constructed rather than read: the API's own `doffinClassicUrl` was null in
 * all 1000 sampled notices.
 */
export function buildSourceUrl(sourceId: string): string {
  return `${DOFFIN_NOTICE_URL_BASE}/${encodeURIComponent(sourceId)}`;
}

/**
 * A stable hash of the source payload, used to tell a genuine change from a
 * re-fetch of identical data.
 *
 * Object keys are sorted before hashing, because JSON key order is not
 * guaranteed across responses and an order-sensitive hash would report every
 * notice as changed on every run.
 */
export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Parses `publicationDate`, which is a bare date with no time component.
 *
 * Interpreted as midnight UTC. The alternative, local Norwegian time, would
 * make the stored instant depend on which machine ran the ingest, and the
 * value is only ever used at day granularity anyway.
 */
export function parsePublicationDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function parseTimestamp(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Splits the location array into real NUTS regions and a nationwide flag.
 *
 * Exported because the matching engine needs the same distinction and must not
 * re-derive it from a magic string.
 */
export function partitionLocations(locations: readonly string[] | null | undefined): {
  regions: string[];
  isNationwide: boolean;
} {
  const values = locations ?? [];
  return {
    regions: values.filter(
      (value) => value !== NATIONWIDE_LOCATION && value !== UNSPECIFIED_LOCATION,
    ),
    isNationwide: values.includes(NATIONWIDE_LOCATION),
  };
}

/**
 * Normalises the CPV codes on a notice, dropping any that are malformed.
 *
 * Every code in a 1000-notice sample was a bare eight digits, but the CPV
 * standard also allows a check-digit suffix (`45000000-7`), which is ten
 * characters and does not fit the storage column. Rather than trusting the
 * sample, the check digit is stripped here so a notice that does carry one is
 * stored correctly instead of failing the whole row.
 *
 * A code that is not a CPV code at all is dropped with a warning rather than
 * failing the notice: losing one code costs some match precision, whereas
 * failing the row loses the tender entirely and holds back the checkpoint.
 */
export function normalizeCpvCodes(codes: readonly string[]): {
  codes: string[];
  warnings: DerivationWarning[];
} {
  const normalized: string[] = [];
  const warnings: DerivationWarning[] = [];

  for (const code of codes) {
    const digits = normalizeCpv(code);
    if (digits) {
      if (!normalized.includes(digits)) normalized.push(digits);
    } else {
      warnings.push({
        field: 'noticeType',
        value: code,
        message: `Ignored malformed CPV code "${code}".`,
      });
    }
  }

  return { codes: normalized, warnings };
}

export interface NormalizeOptions {
  now: Date;
  /** From the eForms XML, when it was fetched. */
  noticeUuid?: string;
  contractFolderId?: string;
}

export function normalizeSearchHit(
  hit: DoffinSearchHit,
  options: NormalizeOptions,
): NormalizedTender {
  const warnings: DerivationWarning[] = [];

  const category = deriveNoticeCategory(hit.type);
  if (category.warning) warnings.push(category.warning);

  const status = deriveStatus({ type: hit.type, status: hit.status });
  if (status.warning) warnings.push(status.warning);

  const cpv = normalizeCpvCodes(hit.cpvCodes);
  warnings.push(...cpv.warnings);

  const { regions, isNationwide } = partitionLocations(hit.locationId);
  const publishedAt = parsePublicationDate(hit.publicationDate);

  // A single scalar, absent in 53% of notices. Spec §13 models a range, so both
  // bounds take the same value rather than one being invented.
  const amount = hit.estimatedValue?.amount ?? undefined;
  const currency = hit.estimatedValue?.currencyCode ?? undefined;

  const buyer = hit.buyer[0];

  const tender: Omit<Tender, 'id' | 'createdAt' | 'updatedAt'> = {
    source: 'doffin',
    sourceId: hit.id,
    sourceUrl: buildSourceUrl(hit.id),

    title: hit.heading,
    buyerName: buyer?.name ?? 'Ukjent oppdragsgiver',

    cpvCodes: cpv.codes,
    // A nationwide notice is recorded as nationwide rather than as a region
    // list containing a fake code. The matching engine reads the flag.
    regions: isNationwide ? [NATIONWIDE_LOCATION, ...regions] : regions,
    // No municipality field exists in the API. NUTS-3 (county) is the finest
    // granularity available, so this stays empty rather than being filled from
    // the buyer's postal city, which is a different thing entirely.
    municipalities: [],

    noticeType: hit.type,
    noticeCategory: category.value,

    publishedAt,
    // Doffin exposes no modification timestamp of any kind. This field means
    // "when our ingest last observed a change", never a source watermark.
    ...(parseTimestamp(hit.deadline) ? { deadlineAt: parseTimestamp(hit.deadline) } : {}),

    status: status.value,

    sourcePayloadHash: hashPayload(hit),
    rawPayload: hit as unknown as JsonValue,

    lastSyncedAt: options.now,
  };

  if (hit.description) tender.description = hit.description;
  if (buyer?.organizationId) tender.buyerOrganizationNumber = buyer.organizationId;
  if (amount !== undefined) {
    tender.estimatedValueMinNok = amount;
    tender.estimatedValueMaxNok = amount;
  }
  if (currency) tender.currency = currency;
  if (options.noticeUuid) tender.noticeId = options.noticeUuid;

  const result: NormalizedTender = { tender, warnings };
  if (options.noticeUuid) result.noticeUuid = options.noticeUuid;
  if (options.contractFolderId) result.contractFolderId = options.contractFolderId;
  return result;
}

/**
 * The winning suppliers named on a notice.
 *
 * Available on award notices (219/219 sampled) and also on intention notices
 * (20/20), where the buyer names the supplier it intends to award to without
 * competition. Callers must check the notice category rather than inferring an
 * award from the presence of a winner.
 */
export function extractWinners(hit: DoffinSearchHit): Array<{
  name: string;
  organizationNumber?: string;
}> {
  const winners: Array<{ name: string; organizationNumber?: string }> = [];
  for (const lot of hit.lots ?? []) {
    for (const winner of lot.winner ?? []) {
      winners.push(
        winner.organizationId
          ? { name: winner.name, organizationNumber: winner.organizationId }
          : { name: winner.name },
      );
    }
  }
  return winners;
}
