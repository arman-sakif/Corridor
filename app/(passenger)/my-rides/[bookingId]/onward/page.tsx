import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OnwardForm } from './onward-form';
import { cancelIncityRide } from '@/lib/incity/actions';
import { offersFor, rideFor } from '@/lib/incity/queries';
import { requireViewer } from '@/lib/auth/session';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { IconVan } from '@/components/icons';
import { createClient } from '@/lib/supabase/server';
import { dynamicRoute } from '@/lib/routes';
import { formatCents } from '@/lib/money';

export const metadata: Metadata = { title: 'Local ride' };

const statusTone = {
  held: 'warn',
  approved: 'good',
  declined: 'bad',
  cancelled: 'neutral',
  completed: 'brand',
} as const;

/**
 * Getting from the drop-off to the front door.
 *
 * This is its own page rather than a panel on the booking, and that is
 * deliberate: in-city is an add-on that has to be removable without touching
 * the core booking flow, so nothing in the intercity path imports this module.
 * The booking page carries a plain link, and everything the add-on knows lives
 * on this side of it.
 */
export default async function OnwardPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const viewer = await requireViewer(`/my-rides/${bookingId}/onward`);

  const supabase = await createClient();
  const { data } = await supabase
    .from('bookings')
    .select(
      `id, status, passenger_id,
       to_stop:stops!bookings_to_stop_id_fkey(label, city:cities(id, name))`,
    )
    .eq('id', bookingId)
    .maybeSingle();

  const booking = data as unknown as {
    id: string;
    status: string;
    passenger_id: string;
    to_stop: { label: string; city: { id: string; name: string } | null } | null;
  } | null;

  // RLS would return nothing for someone else's booking anyway; this makes the
  // answer a 404 rather than a confusing empty page.
  if (!booking || booking.passenger_id !== viewer.userId) notFound();

  const ride = await rideFor(bookingId);
  const cityName = booking.to_stop?.city?.name ?? 'your destination';

  const back = (
    <Link
      href={dynamicRoute(`/my-rides/${bookingId}`)}
      className="text-sm font-medium text-brand-600 hover:text-brand-700"
    >
      Back to the booking
    </Link>
  );

  /* An existing ride — show it rather than offering another. */
  if (ride && ride.status !== 'declined' && ride.status !== 'cancelled') {
    return (
      <>
        <PageHeader
          title="Your local ride"
          description={`From ${ride.pickupLabel}, with ${ride.operatorName}.`}
          action={<Badge tone={statusTone[ride.status]}>{ride.status}</Badge>}
        />

        <Card className="p-5">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-ink-500">Going to</dt>
              <dd className="text-ink-900">{ride.destinationAddress}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Area</dt>
              <dd className="text-ink-900">{ride.zoneName}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Fare</dt>
              <dd className="numeric text-lg font-semibold text-ink-900">
                {formatCents(ride.priceCents)}
              </dd>
            </div>
            {ride.status === 'approved' && ride.operatorPhone ? (
              <div>
                <dt className="text-ink-500">If you cannot find them</dt>
                <dd>
                  <a href={`tel:${ride.operatorPhone}`} className="numeric text-brand-600">
                    {ride.operatorPhone}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>

          {ride.status === 'held' ? (
            <div className="mt-4">
              <Alert tone="info">
                {ride.operatorName} is deciding. Your intercity seat is confirmed either way.
              </Alert>
            </div>
          ) : null}

          <div className="mt-5 flex items-center gap-4">
            <form action={cancelIncityRide}>
              <input type="hidden" name="ride_id" value={ride.id} />
              <input type="hidden" name="booking_id" value={bookingId} />
              <Button type="submit" tone="danger" size="sm">
                Cancel local ride
              </Button>
            </form>
            {back}
          </div>
        </Card>
      </>
    );
  }

  /* No live ride: offer one, if the seat is confirmed and anyone serves the city. */
  if (booking.status !== 'approved') {
    return (
      <>
        <PageHeader title="Local ride" />
        <Card className="p-5">
          <EmptyState icon={<IconVan />} title="Not yet" action={back}>
            You can add a local ride once the operator confirms your seat. Nothing is lost by
            waiting — the fare is the same.
          </EmptyState>
        </Card>
      </>
    );
  }

  const offers = booking.to_stop?.city?.id ? await offersFor(booking.to_stop.city.id) : [];

  if (offers.length === 0) {
    return (
      <>
        <PageHeader title="Local ride" />
        <Card className="p-5">
          <EmptyState icon={<IconVan />} title={`Nobody covers ${cityName} yet`} action={back}>
            No local operator is taking drop-offs where you are arriving. Your seat is unaffected.
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Add a local ride"
        description={`Get from ${booking.to_stop?.label ?? 'your drop-off'} to the door. A flat fare by area, booked separately from your seat.`}
        action={back}
      />

      <div className="space-y-6">
        {offers.map((offer) => (
          <Card key={offer.operatorId}>
            <CardHeader
              title={offer.operatorName}
              description={
                ride?.status === 'declined'
                  ? 'Your last request was declined. You can ask again.'
                  : undefined
              }
            />
            <div className="p-5 pt-0">
              <OnwardForm bookingId={bookingId} offer={offer} />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
