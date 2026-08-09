import { createHmac } from 'node:crypto';
import type { Logger } from '@luma/observability';

/**
 * Telling the web app which notice pages went stale
 * (IDE Agent Spec v3, section 3.3).
 *
 * The ingest job already knows exactly which notices changed, so the public
 * pages for those — and only those — are purged. The alternative the spec
 * rejects is `generateStaticParams` over the whole corpus, which would make
 * every deploy slower than the last and still leave a moved deadline invisible
 * for up to an hour.
 *
 * ## Failing here must not fail the ingest
 *
 * A purge that does not happen costs freshness: the page corrects itself on
 * its own `revalidate` window instead. An ingest run that *fails* costs far
 * more, because `runIngest` refuses to advance the checkpoint on a partial
 * run — and a systematic failure there is what stalled ingest for weeks
 * before. So every error is caught and logged, never rethrown. That trade is
 * only defensible because the fallback is real: the pages do regenerate
 * without this, just later.
 */

export interface RevalidateOptions {
  readonly appUrl: string;
  readonly secret: string;
  readonly tenderIds: readonly string[];
  readonly logger: Logger;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/** The most ids the route accepts in one call. Batched to match. */
const MAX_PER_REQUEST = 500;

export async function requestRevalidation(options: RevalidateOptions): Promise<number> {
  const { appUrl, secret, tenderIds, logger } = options;
  if (tenderIds.length === 0) return 0;

  const fetchImpl = options.fetchImpl ?? fetch;
  let purged = 0;

  for (let offset = 0; offset < tenderIds.length; offset += MAX_PER_REQUEST) {
    const batch = tenderIds.slice(offset, offset + MAX_PER_REQUEST);
    const raw = JSON.stringify({ tenderIds: batch });
    const signature = createHmac('sha256', secret).update(raw, 'utf8').digest('hex');

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
      const response = await fetchImpl(`${appUrl}/revalider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-luma-signature': signature },
        body: raw,
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!response.ok) {
        // The status only. A revalidation body carries tender ids and nothing
        // secret, but there is no reason to widen what reaches the log.
        logger.warn({ status: response.status, count: batch.length }, 'revalidation refused');
        continue;
      }
      purged += batch.length;
    } catch (error) {
      logger.warn(
        { count: batch.length, reason: error instanceof Error ? error.name : 'unknown' },
        'revalidation request failed; pages will refresh on their own schedule',
      );
    }
  }

  return purged;
}
