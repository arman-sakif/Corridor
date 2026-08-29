import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PaymentConfirmForm } from './payment-form';
import { RatingForm } from './rating-form';
import { BookingStatusBadge } from '@/components/booking-status';
import { cancelBooking } from '@/lib/booking/actions';
import { Alert, Button, Card, PageHeader } from '@/components/ui';
import { requireViewer } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { formatCents } from '@/lib/money';
import { formatRelative, formatServiceDateLong, formatTime } from '@/lib/time';
import type { BookingStatus, PaymentMethod } from '@/lib/supabase/database.types';

export const metadata: Metadata = { title: 'Your ride' };

type Booking = {
  id: string;
  seats: number;
  luggage_count: number;
  status: BookingStatus;
  hold_expires_at: string | null;
  base_cents: number;
  luggage_cents: number;
  airport_cents: number;
  total_cents: number;
  passenger_note: string | null;
  payment_method: PaymentMethod | null;
  passenger_confirmed_at: string | null;
  driver_confirmed_at: string | null;
  from_stop: { label: string; description: string | null; city: { name: string } | null } | null;
  to_stop: { label: string; description: string | null; city: { name: string } | null } | null;
  departure: {
    id: string;
    service_date: string;
    departure_time: string;
    operator: { id: string; name: string; public_phone: string | null } | null;
  } | null;
};

export default async function RideDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ requested?: string }>;
}) {
  const [{ bookingId }, query] = await Promise.all([params, searchParams]);
  const viewer = await requireViewer('/my-rides');

  const supabase = await createClient();
  const { data } = await supabase
    .from('bookings')
    .select(
      `id, seats, luggage_count, status, hold_expires_at,
       base_cents, luggage_cents, airport_cents, total_cents, passenger_note,
       payment_method, passenger_confirmed_at, driver_confirmed_at,
       from_stop:stops!bookings_from_stop_id_fkey(label, description, city:cities(name)),
       to_stop:stops!bookings_to_stop_id_fkey(label, description, city:cities(name)),
       departure:departures(id, service_date, departure_time,
         operator:operators(id, name, public_phone))`,
    )
    .eq('id', bookingId)
    .eq('passenger_id', viewer.userId)
    .maybeSingle();

  const booking = data as unknown as Booking | null;
  if (!booking) notFound();

  const cancellable = booking.status === 'held' || booking.status === 'approved';
  const awaitingPayment = booking.status === 'completed' && !booking.passenger_confirmed_at;
  const rateable = booking.status === 'completed' || booking.status === 'settled';

  return (
    <>
      <Link href="/my-rides" className="text-sm text-ink-600 hover:text-ink-900">
        ← All my rides
      </Link>

      <div className="mt-4">
        <PageHeader
          title={`${booking.from_stop?.city?.name ?? ''} to ${booking.to_stop?.city?.name ?? ''}`}
          description={
            booking.departure
              ? `${formatServiceDateLong(booking.departure.service_date)} at ${formatTime(booking.departure.departure_time)}`
              : undefined
          }
          action={<BookingStatusBadge status={booking.status} />}
        />
      </div>

      {query.requested ? (
        <div className="mb-6">
          <Alert tone="good">
            Seat requested. {booking.departure?.operator?.name} has an hour to confirm — we will
            email you either way.
          </Alert>
        </div>
      ) : null}

      {booking.status === 'held' && booking.hold_expires_at ? (
        <div className="mb-6">
          <Alert tone="warn">
            Your seat is held until {formatRelative(booking.hold_expires_at)}. If the operator has
            not answered by then, it goes back on sale and you can try another departure.
          </Alert>
        </div>
      ) : null}

      <div className="space-y-6">
        <Card className="p-5">
          <h2 className="text-sm font-semibold tracking-wide text-ink-500 uppercase">The trip</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <Row label="Operator">
              <span className="font-medium text-ink-900">
                {booking.departure?.operator?.name}
              </span>
              {booking.status === 'approved' && booking.departure?.operator?.public_phone ? (
                <span className="numeric block text-ink-600">
                  {booking.departure.operator.public_phone}
                </span>
              ) : null}
            </Row>
            <Row label="Pick up">
              <span className="text-ink-900">{booking.from_stop?.label}</span>
              {booking.from_stop?.description ? (
                <span className="block text-xs text-ink-500">{booking.from_stop.description}</span>
              ) : null}
            </Row>
            <Row label="Drop off">
              <span className="text-ink-900">{booking.to_stop?.label}</span>
              {booking.to_stop?.description ? (
                <span className="block text-xs text-ink-500">{booking.to_stop.description}</span>
              ) : null}
            </Row>
            <Row label="Seats">
              <span className="numeric text-ink-900">{booking.seats}</span>
            </Row>
            <Row label="Bags">
              <span className="numeric text-ink-900">{booking.luggage_count}</span>
            </Row>
            {booking.passenger_note ? (
              <Row label="Your note">
                <span className="text-ink-900">{booking.passenger_note}</span>
              </Row>
            ) : null}
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold tracking-wide text-ink-500 uppercase">
            What you pay
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Line label={`Fare — ${booking.seats} seat${booking.seats === 1 ? '' : 's'}`} cents={booking.base_cents} />
            {booking.luggage_cents > 0 ? <Line label="Extra luggage" cents={booking.luggage_cents} /> : null}
            {booking.airport_cents > 0 ? <Line label="Airport fee" cents={booking.airport_cents} /> : null}
            <div className="flex justify-between border-t border-ink-100 pt-2 font-semibold text-ink-900">
              <dt>Total</dt>
              <dd className="numeric">{formatCents(booking.total_cents)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-ink-500">
            Paid to the driver on the day. Cash and e-transfer cost the same.
          </p>
        </Card>

        {awaitingPayment ? (
          <Card className="p-5">
            <h2 className="font-semibold text-ink-900">How did you pay?</h2>
            <p className="mt-1 mb-4 text-sm text-ink-600">
              The driver confirms it from their side too.
            </p>
            <PaymentConfirmForm bookingId={booking.id} />
          </Card>
        ) : null}

        {booking.status === 'settled' ? (
          <Alert tone="good">
            Paid by {booking.payment_method === 'cash' ? 'cash' : 'e-transfer'} and confirmed by
            both sides. Nothing left to do.
          </Alert>
        ) : null}

        {rateable ? (
          <Card className="p-5">
            <h2 className="font-semibold text-ink-900">
              How was {booking.departure?.operator?.name}?
            </h2>
            <p className="mt-1 mb-4 text-sm text-ink-600">
              Other passengers see this on their profile.
            </p>
            <RatingForm bookingId={booking.id} />
          </Card>
        ) : null}

        {cancellable ? (
          <Card className="p-5">
            <h2 className="font-semibold text-ink-900">Change of plan?</h2>
            <p className="mt-1 mb-4 text-sm text-ink-600">
              Cancelling is free — nothing has been charged. It is recorded, and operators can see
              it when they decide on your next request, so please only cancel if you really cannot
              travel.
            </p>
            <form action={cancelBooking}>
              <input type="hidden" name="booking_id" value={booking.id} />
              <Button type="submit" tone="danger">
                Cancel this ride
              </Button>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <dt className="w-24 shrink-0 text-ink-500">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Line({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex justify-between text-ink-700">
      <dt>{label}</dt>
      <dd className="numeric">{formatCents(cents)}</dd>
    </div>
  );
}
