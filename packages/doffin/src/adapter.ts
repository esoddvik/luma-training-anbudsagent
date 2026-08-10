import type { SourceTenderNotice } from './source-notice.js';

/**
 * The source-neutral adapter contract (spec §12, ADR-7).
 *
 * Doffin field names never cross this boundary. A future TED adapter
 * implements the same interface, and nothing downstream needs to change.
 *
 * The interface differs from spec §12 in one respect, and the reason is
 * empirical: the spec assumed a `modifiedAfter` watermark, and the Doffin API
 * has no modification timestamp, filter or sort of any kind. The watermark is
 * therefore publication-based. See `docs/doffin-api-findings.md` §6.
 */
export interface FetchNoticesInput {
  /**
   * Return notices published on or after this date.
   *
   * **Applied by the caller, not by the source.** `publicationDate` is
   * sortable but not filterable (`docs/doffin-api-findings.md`), so the
   * adapter cannot narrow on it and `runSync` trims the tail client-side after
   * the fact. Kept in the port because it is what the *sync* is expressed in —
   * the checkpoint is a publication-date watermark — but it does not reduce
   * what the source sends.
   */
  publishedFrom?: Date;
  /**
   * Inclusive bounds on `issueDate`, which is the one date the source will
   * actually filter on, at day granularity.
   *
   * These exist for one purpose: **partitioning a backfill.** Doffin serves at
   * most 1000 hits per query however you page, so reaching further back than
   * that is impossible without splitting the query — and an issue-date window
   * is the only split the API offers that is dense enough to be useful. A
   * single month returned 939 hits when measured, so a month is roughly the
   * coarsest safe window.
   *
   * **`issueDate` is not `publicationDate`.** A notice can be published up to
   * seven days after it was issued (verified, same document), so a caller
   * wanting a publication-date range must widen the issue-date window at both
   * ends and filter the result. That asymmetry is why the ordinary forward
   * sync watermarks on publication date and ignores these entirely.
   */
  issuedFrom?: Date;
  issuedTo?: Date;
  /** 1-indexed. Doffin rejects page 0. */
  page?: number;
  pageSize?: number;
}

export interface FetchNoticesResult {
  notices: SourceTenderNotice[];
  /** Matches in the whole database, which may exceed what is reachable. */
  totalMatches: number;
  /**
   * How many of those the source will actually serve. Doffin caps this at
   * 1000 regardless of paging, so a run that needs more must partition the
   * query rather than page further.
   */
  accessibleMatches: number;
  hasMore: boolean;
}

export interface TenderSourceAdapter {
  readonly source: 'doffin';
  fetchNotices(input: FetchNoticesInput): Promise<FetchNoticesResult>;
  fetchNoticeById(sourceId: string): Promise<SourceTenderNotice | null>;
}

/** Raised when the source responds in a way the adapter cannot interpret. */
export class TenderSourceError extends Error {
  constructor(
    message: string,
    readonly detail: {
      status?: number;
      /** True when retrying later is likely to succeed. */
      retryable: boolean;
      retryAfterSeconds?: number;
    },
  ) {
    super(message);
    this.name = 'TenderSourceError';
  }
}
