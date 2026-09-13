import type { Metadata } from 'next';

import { ListControls } from '@/components/list-controls';
import { RideCard, type Ride } from '@/components/ride-card';
import { Alert, ButtonLink, EmptyState, PageHeader } from '@/components/ui';
import { IconRoute } from '@/components/icons';
import { requireViewer } from '@/lib/auth/session';
import {
  CURRENT_SORTS,
  LIST_CAP,
  filtersActive,
  parseListParams,
  sortRides,
  statusClause,
} from '@/lib/booking/ride-list';
import { createClient } from '@/lib/supabase/server';
import { rows } from '@/lib/supabase/rows';
import { dynamicRoute } from '@/lib/routes';
import { todayInToronto } from '@/lib/time';

export const metadata: Metadata = { title: 'My rides' };

/**
 * A passenger's rides from today on, with what is still waiting on an operator
 * first. Anything with a departure before today is on the History page.
 */
export default async function MyRidesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireViewer('/my-rides');
  const list = parseListParams(await searchParams, CURRENT_SORTS);

  const supabase = await createClient();
  const today = todayInToronto();
  const now = new Date();
  const from = list.from && list.from > today ? list.from : today;

  let query = supabase
    .from('bookings')
    .select(
      `id, seats, status, hold_expires_at, total_cents, created_at,
       from_stop:stops!bookings_from_stop_id_fkey(label, city:cities(name)),
       to_stop:stops!bookings_to_stop_id_fkey(label, city:cities(name)),
       departure:departures!inner(service_date, departure_time, operator:operators(name))`,
    )
    // Filtered in the query as well as by RLS: someone who also works for an
    // operator can read that operator's bookings, and they are not this
    // person's rides.
    .eq('passenger_id', viewer.userId)
    .gte('departure.service_date', from);
  if (list.to) query = query.lte('departure.service_date', list.to);
  if (list.status) query = query.or(statusClause(list.status, now));

  const loaded = rows(
    await query.order('created_at', { ascending: false }).range(0, LIST_CAP - 1),
    'your rides',
  ) as unknown as Ride[];
  const rides = sortRides(loaded, list.sort, now);
  const filtered = filtersActive(list);

  return (
    <>
      <PageHeader
        title="My rides"
        description="Everything from today on, and how each one stands."
        action={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={dynamicRoute('/my-rides/history')} tone="secondary">
              History
            </ButtonLink>
            <ButtonLink href="/">Find a ride</ButtonLink>
          </div>
        }
      />

      <ListControls path="/my-rides" params={list} sorts={CURRENT_SORTS} audience="passenger" />

      {loaded.length === LIST_CAP ? (
        <div className="mb-6">
          <Alert tone="warn">
            Showing the first {LIST_CAP} rides only. Narrow the dates to see the rest.
          </Alert>
        </div>
      ) : null}

      {rides.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No rides match these filters"
            icon={<IconRoute />}
            action={
              <ButtonLink href={dynamicRoute('/my-rides')} tone="secondary">
                Clear filters
              </ButtonLink>
            }
          >
            Try a wider date range or a different status.
          </EmptyState>
        ) : (
          <EmptyState
            title="Nothing coming up"
            icon={<IconRoute />}
            action={<ButtonLink href="/">Search for a ride</ButtonLink>}
          >
            Search a city pair and a date, then request a seat. The operator confirms within the
            hour. Trips you have already taken are in History.
          </EmptyState>
        )
      ) : (
        <ul className="space-y-3">
          {rides.map((ride) => (
            <li key={ride.id}>
              <RideCard ride={ride} now={now} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
