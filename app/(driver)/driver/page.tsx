import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteHeader } from '@/components/site-header';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { requireViewer } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { addDays, formatServiceDateLong, formatTime, todayInToronto } from '@/lib/time';

export const metadata: Metadata = { title: 'Driving' };

type Assignment = {
  id: string;
  vehicle: { id: string; label: string } | null;
  departure: {
    id: string;
    service_date: string;
    departure_time: string;
    status: string;
    operator: { name: string } | null;
    route: { name: string } | null;
  } | null;
};

/**
 * The driver's whole surface: what they are driving, and the list of who is in
 * the van. Drivers do not create rides, do not set prices, and do not approve
 * anything — operators publish schedules, and this is downstream of that.
 */
export default async function DriverPage() {
  await requireViewer('/driver');

  const supabase = await createClient();
  const today = todayInToronto();

  const { data } = await supabase
    .from('departure_vehicles')
    .select(
      `id, vehicle:vehicles(id, label),
       departure:departures!inner(id, service_date, departure_time, status,
         operator:operators(name), route:routes(name))`,
    )
    .gte('departure.service_date', addDays(today, -1))
    .lte('departure.service_date', addDays(today, 14))
    .order('service_date', { referencedTable: 'departures' });

  const assignments = (data ?? []) as unknown as Assignment[];
  const todays = assignments.filter((a) => a.departure?.service_date === today);
  const ahead = assignments.filter((a) => (a.departure?.service_date ?? '') > today);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <PageHeader
          title="Driving"
          description="Your trips, and the passenger list for each one."
        />

        {assignments.length === 0 ? (
          <EmptyState title="Nothing assigned to you">
            When the operator puts you on a vehicle, the trip and its passenger list appear here.
          </EmptyState>
        ) : (
          <div className="space-y-8">
            <section>
              <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-500 uppercase">
                Today
              </h2>
              {todays.length === 0 ? (
                <p className="text-sm text-ink-500">Nothing today.</p>
              ) : (
                <ul className="space-y-3">
                  {todays.map((assignment) => (
                    <TripCard key={assignment.id} assignment={assignment} />
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-500 uppercase">
                Coming up
              </h2>
              {ahead.length === 0 ? (
                <p className="text-sm text-ink-500">Nothing else booked in.</p>
              ) : (
                <ul className="space-y-3">
                  {ahead.map((assignment) => (
                    <TripCard key={assignment.id} assignment={assignment} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function TripCard({ assignment }: { assignment: Assignment }) {
  const departure = assignment.departure;
  if (!departure) return null;

  return (
    <li>
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="numeric text-lg font-semibold text-ink-900">
              {formatTime(departure.departure_time)}
            </p>
            <p className="text-sm text-ink-700">{formatServiceDateLong(departure.service_date)}</p>
            <p className="mt-1 text-sm text-ink-600">
              {departure.route?.name} · {assignment.vehicle?.label}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <Link
              href={`/driver/${departure.id}`}
              className="text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              Passenger list →
            </Link>
            <a
              href={`/api/manifest/${departure.id}?vehicle=${assignment.vehicle?.id}`}
              className="text-sm text-ink-600 hover:text-ink-900"
            >
              Download CSV
            </a>
          </div>
        </div>
      </Card>
    </li>
  );
}
