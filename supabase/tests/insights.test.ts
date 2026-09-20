import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { migratedDatabase, type TestDb } from './harness.ts';
import { passenger, seedCorridor, type Corridor } from './seed.ts';

/**
 * What the insights page is told.
 *
 * The number that has to be right is `seats_taken`. Capacity is per leg, so a
 * departure's fullness is its busiest leg — not its booking count, and not the
 * seats summed across legs. Getting that wrong tells an operator to buy a van
 * they do not need, which is exactly the decision this page exists to inform.
 *
 * These rows are written directly rather than through `request_booking()`: a
 * departure in the past is one it rightly refuses, and the past is the only
 * place the question makes sense.
 */

type Row = {
  dow: number;
  departures: number;
  seats_offered: number;
  seats_taken: number;
  full_departures: number;
  bookings: number;
  passengers: number;
  fares_cents: string | number;
  discount_cents: string | number;
  turned_away: number;
};

async function pastDeparture(
  test: TestDb,
  corridor: Corridor,
  { daysAgo, maxSeats = 4, status = 'completed' }: {
    daysAgo: number;
    maxSeats?: number;
    status?: string;
  },
): Promise<{ id: string; dow: number }> {
  const [row] = await test.raw<{ id: string; dow: number }>(
    `insert into public.departures
       (operator_id, route_id, service_date, departure_time, max_seats, status)
     values ($1, $2, current_date - $3::int, '09:00', $4, $5::public.departure_status)
     returning id, extract(dow from service_date)::int as dow`,
    [corridor.operatorId, corridor.routeId, daysAgo, maxSeats, status],
  );
  return row!;
}

async function pastBooking(
  test: TestDb,
  corridor: Corridor,
  {
    departureId,
    passengerId,
    fromSeq,
    toSeq,
    seats = 1,
    status = 'completed',
    fareCents = 4500,
    discountCents = 0,
  }: {
    departureId: string;
    passengerId: string;
    fromSeq: number;
    toSeq: number;
    seats?: number;
    status?: string;
    fareCents?: number;
    discountCents?: number;
  },
): Promise<void> {
  await test.raw(
    `insert into public.bookings
       (departure_id, passenger_id, from_stop_id, to_stop_id, from_seq, to_seq, seats,
        status, base_cents, discount_cents, total_cents)
     values ($1, $2, $3, $4, $5, $6, $7, $8::public.booking_status, $9, $10, $11)`,
    [
      departureId,
      passengerId,
      corridor.stops[fromSeq - 1],
      corridor.stops[toSeq - 1],
      fromSeq,
      toSeq,
      seats,
      status,
      fareCents,
      discountCents,
      fareCents - discountCents,
    ],
  );
}

async function insights(test: TestDb, userId: string, operatorId: string): Promise<Row[]> {
  return test.asUser<Row>(
    userId,
    `select * from public.operator_insights($1, current_date - 30, current_date)`,
    [operatorId],
  );
}

describe('operator insights', () => {
  let test: TestDb;
  let corridor: Corridor;
  let rider: string;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test, { maxSeats: 4 });
    rider = await passenger(test, 'Regular Rider');
  });

  after(async () => test.close());

  // Every `daysAgo` below avoids a multiple of seven. The seed generates a
  // rolling window from today, and today's departure falls inside the range
  // being asked about — so a past date seven days back would share a weekday
  // with it and the two would be added together.
  it('counts the busiest leg, not the seats summed across legs', async () => {
    const departure = await pastDeparture(test, corridor, { daysAgo: 6, maxSeats: 4 });
    const other = await passenger(test, 'Second Rider');

    // Two passengers, one seat each, on stretches that do not overlap. The van
    // was never more than a quarter full — the same physical seat carried both.
    await pastBooking(test, corridor, {
      departureId: departure.id,
      passengerId: rider,
      fromSeq: 1,
      toSeq: 2,
    });
    await pastBooking(test, corridor, {
      departureId: departure.id,
      passengerId: other,
      fromSeq: 3,
      toSeq: 4,
    });

    const rows = await insights(test, corridor.ownerId, corridor.operatorId);
    const day = rows.find((row) => row.dow === departure.dow)!;

    assert.equal(day.seats_taken, 1, 'one seat, carried twice');
    assert.equal(day.passengers, 2);
    assert.equal(day.bookings, 2);
    assert.equal(day.seats_offered, 4);
    assert.equal(day.full_departures, 0);
  });

  it('calls a departure full when its busiest leg is full', async () => {
    const departure = await pastDeparture(test, corridor, { daysAgo: 8, maxSeats: 4 });

    await pastBooking(test, corridor, {
      departureId: departure.id,
      passengerId: rider,
      fromSeq: 1,
      toSeq: 4,
      seats: 4,
    });

    const rows = await insights(test, corridor.ownerId, corridor.operatorId);
    const day = rows.find((row) => row.dow === departure.dow)!;

    assert.equal(day.seats_taken, 4);
    assert.equal(day.full_departures, 1);
  });

  it('adds up fares and the discounts given away on them', async () => {
    const departure = await pastDeparture(test, corridor, { daysAgo: 9 });

    await pastBooking(test, corridor, {
      departureId: departure.id,
      passengerId: rider,
      fromSeq: 1,
      toSeq: 4,
      fareCents: 4500,
      discountCents: 500,
    });

    const rows = await insights(test, corridor.ownerId, corridor.operatorId);
    const day = rows.find((row) => row.dow === departure.dow)!;

    assert.equal(Number(day.fares_cents), 4000, 'what was actually charged');
    assert.equal(Number(day.discount_cents), 500);
  });

  it('counts requests that went nowhere against the day they were made', async () => {
    const departure = await pastDeparture(test, corridor, { daysAgo: 10 });

    await pastBooking(test, corridor, {
      departureId: departure.id,
      passengerId: rider,
      fromSeq: 1,
      toSeq: 4,
      status: 'declined',
    });

    const rows = await insights(test, corridor.ownerId, corridor.operatorId);
    const day = rows.find((row) => row.dow === departure.dow)!;

    assert.equal(day.turned_away, 1);
    assert.equal(day.seats_taken, 0, 'a declined request never occupied a seat');
  });

  it('leaves a cancelled departure out entirely', async () => {
    const departure = await pastDeparture(test, corridor, { daysAgo: 11, status: 'cancelled' });

    const rows = await insights(test, corridor.ownerId, corridor.operatorId);

    assert.equal(
      rows.find((row) => row.dow === departure.dow),
      undefined,
      'a departure that did not run offered no seats and sold none, so its weekday ' +
        'should not appear at all — a day shown at 0% would read as one nobody booked',
    );
  });

  it('does not hand one operator another operator’s numbers', async () => {
    const outsider = await passenger(test, 'Competitor');
    await assert.rejects(
      () => insights(test, outsider, corridor.operatorId),
      /not your numbers/,
    );
  });

  it('answers to a platform admin, who reads every complaint already', async () => {
    const [admin] = await test.raw<{ id: string }>(
      `select id from public.profiles where platform_role = 'admin' limit 1`,
    );

    const rows = await insights(test, admin!.id, corridor.operatorId);
    assert.ok(rows.length > 0);
  });
});
