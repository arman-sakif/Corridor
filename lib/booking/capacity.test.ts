import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countsTowardCapacity, holdExpiresAt, legLoads, seatsAvailable } from './capacity.ts';
import type { CapacityBooking } from './capacity.ts';

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

describe('countsTowardCapacity', () => {
  it('counts approved, completed, and settled bookings', () => {
    for (const status of ['approved', 'completed', 'settled'] as const) {
      assert.equal(countsTowardCapacity(booking({ status }), NOW), true, status);
    }
  });

  it('ignores declined, cancelled, expired, and no-show bookings', () => {
    const dead = [
      'declined',
      'expired',
      'cancelled_by_passenger',
      'cancelled_by_operator',
      'no_show',
    ] as const;
    for (const status of dead) {
      assert.equal(countsTowardCapacity(booking({ status }), NOW), false, status);
    }
  });

  it('counts a live hold and frees a lapsed one without any job running', () => {
    assert.equal(
      countsTowardCapacity(booking({ status: 'held', hold_expires_at: LATER }), NOW),
      true,
    );
    assert.equal(
      countsTowardCapacity(booking({ status: 'held', hold_expires_at: EARLIER }), NOW),
      false,
    );
  });
});

describe('legLoads', () => {
  // Windsor(1) → Chatham(2) → London(3) → Yorkdale(4)
  const bookings = [
    booking({ from_seq: 1, to_seq: 3, seats: 2 }),
    booking({ from_seq: 3, to_seq: 4, seats: 1 }),
    booking({ from_seq: 2, to_seq: 4, seats: 1 }),
  ];

  it('spreads each booking across every leg it spans', () => {
    assert.deepEqual(legLoads(bookings, 4, NOW), [2, 3, 2]);
  });

  it('leaves a leg empty when nothing crosses it', () => {
    assert.deepEqual(legLoads([booking({ from_seq: 3, to_seq: 4 })], 4, NOW), [0, 0, 1]);
  });
});

describe('seatsAvailable', () => {
  it('lets disjoint segments reuse the same physical seat', () => {
    // Two bookings, one seat of capacity, no overlap: both fit.
    const bookings = [
      booking({ from_seq: 1, to_seq: 2 }),
      booking({ from_seq: 2, to_seq: 3 }),
    ];
    assert.equal(
      seatsAvailable({ bookings, maxSeats: 1, fromSeq: 1, toSeq: 2, now: NOW }),
      0,
    );
    // A third leg is untouched, so it is still fully open.
    assert.equal(
      seatsAvailable({ bookings, maxSeats: 1, fromSeq: 3, toSeq: 4, now: NOW }),
      1,
    );
  });

  it('is limited by the busiest leg the segment spans, not the average', () => {
    const bookings = [
      booking({ from_seq: 2, to_seq: 3, seats: 10 }),
      booking({ from_seq: 1, to_seq: 2, seats: 1 }),
    ];
    // Leg 2 carries 10 of 16, so a 1→4 booking sees 6 seats, not 15.
    assert.equal(
      seatsAvailable({ bookings, maxSeats: 16, fromSeq: 1, toSeq: 4, now: NOW }),
      6,
    );
  });

  it('carries more bookings than max_seats when no leg is oversold', () => {
    const bookings = [
      booking({ from_seq: 1, to_seq: 2, seats: 4 }),
      booking({ from_seq: 2, to_seq: 3, seats: 4 }),
      booking({ from_seq: 3, to_seq: 4, seats: 4 }),
    ];
    // 12 seats sold on a 4-seat departure — legal, because no leg exceeds 4.
    assert.equal(
      seatsAvailable({ bookings, maxSeats: 4, fromSeq: 1, toSeq: 4, now: NOW }),
      0,
    );
    assert.deepEqual(legLoads(bookings, 4, NOW), [4, 4, 4]);
  });

  it('frees the seat an expired hold was occupying', () => {
    const bookings = [booking({ status: 'held', hold_expires_at: EARLIER, seats: 4 })];
    assert.equal(
      seatsAvailable({ bookings, maxSeats: 4, fromSeq: 1, toSeq: 2, now: NOW }),
      4,
    );
  });

  it('never reports a negative count', () => {
    const bookings = [booking({ from_seq: 1, to_seq: 2, seats: 99 })];
    assert.equal(
      seatsAvailable({ bookings, maxSeats: 4, fromSeq: 1, toSeq: 2, now: NOW }),
      0,
    );
  });
});

describe('holdExpiresAt', () => {
  it('gives the operator an hour when the departure is further out', () => {
    const departure = new Date('2026-09-04T09:00:00Z');
    assert.equal(holdExpiresAt(NOW, departure).toISOString(), '2026-09-03T13:00:00.000Z');
  });

  it('never holds a seat past the departure itself', () => {
    const departure = new Date('2026-09-03T12:20:00Z');
    assert.equal(holdExpiresAt(NOW, departure).toISOString(), departure.toISOString());
  });
});
