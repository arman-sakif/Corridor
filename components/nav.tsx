'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';

/**
 * Tabbed navigation that knows where you are.
 *
 * The dashboards had no active state at all, which on a nine-tab operator nav
 * means you orient yourself by re-reading the page every time. The underline
 * is the cheapest fix that actually answers "where am I".
 */
export function NavTabs({
  tabs,
}: {
  tabs: { href: string; label: string; exact?: boolean }[];
}) {
  const pathname = usePathname();

  return (
    <nav className="-mb-px flex gap-0.5 overflow-x-auto">
      {tabs.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href as Route}
            aria-current={active ? 'page' : undefined}
            className={
              'border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors ' +
              (active
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-ink-600 hover:border-ink-300 hover:text-ink-900')
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Header links, same idea but pill-shaped rather than underlined. */
export function NavLink({
  href,
  children,
  exact = false,
}: {
  href: string;
  children: React.ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href as Route}
      aria-current={active ? 'page' : undefined}
      className={
        'shrink-0 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ' +
        (active ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-150 hover:text-ink-900')
      }
    >
      {children}
    </Link>
  );
}
