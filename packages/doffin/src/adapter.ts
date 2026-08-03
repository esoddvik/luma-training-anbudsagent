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
   * Return notices published on or after this date. The caller is responsible
   * for subtracting an overlap window; the adapter takes the value literally.
   */
  publishedFrom?: Date;
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
