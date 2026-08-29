import Link from 'next/link';

import { SiteHeader } from '@/components/site-header';
import { requireAdmin } from '@/lib/auth/session';

const tabs = [
  { href: '/admin', label: 'Operators' },
  { href: '/admin/cities', label: 'Cities' },
  { href: '/admin/subscriptions', label: 'Subscriptions' },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <div className="border-b border-ink-200 bg-white">
        <nav className="mx-auto flex max-w-6xl gap-1 px-4">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="border-b-2 border-transparent px-3 py-3 text-sm font-medium text-ink-600 hover:border-ink-300 hover:text-ink-900"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
