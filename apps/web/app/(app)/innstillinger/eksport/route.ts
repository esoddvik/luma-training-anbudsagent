import { getCurrentUser } from '@/server/session';
import { getWebDb } from '@/server/db';
import { buildUserDataExport } from '@/server/export';

/**
 * Data export (spec section 4.4).
 *
 * A route handler rather than a page, because the answer is a file. Route
 * handlers do **not** run the `(app)` layout, so this resolves the session
 * itself — the layout's check protects pages, not endpoints.
 *
 * An unauthenticated request gets 401 with a Norwegian body rather than a
 * redirect: a download that silently turned into an HTML login page would save
 * a useless file.
 */

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return new Response('Du må være innlogget for å laste ned dataene dine.', {
      status: 401,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const data = await buildUserDataExport(getWebDb(), user.id);
  const filename = `luma-anbudsvarsling-eksport-${new Date().toISOString().slice(0, 10)}.json`;

  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      // The response is personal data; nothing may keep a copy.
      'cache-control': 'no-store, private',
    },
  });
}
