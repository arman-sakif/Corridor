import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DriverFlagForm } from './driver-flag-form';
import { RatePassengerForm } from '@/components/rate-passenger-form';
import { SiteHeader } from '@/components/site-header';
import { BookingStatusBadge } from '@/components/booking-status';
import { completeDeparture, confirmPaymentAsDriver, markNoShow } from '@/lib/booking/day-actions';
import { Alert, Button, Card, EmptyState, PageHeader } from '@/components/ui';
import { requireViewer } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { one, rows } from '@/lib/supabase/rows';
import { formatCents } from '@/lib/money';
import { formatServiceDateLong, formatTime, torontoInstant } from '@/lib/time';
import type { BookingStatus } from '@/lib/supabase/database.types';

export const metadata: Metadata = { title: 'Passenger list' };

type Rider = {
  id: string;
  seats: number;
  luggage_count: number;
  status: BookingStatus;
  total_cents: number;
  passenger_note: string | null;
  from_seq: number;
  driver_confirmed_at: string | null;
  passenger_confirmed_at: string | null;
  passenger: { full_name: string | null; phone: string | null } | null;
  from_stop: { label: string; description: string | null } | null;
  to_stop: { label: string } | null;
};

/**
 * Read in a van, at a pickup point, on a phone. Big names, tappable phone
 * numbers, and the two buttons that matter on the day.
 */
export default async function DriverManifestPage({
  params,
  searchParams,
}: {
  params: Promise<{ departureId: string }>;
  searchParams: Promise<{ vehicle?: string }>;
}) {
  const [{ departureId }, query] = await Promise.all([params, searchParams]);
  const viewer = await requireViewer(`/driver/${departureId}`);

  const supabase = await createClient();

  const departure = one(
    await supabase
      .from('departures')
      .select(
        `id, service_date, departure_time, status,
         operator:operators(id, name), route:routes(name)`,
      )
      .eq('id', departureId)
      .maybeSingle(),
    'the trip',
  );

  if (!departure) notFound();

  const assignments = rows(
    await supabase
      .from('departure_vehicles')
      .select('vehicle:vehicles(id, label), driver_id')
      .eq('departure_id', departureId),
    'the vehicles on this trip',
  );

  const mine = assignments.find((a) => a.driver_id === viewer.userId);

  // Not their trip. RLS already refuses the passengers, so the page was safe —
  // but it rendered "Nobody in this vehicle yet", which reads as an empty van
  // rather than somebody else's. Say the true thing instead.
  if (!mine) notFound();

  const vehicleId = query.vehicle ?? mine.vehicle?.id;

  let query_ = supabase
    .from('bookings')
    .select(
      `id, seats, luggage_count, status, total_cents, passenger_note, from_seq,
       driver_confirmed_at, passenger_confirmed_at,
       passenger:profiles(full_name, phone),
       from_stop:stops!bookings_from_stop_id_fkey(label, description),
       to_stop:stops!bookings_to_stop_id_fkey(label)`,
    )
    .eq('departure_id', departureId)
    .in('status', ['approved', 'completed', 'settled', 'no_show'])
    .order('from_seq');

  if (vehicleId) query_ = query_.eq('assigned_vehicle_id', vehicleId);

  const riders = rows(await query_, 'the passenger list') as unknown as Rider[];

  const hasLeft = torontoInstant(departure.service_date, departure.departure_time) <= new Date();
  const totalSeats = riders.reduce((sum, rider) => sum + rider.seats, 0);
  const totalCash = riders
    .filter((rider) => rider.status !== 'no_show')
    .reduce((sum, rider) => sum + rider.total_cents, 0);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <Link href="/driver" className="text-sm text-ink-600 hover:text-ink-900">
          ← My trips
        </Link>

        <div className="mt-4">
          <PageHeader
            title={`${formatTime(departure.departure_time)} — ${departure.route?.name ?? ''}`}
            description={`${formatServiceDateLong(departure.service_date)} · ${mine?.vehicle?.label ?? 'all passengers'}`}
            action={
              <a
                href={`/api/manifest/${departureId}${vehicleId ? `?vehicle=${vehicleId}` : ''}`}
                className="inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-medium text-ink-800 ring-1 ring-ink-200 hover:bg-ink-50"
              >
                Download CSV
              </a>
            }
          />
        </div>

        <div className="mb-4 flex gap-4 text-sm text-ink-600">
          <span>
            <strong className="numeric text-ink-900">{totalSeats}</strong> seats
          </span>
          <span>
            <strong className="numeric text-ink-900">{formatCents(totalCash)}</strong> to collect
          </span>
        </div>

        {riders.length === 0 ? (
          <EmptyState title="Nobody in this vehicle yet">
            The operator assigns passengers to a van before the trip. Check again closer to the
            time.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {riders.map((rider) => (
              <li key={rider.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-lg font-semibold text-ink-900">
                        {rider.passenger?.full_name ?? 'Passenger'}
                      </p>
                      {rider.passenger?.phone ? (
                        <a
                          href={`tel:${rider.passenger.phone}`}
                          className="numeric text-brand-600 hover:text-brand-700"
                        >
                          {rider.passenger.phone}
                        </a>
                      ) : null}
                      <p className="mt-1 text-sm text-ink-700">
                        {rider.from_stop?.label} → {rider.to_stop?.label}
                      </p>
                      {rider.from_stop?.description ? (
                        <p className="text-xs text-ink-500">{rider.from_stop.description}</p>
                      ) : null}
                      <p className="mt-1 text-sm text-ink-600">
                        {rider.seats} seat{rider.seats === 1 ? '' : 's'} · {rider.luggage_count} bag
                        {rider.luggage_count === 1 ? '' : 's'} ·{' '}
                        <span className="numeric font-medium text-ink-900">
                          {formatCents(rider.total_cents)}
                        </span>
                      </p>
                      {rider.passenger_note ? (
                        <p className="mt-2 rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">
                          “{rider.passenger_note}”
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <BookingStatusBadge status={rider.status} audience="operator" />

                      {rider.status === 'approved' ? (
                        <form action={markNoShow}>
                          <input type="hidden" name="booking_id" value={rider.id} />
                          <Button type="submit" size="sm" tone="danger">
                            Did not show
                          </Button>
                        </form>
                      ) : null}

                      {rider.status === 'completed' && !rider.driver_confirmed_at ? (
                        <div className="flex gap-2">
                          <form action={confirmPaymentAsDriver}>
                            <input type="hidden" name="booking_id" value={rider.id} />
                            <input type="hidden" name="received" value="yes" />
                            <Button type="submit" size="sm">
                              Got paid
                            </Button>
                          </form>
                          <form action={confirmPaymentAsDriver}>
                            <input type="hidden" name="booking_id" value={rider.id} />
                            <input type="hidden" name="received" value="no" />
                            <Button type="submit" size="sm" tone="danger">
                              Not paid
                            </Button>
                          </form>
                        </div>
                      ) : null}

                      {/*
                        The person who was actually in the van could not do
                        this until now: red_flags_insert_operator requires a
                        manager, so the driver's only marks were the two
                        automatic ones, neither of which carries a word of
                        explanation. raise_red_flag() admits the assigned
                        driver.
                      */}
                      {rider.status !== 'no_show' ? (
                        <DriverFlagForm bookingId={rider.id} />
                      ) : null}

                      {rider.status === 'completed' || rider.status === 'settled' ? (
                        <RatePassengerForm bookingId={rider.id} />
                      ) : null}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}

        {hasLeft && departure.status === 'scheduled' ? (
          <div className="mt-6">
            <Alert tone="info">
              Once everyone is dropped off, close the trip and both you and each passenger get
              asked about payment.
            </Alert>
            <form action={completeDeparture} className="mt-3">
              <input type="hidden" name="departure_id" value={departureId} />
              <Button type="submit" size="lg" className="w-full">
                Trip is done
              </Button>
            </form>
          </div>
        ) : null}
      </main>
    </div>
  );
}
