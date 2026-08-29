import type { Metadata } from 'next';
import Link from 'next/link';

import { BookingStatusBadge } from '@/components/booking-status';
import { ButtonLink, Card, EmptyState, PageHeader } from '@/components/ui';
import { requireViewer } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { formatCents } from '@/lib/money';
import { formatRelative, formatServiceDate, formatTime, todayInToronto } from '@/lib/time';
import type { BookingStatus } from '@/lib/supabase/database.types';

export const metadata: Metadata = { title: 'My rides' };

type Ride = {
  id: string;
  seats: number;
  status: BookingStatus;
  hold_expires_at: string | null;
  total_cents: number;
  from_stop: { label: string; city: { name: string } | null } | null;
  to_stop: { label: string; city: { name: string } | null } | null;
  departure: {
    service_date: string;
    departure_time: string;
    operator: { name: string } | null;
  } | null;
};

export default async function MyRidesPage() {
  await requireViewer('/my-rides');

  const supabase = await createClient();
  const { data } = await supabase
    .from('bookings')
    .select(
      `id, seats, status, hold_expires_at, total_cents,
       from_stop:stops!bookings_from_stop_id_fkey(label, city:cities(name)),
       to_stop:stops!bookings_to_stop_id_fkey(label, city:cities(name)),
       departure:departures(service_date, departure_time, operator:operators(name))`,
    )
    .order('created_at', { ascending: false });

  const rides = (data ?? []) as unknown as Ride[];
  const today = todayInToronto();

  const upcoming = rides.filter((ride) => (ride.departure?.service_date ?? '') >= today);
  const past = rides.filter((ride) => (ride.departure?.service_date ?? '') < today);

  return (
    <>
      <PageHeader
        title="My rides"
        description="Everything you have requested, and how each one stands."
        action={<ButtonLink href="/">Find a ride</ButtonLink>}
      />

      {rides.length === 0 ? (
        <EmptyState
          title="No rides yet"
          action={<ButtonLink href="/">Search for a ride</ButtonLink>}
        >
          Search a city pair and a date, then request a seat. The operator confirms within the hour.
        </EmptyState>
      ) : (
        <div className="space-y-8">
          <Section title="Coming up" rides={upcoming} emptyNote="Nothing booked ahead." />
          <Section title="Past" rides={past} emptyNote="No finished trips yet." />
        </div>
      )}
    </>
  );
}

function Section({
  title,
  rides,
  emptyNote,
}: {
  title: string;
  rides: Ride[];
  emptyNote: string;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-500 uppercase">{title}</h2>
      {rides.length === 0 ? (
        <p className="text-sm text-ink-500">{emptyNote}</p>
      ) : (
        <ul className="space-y-3">
          {rides.map((ride) => (
            <li key={ride.id}>
              <Link href={`/my-rides/${ride.id}`}>
                <Card className="p-4 transition-shadow hover:shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">
                        {ride.from_stop?.city?.name ?? ride.from_stop?.label} →{' '}
                        {ride.to_stop?.city?.name ?? ride.to_stop?.label}
                      </p>
                      <p className="numeric mt-0.5 text-sm text-ink-600">
                        {ride.departure ? formatServiceDate(ride.departure.service_date) : ''} ·{' '}
                        {ride.departure ? formatTime(ride.departure.departure_time) : ''} ·{' '}
                        {ride.departure?.operator?.name}
                      </p>
                      <p className="mt-1 text-sm text-ink-600">
                        {ride.seats} seat{ride.seats === 1 ? '' : 's'} ·{' '}
                        <span className="numeric">{formatCents(ride.total_cents)}</span>
                      </p>
                    </div>

                    <div className="text-right">
                      <BookingStatusBadge status={ride.status} />
                      {ride.status === 'held' && ride.hold_expires_at ? (
                        <p className="mt-1 text-xs text-ink-500">
                          Held until {formatRelative(ride.hold_expires_at)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
