import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { MACHINE_SIGNATURE_HEADER, machineSignatureMatches } from '@/server/machine-signature';

/**
 * On-demand revalidation, called by the ingest worker
 * (IDE Agent Spec v3, section 3.3).
 *
 * The public notice pages are generated on first request and then live on
 * `revalidate = 3600`. That is fine for a corpus that changes slowly and wrong
 * for the case that matters: a moved deadline or a cancelled competition is
 * exactly the change a supplier needs to see now, not up to an hour later.
 *
 * The ingest worker already knows precisely which notices changed —
 * `runIngest` returns `changedTenderIds` — so it tells this route, and only the
 * affected pages regenerate. That is why there is no `generateStaticParams`
 * over the corpus: enumerating thousands of notices at build time would be
 * slower every deploy and still stale within the hour, while this is exact.
 *
 * ## Why it is signed rather than merely secret
 *
 * See `@/server/machine-signature`, which now holds the check — it was written
 * out here and again in `/synk-tjenestemaler`, and a constant-time comparison
 * copied twice is one drift away from not being constant-time. It also could
 * not be tested while it lived in `app/`, which the web vitest project does not
 * collect.
 *
 * Purging a cache is not destructive — the worst a forged call achieves is
 * making pages regenerate — but it is free denial-of-service if unauthenticated,
 * because each purge costs a database read on the next request.
 */

const body = z.object({
  tenderIds: z.array(z.uuid()).min(1).max(500),
});

export async function POST(request: Request): Promise<Response> {
  const secret = process.env['CRON_SECRET'];
  if (!secret || secret.length === 0) {
    // Refusing is the safe failure. A route that revalidates for anyone when
    // its secret is missing would be most permissive exactly when the
    // environment is most broken.
    return Response.json({ error: 'revalidation_not_configured' }, { status: 503 });
  }

  const raw = await request.text();
  if (!machineSignatureMatches(raw, request.headers.get(MACHINE_SIGNATURE_HEADER), secret)) {
    return Response.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(JSON.parse(raw));
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }

  for (const id of parsed.tenderIds) {
    revalidatePath(`/kunngjoring/${id}`);
  }
  // The trade and regional pages list these notices, so a new or changed one
  // has to reach them too. Revalidating the layout segment covers every
  // `/anbud-for` page in one call rather than recomputing which trades a
  // notice's CPV codes happen to land in.
  revalidatePath('/anbud-for', 'layout');

  return Response.json({ revalidated: parsed.tenderIds.length });
}
