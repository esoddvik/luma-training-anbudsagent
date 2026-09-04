import type { ReactNode } from 'react';
import { requireUser } from '@/server/session';

/**
 * Signed in, and deliberately outside the terms gate (spec section 20.1).
 *
 * ## Why this group exists at all
 *
 * A Next.js layout does not receive the pathname, so `(app)`'s gate cannot
 * exempt one of its own children. Membership of a route group is therefore the
 * only way to say "authenticated, but not gated", and these routes have to be
 * reachable while an acceptance is outstanding:
 *
 * - **the acceptance page itself**, or the gate redirects to a page that
 *   redirects to the gate;
 * - **account deletion**, because "accept our new terms or you cannot delete
 *   your data" is exactly backwards, and the terms are the thing being
 *   changed;
 * - **sign-out**, rendered on the acceptance page, so declining is not a trap.
 *
 * Route groups do not change URLs. Every path under here is the path it was.
 *
 * ## What this is not
 *
 * It is not a weaker authentication boundary. `requireUser` runs exactly as it
 * does next door; the only thing missing is the terms check. And as `(app)`'s
 * layout says, a layout is not a security boundary on its own — the actions
 * under here re-resolve the session themselves.
 */
export default async function KontoLayout({ children }: { children: ReactNode }) {
  await requireUser();

  return <div className="flex flex-col gap-xl">{children}</div>;
}
