import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AssignVehicleControl, RedFlagForm } from './assignment';
import { AddVehicleForm } from './add-vehicle-form';
import { BookingStatusBadge } from '@/components/booking-status';
import {
  completeDeparture,
  markNoShow,
  removeVehicleFromDeparture,
  confirmPaymentAsDriver,
} from '@/lib/booking/day-actions';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { formatCents } from '@/lib/money';
import { formatServiceDateLong, formatTime, torontoInstant } from '@/lib/time';
import { legLoads, type CapacityBooking } from '@/lib/booking/capacity';
import type { BookingStatus, PaymentMethod } from '@/lib/supabase/database.types';

type Passenger = {
  id: string;
  seats: number;
  luggage_count: number;
  status: BookingStatus;
  hold_expires_at: string | null;
  total_cents: number;
  passenger_note: string | null;
  from_seq: number;
  to_seq: number;
  assigned_vehicle_id: string | null;
  payment_method: PaymentMethod | null;
  passenger_confirmed_at: string | null;
  driver_confirmed_at: string | null;
  passenger: { full_name: string | null; phone: string | null } | null;
  from_stop: { label: string } | null;
  to_stop: { label: string } | null;
};

export default async function DepartureDayPage({
  params,
}: {
  params: Promise<{ operatorId: string; departureId: string }>;
}) {
  const { operatorId, departureId } = await params;
  const supabase = await createClient();

  const { data: departure } = await supabase
    .from('departures')
    .select(
      `id, service_date, departure_time, max_seats, status,
       route:routes(id, name, route_stops(seq, stop:stops(label)))`,
    )
    .eq('id', departureId)
    .eq('operator_id', operatorId)
    .maybeSingle();

  if (!departure) notFound();

  const [{ data: bookingRows }, { data: assignments }, { data: fleet }, { data: team }] =
    await Promise.all([
      supabase
        .from('bookings')
        .select(
          `id, seats, luggage_count, status, hold_expires_at, total_cents, passenger_note,
           from_seq, to_seq, assigned_vehicle_id, payment_method,
           passenger_confirmed_at, driver_confirmed_at,
           passenger:profiles(full_name, phone),
           from_stop:stops!bookings_from_stop_id_fkey(label),
           to_stop:stops!bookings_to_stop_id_fkey(label)`,
        )
        .eq('departure_id', departureId)
        .order('from_seq'),
      supabase
        .from('departure_vehicles')
        .select('id, vehicle:vehicles(id, label, seat_count), driver:profiles(id, full_name)')
        .eq('departure_id', departureId),
      supabase
        .from('vehicles')
        .select('id, label, seat_count')
        .eq('operator_id', operatorId)
        .eq('is_active', true)
        .order('label'),
      supabase
        .from('operator_members')
        .select('user_id, role, profile:profiles(full_name)')
        .eq('operator_id', operatorId),
    ]);

  const passengers = (bookingRows ?? []) as unknown as Passenger[];
  const vans = (assignments ?? []) as unknown as {
    id: string;
    vehicle: { id: string; label: string; seat_count: number } | null;
    driver: { id: string; full_name: string | null } | null;
  }[];

  const stops = [...(departure.route?.route_stops ?? [])].sort((a, b) => a.seq - b.seq);
  const riding = passengers.filter((p) =>
    ['approved', 'completed', 'settled', 'no_show'].includes(p.status),
  );
  const loads = legLoads(passengers as unknown as CapacityBooking[], stops.length);

  const hasLeft = torontoInstant(departure.service_date, departure.departure_time) <= new Date();
  const unassigned = riding.filter((p) => !p.assigned_vehicle_id);

  const drivers = (team ?? [])
    .filter((member) => member.role === 'driver' || member.role === 'owner')
    .map((member) => ({
      id: member.user_id,
      name: (member.profile as unknown as { full_name: string | null } | null)?.full_name ?? 'Team member',
    }));

  return (
    <>
      <Link
        href={`/operator/${operatorId}/departures`}
        className="text-sm text-ink-600 hover:text-ink-900"
      >
        ← All departures
      </Link>

      <div className="mt-4">
        <PageHeader
          title={departure.route?.name ?? 'Departure'}
          description={`${formatServiceDateLong(departure.service_date)} at ${formatTime(departure.departure_time)} · ${departure.max_seats} seats per leg`}
          action={
            departure.status === 'completed' ? (
              <Badge tone="brand">Trip finished</Badge>
            ) : hasLeft ? (
              <form action={completeDeparture}>
                <input type="hidden" name="departure_id" value={departureId} />
                <Button type="submit">Mark trip as run</Button>
              </form>
            ) : (
              <Badge tone="good">On sale</Badge>
            )
          }
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader
            title={`Passengers (${riding.reduce((sum, p) => sum + p.seats, 0)} seats)`}
            description="In stop order, the way you will pick them up."
          />
          {riding.length === 0 ? (
            <div className="p-5">
              <EmptyState title="Nobody booked yet">
                Confirmed passengers appear here as requests come in.
              </EmptyState>
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Passenger</Th>
                  <Th>Journey</Th>
                  <Th>Seats</Th>
                  <Th>Fare</Th>
                  <Th>Vehicle</Th>
                  <Th className="text-right">On the day</Th>
                </tr>
              </thead>
              <tbody>
                {riding.map((passenger) => (
                  <tr key={passenger.id}>
                    <Td>
                      <span className="font-medium text-ink-900">
                        {passenger.passenger?.full_name ?? 'Passenger'}
                      </span>
                      <span className="numeric block text-xs text-ink-600">
                        {passenger.passenger?.phone}
                      </span>
                      {passenger.passenger_note ? (
                        <span className="mt-1 block text-xs text-warn-700">
                          “{passenger.passenger_note}”
                        </span>
                      ) : null}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {passenger.from_stop?.label} → {passenger.to_stop?.label}
                    </Td>
                    <Td className="numeric">
                      {passenger.seats}
                      <span className="block text-xs text-ink-500">
                        {passenger.luggage_count} bag{passenger.luggage_count === 1 ? '' : 's'}
                      </span>
                    </Td>
                    <Td className="numeric">{formatCents(passenger.total_cents)}</Td>
                    <Td>
                      <AssignVehicleControl
                        bookingId={passenger.id}
                        current={passenger.assigned_vehicle_id}
                        vehicles={vans
                          .map((van) => van.vehicle)
                          .filter((v): v is { id: string; label: string; seat_count: number } => Boolean(v))}
                      />
                    </Td>
                    <Td>
                      <div className="flex flex-col items-end gap-1">
                        <BookingStatusBadge status={passenger.status} audience="operator" />

                        {passenger.status === 'approved' && hasLeft ? (
                          <form action={markNoShow}>
                            <input type="hidden" name="booking_id" value={passenger.id} />
                            <Button type="submit" size="sm" tone="danger">
                              No-show
                            </Button>
                          </form>
                        ) : null}

                        {passenger.status === 'completed' && !passenger.driver_confirmed_at ? (
                          <div className="flex gap-1">
                            <form action={confirmPaymentAsDriver}>
                              <input type="hidden" name="booking_id" value={passenger.id} />
                              <input type="hidden" name="received" value="yes" />
                              <Button type="submit" size="sm" tone="secondary">
                                Paid
                              </Button>
                            </form>
                            <form action={confirmPaymentAsDriver}>
                              <input type="hidden" name="booking_id" value={passenger.id} />
                              <input type="hidden" name="received" value="no" />
                              <Button type="submit" size="sm" tone="danger">
                                Not paid
                              </Button>
                            </form>
                          </div>
                        ) : null}

                        {passenger.status === 'completed' && passenger.driver_confirmed_at ? (
                          <span className="text-xs text-ink-500">
                            {passenger.passenger_confirmed_at
                              ? 'Both confirmed'
                              : 'Waiting on the passenger'}
                          </span>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="font-semibold text-ink-900">Load per leg</h2>
            <p className="mt-1 mb-3 text-sm text-ink-600">
              {departure.max_seats} seats on any one stretch.
            </p>
            <ul className="space-y-2">
              {loads.map((load, index) => {
                const from = stops[index];
                const to = stops[index + 1];
                const pct = Math.min(100, Math.round((load / departure.max_seats) * 100));
                return (
                  <li key={index}>
                    <div className="flex justify-between text-xs text-ink-600">
                      <span>
                        {from?.stop?.label} → {to?.stop?.label}
                      </span>
                      <span className="numeric">
                        {load}/{departure.max_seats}
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-100">
                      <div
                        className={`h-full rounded-full ${pct >= 100 ? 'bg-bad-700' : 'bg-brand-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="Vehicles on this trip"
              description="Add a second van and split the list between them."
            />
            <div className="space-y-3 p-5">
              {vans.length === 0 ? (
                <p className="text-sm text-ink-500">
                  No vehicle assigned yet. Add one to print a passenger list.
                </p>
              ) : (
                vans.map((van) => (
                  <div
                    key={van.id}
                    className="rounded-lg p-3 ring-1 ring-ink-200"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-ink-900">{van.vehicle?.label}</p>
                        <p className="text-xs text-ink-600">
                          {van.vehicle?.seat_count} seats ·{' '}
                          {van.driver?.full_name ?? 'no driver yet'}
                        </p>
                        <p className="numeric mt-1 text-xs text-ink-500">
                          {riding
                            .filter((p) => p.assigned_vehicle_id === van.vehicle?.id)
                            .reduce((sum, p) => sum + p.seats, 0)}{' '}
                          seats assigned
                        </p>
                      </div>
                      <form action={removeVehicleFromDeparture}>
                        <input type="hidden" name="departure_vehicle_id" value={van.id} />
                        <input type="hidden" name="departure_id" value={departureId} />
                        <Button type="submit" size="sm" tone="ghost">
                          Remove
                        </Button>
                      </form>
                    </div>
                    <a
                      href={`/api/manifest/${departureId}?vehicle=${van.vehicle?.id}`}
                      className="mt-2 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
                    >
                      Download passenger list (CSV)
                    </a>
                  </div>
                ))
              )}

              <AddVehicleForm
                departureId={departureId}
                vehicles={(fleet ?? []).filter(
                  (vehicle) => !vans.some((van) => van.vehicle?.id === vehicle.id),
                )}
                drivers={drivers}
              />

              <a
                href={`/api/manifest/${departureId}`}
                className="block text-sm text-ink-600 hover:text-ink-900"
              >
                Download the whole departure (CSV)
              </a>
            </div>
          </Card>

          {unassigned.length > 0 && vans.length > 0 ? (
            <Alert tone="warn">
              {unassigned.length} passenger{unassigned.length === 1 ? ' is' : 's are'} not in a
              vehicle yet, so they will not appear on any driver’s list.
            </Alert>
          ) : null}

          {departure.status === 'completed' ? (
            <Card className="p-5">
              <h2 className="font-semibold text-ink-900">Report a problem</h2>
              <p className="mt-1 mb-4 text-sm text-ink-600">
                Recorded against the passenger and visible to other operators.
              </p>
              <RedFlagForm passengers={riding.map((p) => ({
                id: p.id,
                name: p.passenger?.full_name ?? 'Passenger',
              }))} />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
