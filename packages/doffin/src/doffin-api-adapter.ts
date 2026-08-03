import { z } from 'zod';
import {
  TenderSourceError,
  type FetchNoticesInput,
  type FetchNoticesResult,
  type TenderSourceAdapter,
} from './adapter.js';
import {
  doffinSearchResponseSchema,
  parsePublicationDateSafe,
  type SourceTenderNotice,
} from './source-notice.js';

/**
 * The live Doffin adapter.
 *
 * Everything here is shaped by what the API actually does, verified on
 * 2026-08-03 and written up in `docs/doffin-api-findings.md`. The three
 * behaviours that most affect the code:
 *
 * 1. An unrecognised query parameter is ignored and returns the entire
 *    unfiltered database with a 200. A typo therefore widens a query to
 *    157,000 notices while looking like it worked, so parameters are built
 *    from a closed set and never from caller-supplied names.
 * 2. Paging past the top 1000 hits is refused outright.
 * 3. Rate limiting is roughly 30 requests per 10 seconds, signalled by a 429
 *    with `Retry-After` and no quota headers to steer by in advance.
 */

export const DOFFIN_MAX_ACCESSIBLE_HITS = 1000;
export const DOFFIN_DEFAULT_PAGE_SIZE = 100;

/**
 * The only query parameters the adapter will ever send.
 *
 * Closed deliberately. Because Doffin silently ignores unknown parameters
 * rather than rejecting them, an open map would let a typo turn a narrow query
 * into a full-database scan with no error anywhere.
 */
const ALLOWED_PARAMS = [
  'numHitsPerPage',
  'page',
  'sortBy',
  'searchString',
  'cpvCode',
  'location',
  'type',
  'status',
  'issueDateFrom',
  'issueDateTo',
] as const;

type AllowedParam = (typeof ALLOWED_PARAMS)[number];

/** Gateway errors use statusCode+message; application errors use reason. */
const errorBodySchema = z.union([
  z.object({ statusCode: z.number(), message: z.string() }),
  z.object({ reason: z.string() }),
]);

export interface DoffinApiAdapterOptions {
  baseUrl: string;
  subscriptionKey: string;
  fetchImpl?: typeof fetch;
  /** Injected so retry behaviour is testable without real waiting. */
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  /** Guards against a hung request stalling an ingest run. */
  requestTimeoutMs?: number;
}

export class DoffinApiAdapter implements TenderSourceAdapter {
  readonly source = 'doffin' as const;

  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: DoffinApiAdapterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxRetries = options.maxRetries ?? 4;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  async fetchNotices(input: FetchNoticesInput): Promise<FetchNoticesResult> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? DOFFIN_DEFAULT_PAGE_SIZE;

    if (page < 1) {
      throw new TenderSourceError('page is 1-indexed', { retryable: false });
    }
    if (page * pageSize > DOFFIN_MAX_ACCESSIBLE_HITS) {
      throw new TenderSourceError(
        `Doffin serves at most ${DOFFIN_MAX_ACCESSIBLE_HITS} hits per query; ` +
          `page ${page} at size ${pageSize} is past that. Partition the query by date instead.`,
        { retryable: false },
      );
    }

    const params: Partial<Record<AllowedParam, string>> = {
      numHitsPerPage: String(pageSize),
      page: String(page),
      // Publication date descending is the only ordering compatible with a
      // publication-date watermark, and it is also the API default.
      sortBy: 'PUBLICATION_DATE_DESC',
    };

    const body = await this.request('/public/v2/search', params);
    const parsed = doffinSearchResponseSchema.parse(body);

    const notices = parsed.hits.flatMap((hit): SourceTenderNotice[] => {
      const publishedAt = parsePublicationDateSafe(hit.publicationDate);
      if (!publishedAt) return [];
      return [{ sourceId: hit.id, publishedAt, payload: hit }];
    });

    const consumed = page * pageSize;
    return {
      notices,
      totalMatches: parsed.numHitsTotal,
      accessibleMatches: parsed.numHitsAccessible,
      hasMore: consumed < Math.min(parsed.numHitsAccessible, DOFFIN_MAX_ACCESSIBLE_HITS),
    };
  }

  /**
   * There is no single-notice JSON endpoint, so this searches for the notice
   * and filters client-side. Confirmed: `/public/v2/notices/{id}` and every
   * variant of it return 404.
   */
  async fetchNoticeById(sourceId: string): Promise<SourceTenderNotice | null> {
    const body = await this.request('/public/v2/search', {
      searchString: sourceId,
      numHitsPerPage: '50',
      page: '1',
    });
    const parsed = doffinSearchResponseSchema.parse(body);
    const hit = parsed.hits.find((candidate) => candidate.id === sourceId);
    if (!hit) return null;

    const publishedAt = parsePublicationDateSafe(hit.publicationDate);
    if (!publishedAt) return null;
    return { sourceId: hit.id, publishedAt, payload: hit };
  }

  private async request(
    path: string,
    params: Partial<Record<AllowedParam, string>>,
  ): Promise<unknown> {
    const url = new URL(path, this.options.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (!ALLOWED_PARAMS.includes(key as AllowedParam)) {
        // Unreachable via the type system, but a runtime guard is warranted:
        // the failure mode is silent and expensive.
        throw new TenderSourceError(`refusing to send unknown Doffin parameter "${key}"`, {
          retryable: false,
        });
      }
      if (value !== undefined) url.searchParams.set(key, value);
    }

    let lastError: TenderSourceError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const response = await this.performRequest(url);

      if (response.ok) return response.json();

      const error = await this.toError(response);
      if (!error.detail.retryable) throw error;
      lastError = error;

      if (attempt === this.maxRetries) break;

      // Honour Retry-After when the gateway sends one; there are no quota
      // headers to pace against in advance, so this is the only signal.
      const waitMs = error.detail.retryAfterSeconds
        ? error.detail.retryAfterSeconds * 1000
        : Math.min(2 ** attempt * 1000, 16_000);
      await this.sleep(waitMs);
    }

    throw lastError ?? new TenderSourceError('Doffin request failed', { retryable: true });
  }

  private async performRequest(url: URL): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          // Azure API Management subscription key. Verified against the live
          // gateway; this is not the same as an Authorization bearer token.
          'Ocp-Apim-Subscription-Key': this.options.subscriptionKey,
          accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (cause) {
      throw new TenderSourceError('Doffin request failed to complete', {
        retryable: true,
        ...(cause instanceof Error ? {} : {}),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async toError(response: Response): Promise<TenderSourceError> {
    const retryAfter = Number(response.headers.get('retry-after'));
    let detail = '';
    try {
      const parsed = errorBodySchema.safeParse(await response.json());
      if (parsed.success) {
        detail = 'reason' in parsed.data ? parsed.data.reason : parsed.data.message;
      }
    } catch {
      // A bad sortBy value returns a 404 with an empty body, so an unparseable
      // response is expected rather than exceptional.
      detail = '(no body)';
    }

    // 401 means the key is wrong: retrying cannot fix it and would burn quota.
    const retryable = response.status === 429 || response.status >= 500;

    return new TenderSourceError(`Doffin responded ${response.status}: ${detail}`, {
      status: response.status,
      retryable,
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
    });
  }
}
