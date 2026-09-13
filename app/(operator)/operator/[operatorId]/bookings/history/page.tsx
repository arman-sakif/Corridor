import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BookingStatusBadge } from '@/components/booking-status';
import { ListControls, Pager } from '@/components/list-controls';
import { ButtonLink, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import {
  HISTORY_SORTS,
  PAGE_SIZE,
  effectiveStatus,
  filtersActive,
  listHref,
  parseListParams,
  statusClause,
} from '@/lib/booking/ride-list';
import { createClient } from '@/lib/supabase/server';
import { count, rows } from '@/lib/supabase/rows';
import { dynamicRoute } from '@/lib/routes';
import { formatCents } from '@/lib/money';
import { formatServiceDate, formatTime, todayInToronto } from '@/lib/time';
import type { BookingStatus } from '@/lib/supabase/database.types';

type PastRequest = {
  id: string;
  seats: number;
  status: BookingStatus;
  hold_expires_at: string | null;
  total_cents: number;
  passenger: { full_name: string | null } | null;
  from_stop: { city: { name: string } | null } | null;
  to_stop: { city: { name: string } | null } | null;
  departure: { id: string; service_date: string; departure_time: string } | null;
};

/** PostgREST's answer to a page past the end: "range not satisfiable". */
const PAST_THE_END = 'PGRST103';

/**
 * Every request on a departure before today. Read-only — nothing here is
 * waiting on anyone — and paged, because unlike the upcoming list it only ever
 * grows.
 */
export default async function RequestHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ operatorId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ operatorId }, raw] = await Promise.all([params, searchParams]);
  const list = parseListParams(raw, HISTORY_SORTS);
  const defaultSort = HISTORY_SORTS[0];
  const path = `/operator/${operatorId}/bookings/history`;

  const supabase = await createClient();
  const today = todayInToronto();
  const now = new Date();

  let query = supabase
    .from('bookings')
    .select(
      `id, seats, status, hold_expires_at, total_cents,
       passenger:profiles(full_name),
       from_stop:stops!bookings_from_stop_id_fkey(city:cities(name)),
       to_stop:stops!bookings_to_stop_id_fkey(city:cities(name)),
       departure:departures!inner(id, operator_id, service_date, departure_time)`,
      { count: 'exact' },
    )
    .eq('departure.operator_id', operatorId)
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

  // A page number past the end, from an old link or a narrowed filter.
  if (result.error?.code === PAST_THE_END && list.page > 1) {
    redirect(dynamicRoute(listHref(path, list, { page: 1 }, defaultSort)));
  }

  const past = rows(result, 'past requests') as unknown as PastRequest[];
  const total = count(result, 'past requests');
  const filtered = filtersActive(list);

  return (
    <>
      <Link
        href={dynamicRoute(`/operator/${operatorId}/bookings`)}
        className="text-sm text-ink-600 hover:text-ink-900"
      >
        ← Seat requests
      </Link>

      <div className="mt-4">
        <PageHeader
          title="Request history"
          description="Every request on a departure before today, and how each one ended."
        />
      </div>

      <ListControls path={path} params={list} sorts={HISTORY_SORTS} audience="operator" />

      <Card>
        {past.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title={filtered ? 'No past requests match these filters' : 'No past requests yet'}
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
                : 'Requests move here once their departure date has passed.'}
            </EmptyState>
          </div>
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
              {past.map((request) => (
                <Tr key={request.id}>
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
                    <BookingStatusBadge status={effectiveStatus(request, now)} audience="operator" />
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
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Pager path={path} params={list} total={total} defaultSort={defaultSort} />
    </>
  );
}
