import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { migratedDatabase, type TestDb } from './harness.ts';
import { passenger, requestSeat, seedCorridor, type Corridor } from './seed.ts';

/**
 * The booking lifecycle, and departure day.
 *
 *   held ──approve──▶ approved ──trip runs──▶ completed ──both confirm──▶ settled
 *
 * Each transition is a Postgres function rather than an update policy, because
 * "which state may follow which" is not something a policy can express without
 * reading the row it is protecting.
 */

async function bookingOn(
  test: TestDb,
  corridor: Corridor,
  name: string,
  overrides: { fromSeq?: number; toSeq?: number; seats?: number } = {},
) {
  const rider = await passenger(test, name);
  const bookingId = await requestSeat(test, rider, {
    departureId: corridor.departureId,
    fromSeq: overrides.fromSeq ?? 1,
    toSeq: overrides.toSeq ?? 4,
    stops: corridor.stops,
    seats: overrides.seats ?? 1,
  });
  return { rider, bookingId };
}

async function statusOf(test: TestDb, bookingId: string): Promise<string> {
  const [row] = await test.raw<{ status: string }>(
    `select status from public.bookings where id = $1`,
    [bookingId],
  );
  return row!.status;
}

describe('approve and decline', () => {
  let test: TestDb;
  let corridor: Corridor;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test, { maxSeats: 2 });
  });

  after(async () => test.close());

  it('confirms a request and clears its expiry', async () => {
    const { bookingId } = await bookingOn(test, corridor, 'Approved Rider');

    await test.asUser(corridor.ownerId, `select public.approve_booking($1)`, [bookingId]);

    const [row] = await test.raw<{
      status: string;
      hold_expires_at: string | null;
      approved_at: string | null;
    }>(`select status, hold_expires_at, approved_at from public.bookings where id = $1`, [
      bookingId,
    ]);

    assert.equal(row!.status, 'approved');
    assert.equal(row!.hold_expires_at, null, 'an approved seat is not on a clock');
    assert.ok(row!.approved_at);
  });

  it('refuses to approve the same request twice', async () => {
    const [booking] = await test.raw<{ id: string }>(
      `select id from public.bookings where status = 'approved' limit 1`,
    );

    await assert.rejects(
      test.asUser(corridor.ownerId, `select public.approve_booking($1)`, [booking!.id]),
      /no longer waiting/i,
    );
  });

  it('refuses to approve a request whose seat was taken while it waited', async () => {
    // Two seats per leg. One is approved above; this fills the second.
    const { bookingId: filler } = await bookingOn(test, corridor, 'Filler Rider');
    await test.asUser(corridor.ownerId, `select public.approve_booking($1)`, [filler]);

    // Now a hold that predates the fill: written directly, because
    // request_booking would have refused to create it.
    const late = await passenger(test, 'Late Decision');
    const [row] = await test.raw<{ id: string }>(
      `insert into public.bookings
         (departure_id, passenger_id, from_stop_id, to_stop_id, from_seq, to_seq, seats,
          status, hold_expires_at, base_cents, total_cents)
       values ($1, $2, $3, $4, 1, 4, 1, 'held', now() + interval '30 minutes', 4500, 4500)
       returning id`,
      [corridor.departureId, late, corridor.stops[0], corridor.stops[3]],
    );

    await assert.rejects(
      test.asUser(corridor.ownerId, `select public.approve_booking($1)`, [row!.id]),
      /taken while this request was waiting/i,
    );
  });

  it('declines a request and frees the seat immediately', async () => {
    // A departure of its own: the one above is deliberately full by now.
    const [other] = await test.raw<{ id: string }>(
      `select id from public.departures
        where operator_id = $1 and id <> $2 and service_date > current_date
        order by service_date limit 1`,
      [corridor.operatorId, corridor.departureId],
    );

    const rider = await passenger(test, 'Declined Rider');
    const bookingId = await requestSeat(test, rider, {
      departureId: other!.id,
      fromSeq: 1,
      toSeq: 2,
      stops: corridor.stops,
      seats: 2,
    });

    await test.asUser(corridor.ownerId, `select public.decline_booking($1)`, [bookingId]);
    assert.equal(await statusOf(test, bookingId), 'declined');

    const loads = await test.asAnon(
      `select leg_start from public.departure_leg_loads(array[$1]::uuid[])`,
      [other!.id],
    );
    assert.equal(loads.length, 0, 'a declined request holds nothing');
  });
});

describe('cancellation', () => {
  let test: TestDb;
  let corridor: Corridor;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test, { maxSeats: 4 });
  });

  after(async () => test.close());

  it('records who cancelled — the passenger', async () => {
    const { rider, bookingId } = await bookingOn(test, corridor, 'Changed Mind');
    await test.asUser(rider, `select public.cancel_booking($1)`, [bookingId]);
    assert.equal(await statusOf(test, bookingId), 'cancelled_by_passenger');
  });

  it('records who cancelled — the operator', async () => {
    const { bookingId } = await bookingOn(test, corridor, 'Operator Cancelled');
    await test.asUser(corridor.ownerId, `select public.cancel_booking($1)`, [bookingId]);
    assert.equal(await statusOf(test, bookingId), 'cancelled_by_operator');
  });

  it('frees the seat, and is free and unlimited', async () => {
    const loads = await test.asAnon<{ seats_taken: number }>(
      `select seats_taken from public.departure_leg_loads(array[$1]::uuid[])`,
      [corridor.departureId],
    );
    assert.equal(loads.length, 0, 'both cancellations released their seats');
  });

  it('refuses to cancel a booking that has already been cancelled', async () => {
    const [booking] = await test.raw<{ id: string; passenger_id: string }>(
      `select id, passenger_id from public.bookings where status = 'cancelled_by_passenger' limit 1`,
    );

    await assert.rejects(
      test.asUser(booking!.passenger_id, `select public.cancel_booking($1)`, [booking!.id]),
      /cannot be cancelled now/i,
    );
  });
});

describe('departure day', () => {
  let test: TestDb;
  let corridor: Corridor;
  let riderId: string;
  let bookingId: string;
  let vehicleId: string;
  let driverId: string;
  let unpaidBookingId: string;
  let absentBookingId: string;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test, { maxSeats: 6 });

    const booked = await bookingOn(test, corridor, 'Travelling Passenger');
    riderId = booked.rider;
    bookingId = booked.bookingId;
    await test.asUser(corridor.ownerId, `select public.approve_booking($1)`, [bookingId]);

    const [vehicle] = await test.asUser<{ id: string }>(
      corridor.ownerId,
      `insert into public.vehicles (operator_id, label, seat_count) values ($1, 'Grey Sienna', 7) returning id`,
      [corridor.operatorId],
    );
    vehicleId = vehicle!.id;

    driverId = await passenger(test, 'Sam Driver');
    await test.asUser(
      corridor.ownerId,
      `insert into public.operator_members (operator_id, user_id, role) values ($1, $2, 'driver')`,
      [corridor.operatorId, driverId],
    );

    await test.asUser(
      corridor.ownerId,
      `insert into public.departure_vehicles (departure_id, vehicle_id, driver_id) values ($1, $2, $3)`,
      [corridor.departureId, vehicleId, driverId],
    );

    // Everyone who is going has to be booked before the trip is closed off:
    // once a departure is completed, request_booking rightly refuses it.
    const unpaid = await bookingOn(test, corridor, 'Unpaid Rider');
    unpaidBookingId = unpaid.bookingId;
    await test.asUser(corridor.ownerId, `select public.approve_booking($1)`, [unpaidBookingId]);

    const absent = await bookingOn(test, corridor, 'Absent Rider');
    absentBookingId = absent.bookingId;
    await test.asUser(corridor.ownerId, `select public.approve_booking($1)`, [absentBookingId]);
  });

  after(async () => test.close());

  it('assigns a passenger to a vehicle that is actually on the trip', async () => {
    await test.asUser(corridor.ownerId, `select public.assign_booking_vehicle($1, $2)`, [
      bookingId,
      vehicleId,
    ]);

    const [row] = await test.raw<{ assigned_vehicle_id: string }>(
      `select assigned_vehicle_id from public.bookings where id = $1`,
      [bookingId],
    );
    assert.equal(row!.assigned_vehicle_id, vehicleId);
  });

  it('refuses a vehicle that is not on this departure', async () => {
    const [spare] = await test.asUser<{ id: string }>(
      corridor.ownerId,
      `insert into public.vehicles (operator_id, label, seat_count) values ($1, 'Spare Van', 7) returning id`,
      [corridor.operatorId],
    );

    await assert.rejects(
      test.asUser(corridor.ownerId, `select public.assign_booking_vehicle($1, $2)`, [
        bookingId,
        spare!.id,
      ]),
      /put that vehicle on this departure first/i,
    );
  });

  it('shows the assigned driver their own departure, and only that', async () => {
    const seen = await test.asUser<{ id: string; departure_id: string }>(
      driverId,
      `select id, departure_id from public.bookings`,
    );

    assert.ok(seen.some((row) => row.id === bookingId));
    assert.ok(
      seen.every((row) => row.departure_id === corridor.departureId),
      'a driver sees the departures they are driving, not the whole business',
    );

    // Being on the team is not enough: this driver is assigned to nothing.
    const spare = await passenger(test, 'Spare Driver');
    await test.asUser(
      corridor.ownerId,
      `insert into public.operator_members (operator_id, user_id, role) values ($1, $2, 'driver')`,
      [corridor.operatorId, spare],
    );
    const unassigned = await test.asUser(spare, `select id from public.bookings`);
    assert.equal(unassigned.length, 0);

    const stranger = await passenger(test, 'Not A Driver');
    const nothing = await test.asUser(stranger, `select id from public.bookings`);
    assert.equal(nothing.length, 0);
  });

  it('closes the trip and moves confirmed bookings to completed', async () => {
    const [closed] = await test.asUser<{ complete_departure: number }>(
      driverId,
      `select public.complete_departure($1)`,
      [corridor.departureId],
    );

    assert.equal(closed!.complete_departure, 3, 'every confirmed booking on the trip moves at once');
    assert.equal(await statusOf(test, bookingId), 'completed');
  });

  it('settles only when both sides say the same thing', async () => {
    await test.asUser(riderId, `select public.confirm_payment_as_passenger($1, 'cash')`, [
      bookingId,
    ]);
    assert.equal(await statusOf(test, bookingId), 'completed', 'one side is not agreement');

    await test.asUser(driverId, `select public.confirm_payment_as_driver($1, true)`, [bookingId]);
    assert.equal(await statusOf(test, bookingId), 'settled');

    const [row] = await test.raw<{ payment_method: string }>(
      `select payment_method from public.bookings where id = $1`,
      [bookingId],
    );
    assert.equal(row!.payment_method, 'cash');
  });

  it('raises a did_not_pay flag when the driver says the fare never arrived', async () => {
    await test.asUser(driverId, `select public.confirm_payment_as_driver($1, false)`, [
      unpaidBookingId,
    ]);

    const flags = await test.raw<{ reason: string }>(
      `select reason from public.red_flags where booking_id = $1`,
      [unpaidBookingId],
    );
    assert.deepEqual(
      flags.map((flag) => flag.reason),
      ['did_not_pay'],
    );

    assert.notEqual(await statusOf(test, unpaidBookingId), 'settled');
  });

  it('records a no-show as a red flag without anyone remembering to', async () => {
    await test.asUser(driverId, `select public.mark_no_show($1)`, [absentBookingId]);

    assert.equal(await statusOf(test, absentBookingId), 'no_show');

    const flags = await test.raw<{ reason: string }>(
      `select reason from public.red_flags where booking_id = $1`,
      [absentBookingId],
    );
    assert.deepEqual(
      flags.map((flag) => flag.reason),
      ['no_show'],
    );
  });

  it('shows the next operator that history, without naming the trip', async () => {
    const [row] = await test.asUser<{
      completed: number;
      no_shows: number;
      red_flags: number;
    }>(corridor.ownerId, `select * from public.passenger_history($1)`, [riderId]);

    assert.equal(row!.completed, 1, 'the settled trip counts as completed');
  });
});
