/**
 * How full the car looks — for display only.
 *
 * ⚠ Like `capacity.ts`, nothing here may gate a booking. The authority on
 * whether a seat can be sold is `request_booking()`, which locks the departure
 * before counting.
 *
 * Seats in Corridor are not numbered, and capacity is per leg: Windsor→London
 * and London→Yorkdale can be the same physical seat. So this does not describe
 * a real seating plan. It deals the bookings out into `max_seats` squares so an
 * operator can see at a glance how full a departure is, and marks a square that
 * two passengers share on different legs.
 *
 * The dealing is interval partitioning: take each booked seat in order of where
 * it boards, and put it in a square that is free by then. That uses exactly as
 * many squares as the busiest leg carries — never more — so the picture agrees
 * with the load-per-leg numbers beside it.
 */

import { countsTowardCapacity, type CapacityBooking } from './capacity.ts';

export type SeatState = 'empty' | 'held' | 'taken';

export type Seat = {
  state: SeatState;
  /** More than one booking sits in this square, on legs that do not overlap. */
  shared: boolean;
};

type Piece = { from: number; to: number; held: boolean };
type Square = { lastTo: number; pieces: number; held: boolean };

const ORDER: Record<SeatState, number> = { taken: 0, held: 1, empty: 2 };

export function seatMap(
  bookings: CapacityBooking[],
  maxSeats: number,
  now: Date = new Date(),
): { seats: Seat[]; overflow: number } {
  // One piece per seat booked. A lapsed hold is dropped here, inline, exactly
  // as the capacity SQL drops it.
  const pieces: Piece[] = [];
  for (const booking of bookings) {
    if (!countsTowardCapacity(booking, now) || booking.to_seq <= booking.from_seq) continue;
    for (let seat = 0; seat < booking.seats; seat += 1) {
      pieces.push({ from: booking.from_seq, to: booking.to_seq, held: booking.status === 'held' });
    }
  }
  pieces.sort((a, b) => a.from - b.from || a.to - b.to);

  const squares: Square[] = [];
  for (const piece of pieces) {
    // Best fit: of the squares already free when this passenger boards, the
    // one that freed up last. Any free square keeps the count minimal; best
    // fit only keeps shared squares tidy.
    let best: Square | undefined;
    for (const square of squares) {
      if (square.lastTo <= piece.from && (!best || square.lastTo > best.lastTo)) best = square;
    }

    if (best) {
      best.lastTo = piece.to;
      best.pieces += 1;
      // Part of the square still needs an answer, so it reads as held.
      best.held ||= piece.held;
    } else {
      squares.push({ lastTo: piece.to, pieces: 1, held: piece.held });
    }
  }

  const seats: Seat[] = squares.map((square) => ({
    state: square.held ? 'held' : 'taken',
    shared: square.pieces > 1,
  }));
  while (seats.length < maxSeats) seats.push({ state: 'empty', shared: false });
  seats.sort((a, b) => ORDER[a.state] - ORDER[b.state]);

  // Only bad data can push past max_seats — request_booking() refuses it. If it
  // happens, the extra squares are drawn and counted rather than cut off.
  return { seats, overflow: Math.max(0, squares.length - maxSeats) };
}
