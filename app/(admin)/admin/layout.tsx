import { SiteHeader } from '@/components/site-header';
import { NavTabs } from '@/components/nav';
import { requireAdmin } from '@/lib/auth/session';
import { requireMode } from '@/lib/auth/mode-session';

const tabs = [
  { href: '/admin', label: 'Operators' },
  { href: '/admin/cities', label: 'Cities' },
  { href: '/admin/complaints', label: 'Complaints' },
  { href: '/admin/feedback', label: 'Feedback' },
  { href: '/admin/subscriptions', label: 'Subscriptions' },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Being an admin is the permission; being in the admin account is the choice.
  await requireAdmin();
  await requireMode('admin', '/admin');

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <div className="border-b border-ink-200 bg-white">
        <div className="mx-auto max-w-6xl px-4">
          <NavTabs
            tabs={tabs.map((tab) => ({
              href: tab.href,
              label: tab.label,
              exact: tab.href === '/admin',
            }))}
          />
        </div>
      </div>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
