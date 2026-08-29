import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SiteHeader } from '@/components/site-header';
import { requireViewer } from '@/lib/auth/session';
import { Alert, Badge } from '@/components/ui';

const tabs = [
  { segment: '', label: 'Overview' },
  { segment: '/bookings', label: 'Requests' },
  { segment: '/departures', label: 'Departures' },
  { segment: '/schedules', label: 'Timetable' },
  { segment: '/routes', label: 'Routes & fares' },
  { segment: '/stops', label: 'Stops' },
  { segment: '/fleet', label: 'Fleet' },
  { segment: '/team', label: 'Team' },
  { segment: '/settings', label: 'Settings' },
] as const;

export default async function OperatorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ operatorId: string }>;
}) {
  const { operatorId } = await params;
  const viewer = await requireViewer(`/operator/${operatorId}`);

  // Drivers belong to an operator but have no business in its dashboard —
  // their surface is /driver.
  const membership = viewer.memberships.find(
    (m) => m.operator_id === operatorId && (m.role === 'owner' || m.role === 'staff'),
  );
  if (!membership) notFound();

  const operator = membership.operator;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <div className="border-b border-ink-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-semibold text-ink-900">{operator?.name}</h1>
            {operator?.status === 'active' ? (
              <Badge tone="good">Live in search</Badge>
            ) : operator?.status === 'pending' ? (
              <Badge tone="warn">Awaiting vetting</Badge>
            ) : (
              <Badge tone="bad">Suspended</Badge>
            )}
          </div>

          <nav className="-mb-px mt-3 flex gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <Link
                key={tab.segment}
                href={`/operator/${operatorId}${tab.segment}`}
                className="border-b-2 border-transparent px-3 py-3 text-sm font-medium whitespace-nowrap text-ink-600 hover:border-ink-300 hover:text-ink-900"
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        {operator?.status === 'pending' ? (
          <div className="mb-6">
            <Alert tone="warn">
              Passengers cannot see you yet. Set up your stops, routes, fares, and timetable now —
              the moment Corridor vets your business, your departures go on sale.
            </Alert>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
