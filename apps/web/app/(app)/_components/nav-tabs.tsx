'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@luma/ui';

/**
 * The tab bar both signed-in shells navigate with.
 *
 * It lives under `(app)` and is imported by `(admin)` across the route-group
 * boundary rather than copied. Which tab is current is the kind of small rule
 * that goes wrong quietly when it exists twice — `/integrasjoner` staying lit
 * on `/integrasjoner/mcp`, or `/admin` lighting up on every admin page — so
 * there is one implementation and one place to fix it.
 *
 * A client component, because marking the current tab needs the current path.
 * The layouts around it stay server components and keep doing the session work.
 *
 * Mobile (spec section 16): the bar scrolls sideways inside a full-bleed
 * container instead of wrapping into three ragged rows, and every tab keeps the
 * 44px minimum touch target.
 */

export interface NavItem {
  readonly href: string;
  readonly label: string;
}

export interface NavTabsProps {
  readonly items: readonly NavItem[];
  /** Accessible name for the `nav` landmark. */
  readonly label: string;
}

export function NavTabs({ items, label }: NavTabsProps) {
  const pathname = usePathname();
  const current = currentHref(pathname, items);

  return (
    <nav aria-label={label} className="-mx-md overflow-x-auto px-md py-2xs">
      <ul className="m-0 flex w-max min-w-full list-none gap-2xs rounded-lg bg-surface-raised p-2xs shadow-sm">
        {items.map((item) => {
          const active = item.href === current;
          return (
            <li key={item.href} className="flex">
              <Link
                href={item.href}
                {...(active ? { 'aria-current': 'page' as const } : {})}
                className={cx(
                  'inline-flex min-h-[var(--luma-hit-target-min)] items-center whitespace-nowrap rounded-md px-md text-sm font-medium no-underline',
                  active
                    ? 'bg-primary text-primary-on'
                    : 'text-text hover:bg-surface-sunken hover:text-primary',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The tab to light up: the longest item href the path sits under.
 *
 * Longest wins rather than first, because `/admin` is a prefix of every admin
 * route and `/integrasjoner` is a prefix of `/integrasjoner/mcp`. A path no item
 * covers — an individual tender, say — lights nothing, which is honest.
 */
function currentHref(pathname: string, items: readonly NavItem[]): string | undefined {
  let best: string | undefined;
  for (const item of items) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (best === undefined || item.href.length > best.length)) best = item.href;
  }
  return best;
}
