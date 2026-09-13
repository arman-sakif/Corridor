import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ListControls, Pager } from '@/components/list-controls';
import { RideCard, type Ride } from '@/components/ride-card';
import { ButtonLink, EmptyState, PageHeader } from '@/components/ui';
import { IconRoute } from '@/components/icons';
import { requireViewer } from '@/lib/auth/session';
import {
  HISTORY_SORTS,
  PAGE_SIZE,
  filtersActive,
  listHref,
  parseListParams,
  statusClause,
} from '@/lib/booking/ride-list';
import { createClient } from '@/lib/supabase/server';
import { count, rows } from '@/lib/supabase/rows';
import { dynamicRoute } from '@/lib/routes';
import { todayInToronto } from '@/lib/time';

export const metadata: Metadata = { title: 'Ride history' };

/** PostgREST's answer to a page past the end: "range not satisfiable". */
const PAST_THE_END = 'PGRST103';

/**
 * Every ride with a departure before today. Each card still opens the ride,
 * because that is where a passenger confirms payment, rates the trip, or
 * reports it — all things done after the date has passed.
 */
export default async function RideHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireViewer('/my-rides/history');
  const list = parseListParams(await searchParams, HISTORY_SORTS);
  const defaultSort = HISTORY_SORTS[0];
  const path = '/my-rides/history';

  const supabase = await createClient();
  const today = todayInToronto();
  const now = new Date();

  let query = supabase
    .from('bookings')
    .select(
      `id, seats, status, hold_expires_at, total_cents, created_at,
       from_stop:stops!bookings_from_stop_id_fkey(label, city:cities(name)),
       to_stop:stops!bookings_to_stop_id_fkey(label, city:cities(name)),
       departure:departures!inner(service_date, departure_time, operator:operators(name))`,
      { count: 'exact' },
    )
    .eq('passenger_id', viewer.userId)
    .lt('departure.service_date', today);
  if (list.from) query = query.gte('departure.service_date', list.from);
  if (list.to) query = query.lte('departure.service_date', list.to);
  if (list.status) query = query.or(statusClause(list.status, now));

  const ascending = list.sort === 'departure_soonest';
  const start = (list.page - 1) * PAGE_SIZE;
  const result = await query
    // Parent rows ordered by a column of their departure — PostgREST's
    // related-order syntax. `referencedTable` would only reorder the embed.
    .order('departure(service_date)', { ascending })
    .order('departure(departure_time)', { ascending })
    .order('id')
    .range(start, start + PAGE_SIZE - 1);

  if (result.error?.code === PAST_THE_END && list.page > 1) {
    redirect(dynamicRoute(listHref(path, list, { page: 1 }, defaultSort)));
  }

  const rides = rows(result, 'your past rides') as unknown as Ride[];
  const total = count(result, 'your past rides');
  const filtered = filtersActive(list);

  return (
    <>
      <Link href={dynamicRoute('/my-rides')} className="text-sm text-ink-600 hover:text-ink-900">
        ← My rides
      </Link>

      <div className="mt-4">
        <PageHeader
          title="Ride history"
          description="Trips with a departure date before today. Open one to confirm payment or rate it."
        />
      </div>

      <ListControls path={path} params={list} sorts={HISTORY_SORTS} audience="passenger" />

      {rides.length === 0 ? (
        <EmptyState
          title={filtered ? 'No past rides match these filters' : 'No past rides yet'}
          icon={<IconRoute />}
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
            : 'Rides move here once their departure date has passed.'}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {rides.map((ride) => (
            <li key={ride.id}>
              <RideCard ride={ride} now={now} />
            </li>
          ))}
        </ul>
      )}

      <Pager path={path} params={list} total={total} defaultSort={defaultSort} />
    </>
  );
}
