import { notFound } from 'next/navigation';

import { approveIncityRide, declineIncityRide } from '@/lib/incity/actions';
import { requireOperatorRole } from '@/lib/auth/session';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { IconVan } from '@/components/icons';
import { createClient } from '@/lib/supabase/server';
import { formatCents } from '@/lib/money';
import { formatRelative, formatServiceDate, formatTime } from '@/lib/time';
import type { IncityBookingStatus } from '@/lib/supabase/database.types';

type Ride = {
  id: string;
  status: IncityBookingStatus;
  destination_address: string;
  price_cents: number;
  created_at: string;
  zone: { name: string } | null;
  pickup: { label: string } | null;
  booking: {
    id: string;
    seats: number;
    passenger: { full_name: string | null; phone: string | null } | null;
    departure: { service_date: string; departure_time: string } | null;
  } | null;
};

const statusTone = {
  held: 'warn',
  approved: 'good',
  declined: 'bad',
  cancelled: 'neutral',
  completed: 'brand',
} as const;

/**
 * What an in-city operator has been asked to drive.
 *
 * The passenger's name and phone come through the parent booking —
 * `incity_bookings` has no passenger of its own — and they are the whole point
 * of the screen: this operator has to reach somebody at a kerb.
 */
export default async function IncityRequestsPage({
  params,
}: {
  params: Promise<{ operatorId: string }>;
}) {
  const { operatorId } = await params;
  const { membership } = await requireOperatorRole(operatorId);

  if (membership.operator?.type !== 'incity') notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from('incity_bookings')
    .select(
      `id, status, destination_address, price_cents, created_at,
       zone:incity_zones(name),
       pickup:stops(label),
       booking:bookings(
         id, seats,
         passenger:profiles(full_name, phone),
         departure:departures(service_date, departure_time)
       )`,
    )
    .eq('operator_id', operatorId)
    .order('created_at', { ascending: false });

  const rides = (data ?? []) as unknown as Ride[];
  const waiting = rides.filter((ride) => ride.status === 'held');
  const settled = rides.filter((ride) => ride.status !== 'held');

  return (
    <>
      <PageHeader
        title="Requests"
        description="Local rides asked for by passengers arriving on an intercity booking."
      />

      <Card>
        <CardHeader
          title="Waiting on you"
          description={
            waiting.length > 0
              ? `${waiting.length} to answer.`
              : 'Nothing waiting. New requests land here.'
          }
        />

        {waiting.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<IconVan />} title="Nothing to answer">
              When somebody arriving in your city asks for a drop-off, it turns up here with their
              name and number.
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-ink-200">
            {waiting.map((ride) => (
              <li key={ride.id} className="px-5 py-4">
                <RideDetail ride={ride} />

                <div className="mt-3 flex gap-2">
                  <form action={approveIncityRide}>
                    <input type="hidden" name="ride_id" value={ride.id} />
                    <input type="hidden" name="operator_id" value={operatorId} />
                    <Button type="submit">Confirm ride</Button>
                  </form>
                  <form action={declineIncityRide}>
                    <input type="hidden" name="ride_id" value={ride.id} />
                    <input type="hidden" name="operator_id" value={operatorId} />
                    <Button type="submit" tone="danger">
                      Decline
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {settled.length > 0 ? (
        <div className="mt-6">
          <Card>
            <CardHeader title="Already answered" />
            <ul className="divide-y divide-ink-200">
              {settled.map((ride) => (
                <li key={ride.id} className="px-5 py-4">
                  <div className="mb-1">
                    <Badge tone={statusTone[ride.status]}>{ride.status}</Badge>
                  </div>
                  <RideDetail ride={ride} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </>
  );
}

function RideDetail({ ride }: { ride: Ride }) {
  const passenger = ride.booking?.passenger;
  const departure = ride.booking?.departure;

  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-ink-900">
          {passenger?.full_name ?? 'A passenger'}
        </span>
        {passenger?.phone ? (
          <a href={`tel:${passenger.phone}`} className="numeric text-brand-600 hover:text-brand-700">
            {passenger.phone}
          </a>
        ) : null}
        <span className="text-xs text-ink-500">asked {formatRelative(ride.created_at)}</span>
      </div>

      <p className="text-ink-700">
        <span className="text-ink-500">Collect at</span> {ride.pickup?.label ?? 'a pickup point'}
        {departure ? (
          <>
            {' '}
            <span className="text-ink-500">after the</span>{' '}
            {formatServiceDate(departure.service_date)} {formatTime(departure.departure_time)}{' '}
            <span className="text-ink-500">arrival</span>
          </>
        ) : null}
      </p>

      <p className="text-ink-700">
        <span className="text-ink-500">Take to</span> {ride.destination_address}
      </p>

      <p className="text-ink-700">
        <span className="text-ink-500">Area</span> {ride.zone?.name ?? '—'} ·{' '}
        <span className="numeric font-medium text-ink-900">{formatCents(ride.price_cents)}</span>
      </p>
    </div>
  );
}
