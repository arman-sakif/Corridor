/**
 * Lists of bookings: which to show, and in what order.
 *
 * Shared by My rides, the operator's Requests page, and the History page behind
 * each. Filters and sort live in the URL — a GET form read on the server — so a
 * filtered list survives a refresh and can be sent to someone else. Everything
 * here is pure; the pages turn it into queries.
 */

import { z } from 'zod';

import type { BookingStatus } from '@/lib/supabase/database.types';
import { isValidServiceDate } from '../time.ts';

export type Audience = 'passenger' | 'operator';

/** The status filter, in the groups a person thinks in rather than the enum. */
export const STATUS_FILTERS = {
  waiting: { statuses: ['held'], passenger: 'Waiting on the operator', operator: 'Waiting on you' },
  confirmed: { statuses: ['approved'], passenger: 'Confirmed', operator: 'Confirmed' },
  finished: { statuses: ['completed', 'settled'], passenger: 'Finished', operator: 'Finished' },
  declined: {
    statuses: ['declined', 'expired'],
    passenger: 'Declined or expired',
    operator: 'Declined or lapsed',
  },
  cancelled: {
    statuses: ['cancelled_by_passenger', 'cancelled_by_operator'],
    passenger: 'Cancelled',
    operator: 'Cancelled',
  },
  no_show: { statuses: ['no_show'], passenger: 'No-show', operator: 'No-show' },
} as const satisfies Record<
  string,
  { statuses: readonly BookingStatus[]; passenger: string; operator: string }
>;

export type StatusFilter = keyof typeof STATUS_FILTERS;
export const STATUS_FILTER_KEYS = Object.keys(STATUS_FILTERS) as [StatusFilter, ...StatusFilter[]];

export type SortKey = 'priority' | 'departure_soonest' | 'departure_latest' | 'requested';

/** The current list can put what needs an answer first; history has nothing waiting. */
export const CURRENT_SORTS = ['priority', 'departure_soonest', 'requested'] as const satisfies readonly SortKey[];
export const HISTORY_SORTS = ['departure_latest', 'departure_soonest'] as const satisfies readonly SortKey[];

export function sortLabel(sort: SortKey, audience: Audience): string {
  switch (sort) {
    case 'priority':
      return audience === 'operator' ? 'Waiting on you first' : 'Waiting on the operator first';
    case 'departure_soonest':
      return 'Departure, soonest first';
    case 'departure_latest':
      return 'Departure, latest first';
    case 'requested':
      return 'Newest request first';
  }
}

export const PAGE_SIZE = 25;

/**
 * PostgREST's ceiling on one select. The current lists load up to this many and
 * say so when they hit it, rather than letting a silent truncation pass for
 * the whole list.
 */
export const LIST_CAP = 1000;

export type ListParams = {
  status: StatusFilter | null;
  from: string | null;
  to: string | null;
  sort: SortKey;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
  (Array.isArray(value) ? value[0] : value) || undefined;

// Every field falls back instead of throwing: a hand-edited or stale URL gets
// the default list, not an error page.
const statusSchema = z.enum(STATUS_FILTER_KEYS).optional().catch(undefined);
const dateSchema = z.string().refine(isValidServiceDate).optional().catch(undefined);
const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);

export function parseListParams(raw: RawParams, sorts: readonly SortKey[]): ListParams {
  let from = dateSchema.parse(first(raw.from)) ?? null;
  let to = dateSchema.parse(first(raw.to)) ?? null;
  // Someone who picks the dates the wrong way round means the range between them.
  if (from && to && from > to) [from, to] = [to, from];

  const wanted = first(raw.sort);
  const sort = sorts.find((key) => key === wanted) ?? sorts[0]!;

  return {
    status: statusSchema.parse(first(raw.status)) ?? null,
    from,
    to,
    sort,
    page: pageSchema.parse(first(raw.page)),
  };
}

export function filtersActive(params: ListParams): boolean {
  return Boolean(params.status || params.from || params.to);
}

/** A link to this list with some parameters changed, leaving defaults out of the URL. */
export function listHref(
  path: string,
  params: ListParams,
  patch: Partial<ListParams>,
  defaultSort: SortKey,
): string {
  const next = { ...params, ...patch };
  const query = new URLSearchParams();
  if (next.status) query.set('status', next.status);
  if (next.from) query.set('from', next.from);
  if (next.to) query.set('to', next.to);
  if (next.sort !== defaultSort) query.set('sort', next.sort);
  if (next.page > 1) query.set('page', String(next.page));
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

type HoldFields = { status: BookingStatus; hold_expires_at: string | null };

/** A hold with time left on it. One whose clock ran out is dead, relabelled or not. */
export function isWaiting(booking: HoldFields, now: Date = new Date()): boolean {
  return (
    booking.status === 'held' &&
    booking.hold_expires_at !== null &&
    new Date(booking.hold_expires_at) > now
  );
}

/** The status to show: a lapsed hold reads as expired before any job relabels it. */
export function effectiveStatus(booking: HoldFields, now: Date = new Date()): BookingStatus {
  return booking.status === 'held' && !isWaiting(booking, now) ? 'expired' : booking.status;
}

/**
 * The status filter as a PostgREST `or` clause. Holds are split by their clock
 * rather than their label, matching `isWaiting`: a lapsed hold is not waiting
 * on anyone, and belongs with the expired ones.
 *
 * The timestamp is quoted because `:` and `.` are reserved inside a filter.
 */
export function statusClause(filter: StatusFilter, now: Date = new Date()): string {
  const at = `"${now.toISOString()}"`;
  switch (filter) {
    case 'waiting':
      return `and(status.eq.held,hold_expires_at.gt.${at})`;
    case 'declined':
      return `status.in.(declined,expired),and(status.eq.held,hold_expires_at.lte.${at})`;
    default:
      return `status.in.(${STATUS_FILTERS[filter].statuses.join(',')})`;
  }
}

export type SortableRide = HoldFields & {
  created_at: string;
  departure: { service_date: string; departure_time: string } | null;
};

const departureKey = (ride: SortableRide) =>
  ride.departure ? `${ride.departure.service_date} ${ride.departure.departure_time}` : '';

export function sortRides<T extends SortableRide>(rides: T[], sort: SortKey, now: Date = new Date()): T[] {
  const soonest = (a: T, b: T) => departureKey(a).localeCompare(departureKey(b));
  const sorted = [...rides];

  switch (sort) {
    case 'priority':
      sorted.sort((a, b) => {
        const aWaiting = isWaiting(a, now);
        const bWaiting = isWaiting(b, now);
        if (aWaiting !== bWaiting) return aWaiting ? -1 : 1;
        // Among the waiting, the one about to lapse is the one to answer.
        if (aWaiting) return (a.hold_expires_at ?? '').localeCompare(b.hold_expires_at ?? '');
        return soonest(a, b);
      });
      break;
    case 'departure_soonest':
      sorted.sort(soonest);
      break;
    case 'departure_latest':
      sorted.sort((a, b) => soonest(b, a));
      break;
    case 'requested':
      sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
      break;
  }

  return sorted;
}
