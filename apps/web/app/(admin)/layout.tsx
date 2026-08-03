import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Cluster } from '@luma/ui';

/**
 * Layout for internal administration.
 *
 * TODO(auth): this is the authorisation boundary. Every route under `(admin)`
 * requires an authenticated Luma Training administrator (spec section 45).
 * The agent adding auth should resolve the session and the admin role here and
 * return a 404 — not a 403 — for everyone else, so the surface is not
 * discoverable. No page below this layout does its own role check.
 */

export const metadata: Metadata = {
  title: {
    default: 'Administrasjon',
    template: '%s | Administrasjon',
  },
  robots: { index: false, follow: false },
};

const NAV_ITEMS = [
  { href: '/admin', label: 'Oversikt' },
  { href: '/admin/ingestion', label: 'Innhenting' },
  { href: '/admin/matching', label: 'Matching' },
  { href: '/admin/email', label: 'E-post' },
  { href: '/admin/redaksjonelt', label: 'Redaksjonelt' },
  { href: '/admin/bransjemaler', label: 'Bransjemaler' },
  { href: '/admin/samtykker', label: 'Samtykker' },
  { href: '/admin/bestillinger', label: 'Bestillinger' },
  { href: '/admin/attribusjon', label: 'Attribusjon' },
  { href: '/admin/mcp', label: 'MCP' },
] as const;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-lg">
      <p className="m-0 text-sm font-semibold uppercase tracking-wide text-text-muted">
        Internt administrasjonsgrensesnitt
      </p>
      <Cluster
        as="nav"
        gap="xs"
        aria-label="Administrasjonsmeny"
        className="border-b border-line pb-xs"
      >
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
