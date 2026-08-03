import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Badge, Cluster } from '@luma/ui';
import { requireAdmin } from '@/server/session';
// Across the route-group boundary on purpose: `(app)` and `(admin)` are two
// shells around the same tab bar, and "which tab is current" is a rule that
// should not exist twice. See the note in the component.
import { NavTabs } from '../(app)/_components/nav-tabs';

/**
 * Layout for internal administration.
 *
 * This is the authorisation boundary. Every route under `(admin)` requires an
 * authenticated Luma Training administrator (spec section 45), and
 * `requireAdmin()` answers with a 404 — not a 403 — for everyone else, so the
 * surface is not discoverable by probing. No page below does its own role
 * check.
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

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();

  return (
    <div className="flex flex-col gap-xl">
      {/* The marker is a badge rather than a line of muted text because the one
          thing a person must never be unsure about on these pages is whether
          they are looking at the internal tool. */}
      <Cluster gap="xs">
        <Badge variant="warning">Internt administrasjonsgrensesnitt</Badge>
      </Cluster>
      <NavTabs items={NAV_ITEMS} label="Administrasjonsmeny" />
      {children}
    </div>
  );
}
