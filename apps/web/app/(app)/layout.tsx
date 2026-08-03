import type { ReactNode } from 'react';
import { requireUser } from '@/server/session';
import { NavTabs } from './_components/nav-tabs';

/**
 * Layout for the authenticated part of the service.
 *
 * This is the authentication boundary. Every route under `(app)` requires a
 * signed-in user (spec section 10: passwordless e-post-innlogging), and
 * `requireUser()` resolves the session here so no page below has to remember
 * to. It redirects to `/logg-inn` when there is none.
 *
 * A layout is not a security boundary on its own: Next.js does not re-run it
 * for a server action, and a route handler bypasses it entirely. So every
 * server action re-resolves the session itself, and every query in
 * `src/server/` takes a user id and scopes by it. This check keeps the *pages*
 * honest; the actions defend themselves.
 */

const NAV_ITEMS = [
  { href: '/oversikt', label: 'Oversikt' },
  { href: '/planlagte', label: 'Planlagte anskaffelser' },
  { href: '/lagret', label: 'Lagret' },
  { href: '/varsler', label: 'Varsler' },
  { href: '/delinger', label: 'Delinger' },
  { href: '/integrasjoner', label: 'Integrasjoner' },
  { href: '/bestillinger', label: 'Bestillinger' },
  { href: '/innstillinger', label: 'Innstillinger' },
] as const;

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser();

  return (
    <div className="flex flex-col gap-xl">
      <NavTabs items={NAV_ITEMS} label="Tjenestemeny" />
      {children}
    </div>
  );
}
