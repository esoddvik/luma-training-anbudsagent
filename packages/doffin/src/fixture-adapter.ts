import type { FetchNoticesInput, FetchNoticesResult, TenderSourceAdapter } from './adapter.js';
import {
  doffinSearchHitSchema,
  parsePublicationDateSafe,
  type SourceTenderNotice,
} from './source-notice.js';

/**
 * An adapter over captured payloads (spec §12).
 *
 * It exists so the whole pipeline can be developed and tested without network
 * access, and so integration tests are deterministic. It reproduces the real
 * API's ordering and paging behaviour deliberately, including the 1000-hit
 * ceiling, because a fixture adapter that is easier to use than the real thing
 * hides exactly the bugs it should be catching.
 */
export class FixtureTenderSourceAdapter implements TenderSourceAdapter {
  readonly source = 'doffin' as const;

  private readonly notices: SourceTenderNotice[];

  constructor(hits: readonly unknown[]) {
    this.notices = hits
      .map((hit) => doffinSearchHitSchema.parse(hit))
      .flatMap((hit): SourceTenderNotice[] => {
        const publishedAt = parsePublicationDateSafe(hit.publicationDate);
        if (!publishedAt) return [];
        return [{ sourceId: hit.id, publishedAt, payload: hit }];
      })
      // Publication date descending, matching the live API's default order.
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  }

  async fetchNotices(input: FetchNoticesInput): Promise<FetchNoticesResult> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 100;

    /*
     * `issuedFrom`/`issuedTo` filter on `issueDate`, not on publication date,
     * because that is the one the live API filters on — and reproducing that
     * distinction is the point of this adapter. A fixture that narrowed on
     * publication date would make a backfill's windows look exact while the
     * real one drops notices issued before a window and published inside it.
     */
    const issued = (notice: SourceTenderNotice): Date | null => {
      const raw = (notice.payload as { issueDate?: unknown }).issueDate;
      if (typeof raw !== 'string') return null;
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const matching = this.notices.filter((notice) => {
      if (input.publishedFrom && notice.publishedAt < input.publishedFrom) return false;
      if (input.issuedFrom || input.issuedTo) {
        const at = issued(notice);
        // A notice with no readable issue date cannot satisfy an issue-date
        // window. Dropping it matches the API, which filters server-side.
        if (!at) return false;
        if (input.issuedFrom && at < input.issuedFrom) return false;
        if (input.issuedTo && at > input.issuedTo) return false;
      }
      return true;
    });

    const accessibleMatches = Math.min(matching.length, 1000);
    const start = (page - 1) * pageSize;
    const slice = matching.slice(start, start + pageSize);

    return {
      notices: slice,
      totalMatches: matching.length,
      accessibleMatches,
      hasMore: start + pageSize < accessibleMatches,
    };
  }

  async fetchNoticeById(sourceId: string): Promise<SourceTenderNotice | null> {
    return this.notices.find((notice) => notice.sourceId === sourceId) ?? null;
  }
}
