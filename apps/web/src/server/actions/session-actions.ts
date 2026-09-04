'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME } from '@luma/auth';
import { BASE_PATH } from '@/lib/site';
import { getWebDb } from '../db';
import { databaseSessionStore, getCurrentUser } from '../session';

/**
 * Sign out (spec section 10).
 *
 * ## Why this did not exist until now
 *
 * Nothing in the app ever ended a session. `databaseSessionStore` has exposed
 * `revoke()` since sessions were built and no page, action or route called it;
 * a session simply expired. That was survivable while every signed-in route
 * was reachable, and it stops being survivable next to the terms gate: without
 * a way out, a user who declines new terms can only leave by deleting their
 * account, and "accept our terms or destroy your data" is not a position this
 * service can take about its own terms.
 *
 * ## Revoking, not just forgetting
 *
 * It revokes the session row and *then* clears the cookie. `validateSession`
 * reads `revoked_at` on every request, so revocation is what actually ends a
 * session — clearing the cookie alone leaves a live session behind that
 * anything still holding the token could keep using, which is the difference
 * between signing out and hiding the key.
 *
 * The cookie is deleted by name *and path*, for the reason `deleteAccountAction`
 * records: `jar.delete(name)` deletes at `/`, and a cookie scoped to
 * `/anbudsvarsling` is not that cookie.
 */
export async function signOutAction(): Promise<void> {
  const user = await getCurrentUser();

  if (user) {
    await databaseSessionStore(getWebDb()).revoke(user.sessionId, new Date());
  }

  const jar = await cookies();
  jar.delete({ name: SESSION_COOKIE_NAME, path: BASE_PATH });

  // Signed out is not an error, and the landing page is where a signed-out
  // person belongs. No message: they did what they meant to do.
  redirect('/');
}
