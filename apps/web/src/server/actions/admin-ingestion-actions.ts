'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { postToCore } from '../core-api';
import { requireAdmin } from '../session';
import { withMessage, type ActionMessageCode } from './messages';

/**
 * The two Doffin actions an administrator can trigger (spec §45).
 *
 * Both go through `core` rather than doing the work here: ingest needs the
 * Doffin adapter, and spec section 36 forbids running it as a request-bound
 * Vercel function. See `core-api.ts` for why the call forwards the operator's
 * session instead of using a service credential.
 *
 * `requireAdmin` runs here too, before the call. It is not the check that
 * matters — core runs its own against the same session, and that is the one
 * that authorises the work — but failing early means a non-admin gets this
 * app's 404 rather than a round trip to another service to be told no.
 */

const backfillForm = z.object({
  /** Capped at a year by core; repeated here so a bad value never leaves. */
  days: z.coerce.number().int().min(1).max(365),
});

interface BackfillReport {
  windows: number;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  truncatedWindows: readonly string[];
}

export async function runBackfillAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const parsed = backfillForm.safeParse({ days: formData.get('dager') ?? '90' });
  if (!parsed.success) {
    redirect(withMessage('/admin/ingestion', 'ugyldig'));
  }

  const result = await postToCore<BackfillReport>('/api/v1/admin/ingestion/backfill', {
    days: parsed.data.days,
  });

  revalidatePath('/admin/ingestion');

  if (!result.ok) {
    // A timeout is deliberately not reported as a failure. The run is inline
    // and long, so an aborted *request* usually means the work is still going
    // — telling an operator it failed would invite them to start a second one.
    redirect(
      withMessage(
        '/admin/ingestion',
        result.code === 'tidsavbrudd' ? 'backfill-tidsavbrudd' : 'backfill-feilet',
      ),
    );
  }

  redirect(
    withMessage(
      '/admin/ingestion',
      result.data.truncatedWindows.length > 0 ? 'backfill-delvis' : 'backfill-ferdig',
    ),
  );
}

export async function rerunIngestAction(): Promise<void> {
  await requireAdmin();

  const result = await postToCore<{ status: string }>('/api/v1/admin/ingestion/run', {});
  revalidatePath('/admin/ingestion');

  const code: ActionMessageCode = result.ok
    ? result.data.status === 'succeeded'
      ? 'innhenting-ferdig'
      : 'innhenting-delvis'
    : 'innhenting-feilet';
  redirect(withMessage('/admin/ingestion', code));
}
