import Link from 'next/link';

import { PassengerHistory } from './passenger-history';
import { BookingStatusBadge } from '@/components/booking-status';
import { ListControls } from '@/components/list-controls';
import { SeatLegend, SeatMap } from '@/components/seat-map';
import { approveBooking, declineBooking } from '@/lib/booking/actions';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
} from '@/components/ui';
import {
  CURRENT_SORTS,
  LIST_CAP,
  effectiveStatus,
  filtersActive,
  isWaiting,
  parseListParams,
  sortRides,
  statusClause,
} from '@/lib/booking/ride-list';
import { bookingsByDeparture } from '@/lib/booking/seat-load';
import { seatMap } from '@/lib/booking/seat-map';
import { createClient } from '@/lib/supabase/server';
import { rows } from '@/lib/supabase/rows';
import { dynamicRoute } from '@/lib/routes';
import { formatCents } from '@/lib/money';
import { formatRelative, formatServiceDate, formatTime, todayInToronto } from '@/lib/time';
import type { BookingStatus } from '@/lib/supabase/database.types';

type Request = {
  id: string;
  seats: number;
  luggage_count: number;
  status: BookingStatus;
  hold_expires_at: string | null;
  total_cents: number;
  discount_cents: number;
  voucher: { code: string } | null;
  passenger_note: string | null;
  passenger_id: string;
  created_at: string;
  passenger: {
    full_name: string | null;
    phone: string | null;
    gender: string | null;
    accommodation_notes: string | null;
  } | null;
  from_stop: { label: string; city: { name: string } | null } | null;
  to_stop: { label: string; city: { name: string } | null } | null;
  departure: {
    id: string;
    service_date: string;
    departure_time: string;
    max_seats: number;
  } | null;
};

/**
 * The approval queue, and everything else still ahead. Everything needed for a
 * decision is on one screen — who they are, what they asked for, how they have
 * behaved on the platform, and how full the van already is — because a hold
 * lapses in an hour and nobody should have to go looking.
 *
 * Only today and later. Past trips are on the History page behind this one.
 */
export default async function BookingsQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ operatorId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ operatorId }, raw] = await Promise.all([params, searchParams]);
  const list = parseListParams(raw, CURRENT_SORTS);
  const path = `/operator/${operatorId}/bookings`;

  const supabase = await createClient();
  const today = todayInToronto();
  const now = new Date();

  // A "from" in the past cannot reach back past today here — that is History.
  const from = list.from && list.from > today ? list.from : today;

  let query = supabase
    .from('bookings')
    .select(
      `id, seats, luggage_count, status, hold_expires_at, total_cents, discount_cents, passenger_note, passenger_id, created_at,
       voucher:vouchers(code),
       passenger:profiles(full_name, phone, gender, accommodation_notes),
       from_stop:stops!bookings_from_stop_id_fkey(label, city:cities(name)),
       to_stop:stops!bookings_to_stop_id_fkey(label, city:cities(name)),
       departure:departures!inner(id, operator_id, service_date, departure_time, max_seats)`,
    )
    .eq('departure.operator_id', operatorId)
    .gte('departure.service_date', from);
  if (list.to) query = query.lte('departure.service_date', list.to);
  if (list.status) query = query.or(statusClause(list.status, now));

  const loaded = rows(
    await query.order('created_at', { ascending: false }).range(0, LIST_CAP - 1),
    'the seat requests',
  ) as unknown as Request[];
  const requests = sortRides(loaded, list.sort, now);
  const truncated = loaded.length === LIST_CAP;

  const departureIds = [
    ...new Set(requests.flatMap((request) => (request.departure ? [request.departure.id] : []))),
  ];
  const seatsByDeparture = await bookingsByDeparture(supabase, departureIds);

  const waitingCount = requests.filter((request) => isWaiting(request, now)).length;
  const filtered = filtersActive(list);

  return (
    <>
      <PageHeader
        title="Seat requests"
        description="Every request holds a seat for an hour. Answer before that runs out and the seat goes back on sale."
        action={
          <ButtonLink href={dynamicRoute(`${path}/history`)} tone="secondary">
            History
          </ButtonLink>
        }
      />

      <ListControls path={path} params={list} sorts={CURRENT_SORTS} audience="operator" />

      {truncated ? (
        <div className="mb-6">
          <Alert tone="warn">
            Showing the first {LIST_CAP} requests only. Narrow the dates or choose a status to see
            the rest.
          </Alert>
        </div>
      ) : null}

      <Card>
        <CardHeader
          title={`Today and upcoming (${requests.length})`}
          description={
            waitingCount > 0
              ? `${waitingCount} waiting on you.`
              : 'Nothing is waiting on you right now.'
          }
        />
        <div className="border-b border-ink-150 px-5 py-2.5">
          <SeatLegend />
        </div>

        {requests.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title={filtered ? 'No requests match these filters' : 'No requests coming up'}
              action={
                filtered ? (
                  <ButtonLink href={dynamicRoute(path)} tone="secondary">
                    Clear filters
                  </ButtonLink>
                ) : undefined
              }
            >
              {filtered
                ? 'Try a wider date range or a different status.'
                : 'New requests appear here and email you straight away. Past trips are in History.'}
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {requests.map((request) => {
              const seats = request.departure
                ? seatMap(
                    seatsByDeparture.get(request.departure.id) ?? [],
                    request.departure.max_seats,
                    now,
                  )
                : null;
              const seatView = seats ? <SeatMap seats={seats.seats} overflow={seats.overflow} /> : null;

              return (
                <li key={request.id} className="p-5">
                  {isWaiting(request, now) ? (
                    <WaitingRequest request={request} seatView={seatView} />
                  ) : (
                    <OtherRequest
                      request={request}
                      operatorId={operatorId}
                      now={now}
                      seatView={seatView}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

function WaitingRequest({ request, seatView }: { request: Request; seatView: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink-900">
            {request.passenger?.full_name ?? 'Passenger'}
          </span>
          <BookingStatusBadge status="held" audience="operator" />
          {request.passenger?.gender ? (
            <Badge tone="neutral">{request.passenger.gender}</Badge>
          ) : null}
          <span className="numeric text-sm text-ink-600">{request.passenger?.phone}</span>
        </div>

        <p className="numeric mt-1 text-sm text-ink-700">
          {request.departure ? formatServiceDate(request.departure.service_date) : ''} ·{' '}
          {request.departure ? formatTime(request.departure.departure_time) : ''} ·{' '}
          {request.from_stop?.label} → {request.to_stop?.label}
        </p>

        <p className="mt-1 text-sm text-ink-600">
          {request.seats} seat{request.seats === 1 ? '' : 's'} · {request.luggage_count} bag
          {request.luggage_count === 1 ? '' : 's'} ·{' '}
          <span className="numeric font-medium text-ink-900">
            {formatCents(request.total_cents)}
          </span>
          {/*
            The driver collects the discounted total, so the code is worth
            seeing here rather than being a surprise on the day.
          */}
          {request.discount_cents > 0 ? (
            <span className="numeric ml-1.5 text-good-700">
              (voucher {request.voucher?.code ?? ''} took off{' '}
              {formatCents(request.discount_cents)})
            </span>
          ) : null}
        </p>

        {request.passenger_note ? (
          <p className="mt-2 rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">
            “{request.passenger_note}”
          </p>
        ) : null}

        {request.passenger?.accommodation_notes ? (
          <p className="mt-2 text-sm text-ink-600">
            <span className="font-medium">Needs:</span> {request.passenger.accommodation_notes}
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
        {seatView}
      </div>
    </div>
  );
}

function OtherRequest({
  request,
  operatorId,
  now,
  seatView,
}: {
  request: Request;
  operatorId: string;
  now: Date;
  seatView: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink-900">
            {request.passenger?.full_name ?? 'Passenger'}
          </span>
          <BookingStatusBadge status={effectiveStatus(request, now)} audience="operator" />
        </div>
        <p className="numeric mt-1 text-sm text-ink-700">
          {request.departure ? formatServiceDate(request.departure.service_date) : ''} ·{' '}
          {request.departure ? formatTime(request.departure.departure_time) : ''} ·{' '}
          {request.from_stop?.label} → {request.to_stop?.label}
        </p>
        <p className="mt-1 text-sm text-ink-600">
          {request.seats} seat{request.seats === 1 ? '' : 's'} ·{' '}
          <span className="numeric">{formatCents(request.total_cents)}</span>
        </p>
      </div>

      <div className="flex flex-col items-end gap-2">
        {seatView}
        {request.departure ? (
          <Link
            href={`/operator/${operatorId}/departures/${request.departure.id}`}
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            Open departure
          </Link>
        ) : null}
      </div>
    </div>
  );
}
