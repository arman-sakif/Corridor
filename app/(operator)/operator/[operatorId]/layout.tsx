import { notFound } from 'next/navigation';

import { SiteHeader } from '@/components/site-header';
import { NavTabs } from '@/components/nav';
import { requireViewer } from '@/lib/auth/session';
import { Alert, Badge } from '@/components/ui';

const intercityTabs = [
  { segment: '', label: 'Overview' },
  { segment: '/bookings', label: 'Requests' },
  { segment: '/departures', label: 'Departures' },
  { segment: '/schedules', label: 'Timetable' },
  { segment: '/routes', label: 'Routes & fares' },
  { segment: '/stops', label: 'Stops' },
  { segment: '/fleet', label: 'Fleet' },
  { segment: '/complaints', label: 'Complaints' },
  { segment: '/team', label: 'Team' },
  { segment: '/settings', label: 'Settings' },
] as const;

/**
 * An in-city business runs no timetable, owns no routes and books no
 * departures — it sells a flat-priced ride from a pickup point to a zone. It
 * was being shown all nine tabs regardless, so its owner landed on Routes &
 * fares, Timetable and Fleet, none of which mean anything to them.
 */
const incityTabs = [
  { segment: '', label: 'Overview' },
  { segment: '/incity', label: 'Requests' },
  { segment: '/zones', label: 'Zones' },
  { segment: '/stops', label: 'Pickup points' },
  { segment: '/complaints', label: 'Complaints' },
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
  const tabs = operator?.type === 'incity' ? incityTabs : intercityTabs;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <div className="border-b border-ink-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="display text-lg font-semibold text-ink-900">{operator?.name}</h1>
            {operator?.status === 'active' ? (
              <Badge tone="good">Live in search</Badge>
            ) : operator?.status === 'pending' ? (
              <Badge tone="warn">Awaiting vetting</Badge>
            ) : (
              <Badge tone="bad">Suspended</Badge>
            )}
          </div>

          <div className="mt-3">
            <NavTabs
              tabs={tabs.map((tab) => ({
                href: `/operator/${operatorId}${tab.segment}`,
                label: tab.label,
                // Overview would otherwise match every tab beneath it.
                exact: tab.segment === '',
              }))}
            />
          </div>
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
