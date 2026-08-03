import type { ReactNode } from 'react';
import Link from 'next/link';
import { Cluster } from '@luma/ui';

/**
 * Layout for the authenticated part of the service.
 *
 * TODO(auth): this is the authentication boundary. Every route under `(app)`
 * requires a signed-in user (spec section 10: passwordless e-post-innlogging).
 * The agent adding auth should resolve the session here and redirect to
 * `/logg-inn?retur=...` when there is none — no page below this layout does
 * its own session check.
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

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-lg">
      <Cluster as="nav" gap="xs" aria-label="Tjenestemeny" className="border-b border-line pb-xs">
        {NAV_ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className="site-nav-link">
            {item.label}
          </Link>
        ))}
      </Cluster>
      {children}
    </div>
  );
}
