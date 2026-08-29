import Link from 'next/link';

import { PassengerHistory } from './passenger-history';
import { BookingStatusBadge } from '@/components/booking-status';
import { approveBooking, declineBooking } from '@/lib/booking/actions';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { formatCents } from '@/lib/money';
import { formatRelative, formatServiceDate, formatTime } from '@/lib/time';
import type { BookingStatus } from '@/lib/supabase/database.types';

type Request = {
  id: string;
  seats: number;
  luggage_count: number;
  status: BookingStatus;
  hold_expires_at: string | null;
  total_cents: number;
  passenger_note: string | null;
  passenger_id: string;
  passenger: {
    full_name: string | null;
    phone: string | null;
    gender: string | null;
    accommodation_notes: string | null;
  } | null;
  from_stop: { label: string; city: { name: string } | null } | null;
  to_stop: { label: string; city: { name: string } | null } | null;
  departure: { id: string; service_date: string; departure_time: string } | null;
};

/**
 * The approval queue. Everything needed for the decision is on one screen —
 * who they are, what they asked for, and how they have behaved on the platform
 * — because a hold lapses in an hour and nobody should have to go looking.
 */
export default async function BookingsQueuePage({
  params,
}: {
  params: Promise<{ operatorId: string }>;
}) {
  const { operatorId } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from('bookings')
    .select(
      `id, seats, luggage_count, status, hold_expires_at, total_cents, passenger_note, passenger_id,
       passenger:profiles(full_name, phone, gender, accommodation_notes),
       from_stop:stops!bookings_from_stop_id_fkey(label, city:cities(name)),
       to_stop:stops!bookings_to_stop_id_fkey(label, city:cities(name)),
       departure:departures!inner(id, operator_id, service_date, departure_time)`,
    )
    .eq('departure.operator_id', operatorId)
    .order('created_at', { ascending: false })
    .limit(200);

  const all = (data ?? []) as unknown as Request[];
  const now = new Date();

  // A hold whose clock has run out is dead whether or not the sweep has
  // relabelled it, so the queue reads the expiry rather than the status.
  const waiting = all.filter(
    (request) =>
      request.status === 'held' &&
      request.hold_expires_at !== null &&
      new Date(request.hold_expires_at) > now,
  );
  const decided = all.filter((request) => !waiting.includes(request));

  return (
    <>
      <PageHeader
        title="Seat requests"
        description="Every request holds a seat for an hour. Answer before that runs out and the seat goes back on sale."
      />

      <Card className="mb-8">
        <CardHeader
          title={`Waiting on you (${waiting.length})`}
          description="Oldest first is not the order — the ones about to lapse are."
        />
        {waiting.length === 0 ? (
          <div className="p-5">
            <EmptyState title="Nothing waiting">
              New requests appear here and email you straight away.
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {[...waiting]
              .sort((a, b) => (a.hold_expires_at ?? '').localeCompare(b.hold_expires_at ?? ''))
              .map((request) => (
                <li key={request.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink-900">
                          {request.passenger?.full_name ?? 'Passenger'}
                        </span>
                        {request.passenger?.gender ? (
                          <Badge tone="neutral">{request.passenger.gender}</Badge>
                        ) : null}
                        <span className="numeric text-sm text-ink-600">
                          {request.passenger?.phone}
                        </span>
                      </div>

                      <p className="numeric mt-1 text-sm text-ink-700">
                        {request.departure ? formatServiceDate(request.departure.service_date) : ''}{' '}
                        · {request.departure ? formatTime(request.departure.departure_time) : ''} ·{' '}
                        {request.from_stop?.label} → {request.to_stop?.label}
                      </p>

                      <p className="mt-1 text-sm text-ink-600">
                        {request.seats} seat{request.seats === 1 ? '' : 's'} ·{' '}
                        {request.luggage_count} bag{request.luggage_count === 1 ? '' : 's'} ·{' '}
                        <span className="numeric font-medium text-ink-900">
                          {formatCents(request.total_cents)}
                        </span>
                      </p>

                      {request.passenger_note ? (
                        <p className="mt-2 rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">
                          “{request.passenger_note}”
                        </p>
                      ) : null}

                      {request.passenger?.accommodation_notes ? (
                        <p className="mt-2 text-sm text-ink-600">
                          <span className="font-medium">Needs:</span>{' '}
                          {request.passenger.accommodation_notes}
                        </p>
                      ) : null}

                      <PassengerHistory passengerId={request.passenger_id} />
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <span className="text-xs text-ink-500">
                        Lapses {request.hold_expires_at ? formatRelative(request.hold_expires_at) : ''}
                      </span>
                      <div className="flex gap-2">
                        <form action={approveBooking}>
                          <input type="hidden" name="booking_id" value={request.id} />
                          <Button type="submit">Approve</Button>
                        </form>
                        <form action={declineBooking}>
                          <input type="hidden" name="booking_id" value={request.id} />
                          <Button type="submit" tone="danger">
                            Decline
                          </Button>
                        </form>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Everything else" />
        {decided.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-500">No other requests yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Passenger</Th>
                <Th>Departure</Th>
                <Th>Journey</Th>
                <Th>Seats</Th>
                <Th>Fare</Th>
                <Th>Status</Th>
                <Th className="text-right"> </Th>
              </tr>
            </thead>
            <tbody>
              {decided.map((request) => (
                <tr key={request.id}>
                  <Td className="font-medium text-ink-900">
                    {request.passenger?.full_name ?? 'Passenger'}
                  </Td>
                  <Td className="numeric whitespace-nowrap">
                    {request.departure ? formatServiceDate(request.departure.service_date) : ''}{' '}
                    {request.departure ? formatTime(request.departure.departure_time) : ''}
                  </Td>
                  <Td>
                    {request.from_stop?.city?.name} → {request.to_stop?.city?.name}
                  </Td>
                  <Td className="numeric">{request.seats}</Td>
                  <Td className="numeric">{formatCents(request.total_cents)}</Td>
                  <Td>
                    <BookingStatusBadge status={request.status} audience="operator" />
                  </Td>
                  <Td className="text-right">
                    {request.departure ? (
                      <Link
                        href={`/operator/${operatorId}/departures/${request.departure.id}`}
                        className="text-sm font-medium text-brand-600 hover:text-brand-700"
                      >
                        Departure
                      </Link>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
