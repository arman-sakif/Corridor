import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { legLoads } from './capacity.ts';
import type { CapacityBooking } from './capacity.ts';
import { seatMap } from './seat-map.ts';

const NOW = new Date('2026-09-03T12:00:00Z');
const LATER = new Date('2026-09-03T12:30:00Z').toISOString();
const EARLIER = new Date('2026-09-03T11:30:00Z').toISOString();

function booking(partial: Partial<CapacityBooking>): CapacityBooking {
  return {
    from_seq: 1,
    to_seq: 2,
    seats: 1,
    status: 'approved',
    hold_expires_at: null,
    ...partial,
  };
}

/** Each seat as a word, with `*` for a shared one — easy to read in a failure. */
function drawn(result: ReturnType<typeof seatMap>): string[] {
  return result.seats.map((seat) => seat.state + (seat.shared ? '*' : ''));
}

describe('seatMap', () => {
  it('draws an empty departure as every seat free', () => {
    assert.deepEqual(drawn(seatMap([], 4, NOW)), ['empty', 'empty', 'empty', 'empty']);
  });

  it('puts back-to-back legs in one seat and marks it shared', () => {
    const result = seatMap(
      [booking({ from_seq: 1, to_seq: 2 }), booking({ from_seq: 2, to_seq: 3 })],
      3,
      NOW,
    );
    assert.deepEqual(drawn(result), ['taken*', 'empty', 'empty']);
  });

  it('gives overlapping journeys separate seats', () => {
    const result = seatMap(
      [booking({ from_seq: 1, to_seq: 3 }), booking({ from_seq: 2, to_seq: 4 })],
      3,
      NOW,
    );
    assert.deepEqual(drawn(result), ['taken', 'taken', 'empty']);
  });

  it('takes one square for every seat in a booking', () => {
    assert.deepEqual(drawn(seatMap([booking({ seats: 3 })], 4, NOW)), [
      'taken',
      'taken',
      'taken',
      'empty',
    ]);
  });

  it('shows a live hold as held', () => {
    const result = seatMap([booking({ status: 'held', hold_expires_at: LATER })], 2, NOW);
    assert.deepEqual(drawn(result), ['held', 'empty']);
  });

  it('frees the seat of a lapsed hold, and of bookings that hold nothing', () => {
    const result = seatMap(
      [
        booking({ status: 'held', hold_expires_at: EARLIER }),
        booking({ status: 'declined' }),
        booking({ status: 'cancelled_by_passenger' }),
        booking({ status: 'no_show' }),
      ],
      2,
      NOW,
    );
    assert.deepEqual(drawn(result), ['empty', 'empty']);
  });

  it('reads a shared seat as held while any part of it is still waiting', () => {
    const result = seatMap(
      [
        booking({ from_seq: 1, to_seq: 2 }),
        booking({ from_seq: 2, to_seq: 3, status: 'held', hold_expires_at: LATER }),
      ],
      2,
      NOW,
    );
    assert.deepEqual(drawn(result), ['held*', 'empty']);
  });

  it('orders confirmed seats, then held, then free', () => {
    const result = seatMap(
      [
        booking({ from_seq: 1, to_seq: 3, status: 'held', hold_expires_at: LATER }),
        booking({ from_seq: 1, to_seq: 3 }),
      ],
      3,
      NOW,
    );
    assert.deepEqual(drawn(result), ['taken', 'held', 'empty']);
  });

  it('fills exactly as many seats as the busiest leg carries', () => {
    const bookings = [
      booking({ from_seq: 1, to_seq: 3, seats: 2 }),
      booking({ from_seq: 3, to_seq: 5 }),
      booking({ from_seq: 2, to_seq: 4 }),
      booking({ from_seq: 4, to_seq: 5, seats: 2 }),
      booking({ from_seq: 1, to_seq: 2 }),
      booking({ from_seq: 2, to_seq: 3, status: 'held', hold_expires_at: LATER }),
    ];
    const busiest = Math.max(...legLoads(bookings, 5, NOW));
    const filled = seatMap(bookings, 10, NOW).seats.filter((seat) => seat.state !== 'empty');

    assert.equal(busiest, 4);
    assert.equal(filled.length, busiest);
  });

  it('reports seats beyond capacity instead of cutting them off', () => {
    const result = seatMap([booking({ seats: 3 })], 2, NOW);
    assert.equal(result.overflow, 1);
    assert.equal(result.seats.length, 3);
  });
});
