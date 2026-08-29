/**
 * Per-leg capacity — for display only.
 *
 * ⚠ Nothing here may gate an insert. A read-then-write in application code is
 * a race: two passengers taking the last seat at the same instant would both
 * pass this check and both be written. The authority is the Postgres function
 * `request_booking()`, which locks the departure row before counting.
 *
 * These functions exist so search can say "3 seats left" and the operator's
 * departure view can draw the load per leg. Being a moment stale there is
 * harmless; being a moment stale at insert time is an oversold van.
 *
 * The rule, for a booking spanning stop sequence a → b:
 *
 *     for every leg i in [a, b-1]:
 *         seats_taken(i) + requested <= max_seats
 *
 * A departure with max_seats = 16 can therefore carry far more than 16
 * bookings, as long as no single leg exceeds 16. Windsor→London and
 * London→Yorkdale occupy the same physical seat.
 *
 *     seq:     1 ─────── 2 ─────── 3 ─────── 4
 *              Windsor   Chatham   London    Yorkdale
 *     legs:        L1        L2        L3
 *
 *     A (1→3, 2 seats)  ████████████
 *     B (3→4, 1 seat)                      ██████
 *     C (2→4, 1 seat)               ██████████████
 *     load:        2         3         2
 */

import type { BookingStatus } from '@/lib/supabase/database.types';

/** The subset of a booking row the capacity scan needs. */
export type CapacityBooking = {
  from_seq: number;
  to_seq: number;
  seats: number;
  status: BookingStatus;
  hold_expires_at: string | null;
};

/**
 * Whether a booking still occupies a seat.
 *
 * Expired holds are excluded *inline* rather than swept by a job, which makes
 * capacity self-healing: a seat frees itself the instant its hold lapses,
 * whether or not any background job has run. This mirrors the SQL exactly.
 */
export function countsTowardCapacity(booking: CapacityBooking, now: Date = new Date()): boolean {
  if (booking.status === 'approved' || booking.status === 'completed' || booking.status === 'settled') {
    return true;
  }
  if (booking.status !== 'held') return false;
  return booking.hold_expires_at !== null && new Date(booking.hold_expires_at) > now;
}

/**
 * Seats occupied on each leg. Index `i` is the leg from stop seq `i + 1` to
 * `i + 2`, so a route with `stopCount` stops yields `stopCount - 1` entries.
 */
export function legLoads(
  bookings: CapacityBooking[],
  stopCount: number,
  now: Date = new Date(),
): number[] {
  const loads = new Array<number>(Math.max(0, stopCount - 1)).fill(0);

  for (const booking of bookings) {
    if (!countsTowardCapacity(booking, now)) continue;
    for (let seq = booking.from_seq; seq < booking.to_seq; seq += 1) {
      const leg = seq - 1;
      if (leg >= 0 && leg < loads.length) loads[leg] = loads[leg]! + booking.seats;
    }
  }

  return loads;
}

/**
 * Seats still sellable on one segment: `max_seats` minus the *busiest* leg the
 * segment spans. Advisory — see the warning at the top of this file.
 */
export function seatsAvailable({
  bookings,
  maxSeats,
  fromSeq,
  toSeq,
  now = new Date(),
}: {
  bookings: CapacityBooking[];
  maxSeats: number;
  fromSeq: number;
  toSeq: number;
  now?: Date;
}): number {
  if (toSeq <= fromSeq) return 0;

  let busiest = 0;
  for (let seq = fromSeq; seq < toSeq; seq += 1) {
    let load = 0;
    for (const booking of bookings) {
      if (!countsTowardCapacity(booking, now)) continue;
      if (booking.from_seq <= seq && booking.to_seq >= seq + 1) load += booking.seats;
    }
    if (load > busiest) busiest = load;
  }

  return Math.max(0, maxSeats - busiest);
}

/** Hold window: one hour, but never past the departure itself. */
export const HOLD_DURATION_MS = 60 * 60 * 1000;

export function holdExpiresAt(now: Date, departureInstant: Date): Date {
  const hour = new Date(now.getTime() + HOLD_DURATION_MS);
  return hour < departureInstant ? hour : departureInstant;
}
