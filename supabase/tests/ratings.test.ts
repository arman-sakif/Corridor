import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createUser, migratedDatabase, type TestDb } from './harness.ts';
import { passenger, requestSeat, seedCorridor, type Corridor } from './seed.ts';

/**
 * Ratings, in both directions.
 *
 * `operator_to_passenger` existed in the enum from the first migration and was
 * never written. Wiring it meant tightening the insert policy it would have
 * shared, which was loose enough that any signed-in user could write a rating
 * about any booking for any operator — most of these tests are that policy.
 */

describe('ratings', () => {
  let test: TestDb;
  let corridor: Corridor;

  let rider: string;
  let stranger: string;
  let bookingId: string;
  let driver: string;
  let rivalOwner: string;
  let rivalOperator: string;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test);

    rivalOwner = await createUser(test, { email: 'rival@example.com', name: 'Rival Owner' });
    const [rival] = await test.raw<{ id: string }>(
      `insert into public.operators (name, public_phone, status, created_by)
       values ('Rival Rideshare', '519-555-0188', 'active', $1) returning id`,
      [rivalOwner],
    );
    rivalOperator = rival!.id;

    const [vehicle] = await test.asUser<{ id: string }>(
      corridor.ownerId,
      `insert into public.vehicles (operator_id, label, seat_count) values ($1, 'Van', 7) returning id`,
      [corridor.operatorId],
    );
    driver = await passenger(test, 'Sam Driver');
    await test.asUser(
      corridor.ownerId,
      `insert into public.operator_members (operator_id, user_id, role) values ($1, $2, 'driver')`,
      [corridor.operatorId, driver],
    );
    await test.asUser(
      corridor.ownerId,
      `insert into public.departure_vehicles (departure_id, vehicle_id, driver_id) values ($1, $2, $3)`,
      [corridor.departureId, vehicle!.id, driver],
    );

    rider = await passenger(test, 'Ada Rider');
    stranger = await passenger(test, 'Someone Else');

    bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: corridor.stops.length,
      stops: corridor.stops,
    });
    await test.asUser(corridor.ownerId, `select public.approve_booking($1)`, [bookingId]);
    await test.raw(`update public.bookings set status = 'completed' where id = $1`, [bookingId]);
  });

  after(async () => test.close());

  /* ------------------------------------------------ operator → passenger */

  it('lets the operator rate a passenger once the trip has run', async () => {
    const [row] = await test.asUser<{ rate_passenger: string }>(
      corridor.ownerId,
      `select public.rate_passenger($1, 5, 'Ready at the kerb, no fuss.')`,
      [bookingId],
    );

    const [rating] = await test.raw<{ direction: string; score: number; passenger_id: string }>(
      `select direction, score, passenger_id from public.ratings where id = $1`,
      [row!.rate_passenger],
    );

    assert.equal(rating!.direction, 'operator_to_passenger');
    assert.equal(rating!.score, 5);
    assert.equal(rating!.passenger_id, rider, 'the subject comes from the booking, not the caller');
  });

  it('refuses a second rating of the same booking', async () => {
    await assert.rejects(
      test.asUser(corridor.ownerId, `select public.rate_passenger($1, 1, null)`, [bookingId]),
      /already rated/i,
    );
  });

  it('refuses a score outside 1 to 5', async () => {
    const other = await freshCompletedBooking('Range Rider');
    for (const score of [0, 6, -1]) {
      await assert.rejects(
        test.asUser(corridor.ownerId, `select public.rate_passenger($1, $2, null)`, [other, score]),
        /1 to 5/i,
      );
    }
  });

  it('refuses a trip that has not run', async () => {
    const waiting = await passenger(test, 'Still Waiting');
    const held = await requestSeat(test, waiting, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 2,
      stops: corridor.stops,
    });

    await assert.rejects(
      test.asUser(corridor.ownerId, `select public.rate_passenger($1, 5, null)`, [held]),
      /once the trip has run/i,
    );
  });

  it('lets the assigned driver rate, and refuses everyone else', async () => {
    const forDriver = await freshCompletedBooking('Driver Rated');
    const rows = await test.asUser(driver, `select public.rate_passenger($1, 4, 'Fine.')`, [
      forDriver,
    ]);
    assert.equal(rows.length, 1);

    const forStranger = await freshCompletedBooking('Not Yours');
    for (const who of [rivalOwner, stranger]) {
      await assert.rejects(
        test.asUser(who, `select public.rate_passenger($1, 5, null)`, [forStranger]),
        /only this operator/i,
      );
    }
  });

  /* --------------------------------------------------- who may read one */

  it('does not show a passenger what an operator said about them', async () => {
    // The same stance as a red flag: the point is a signal between operators,
    // and a rater who knows the subject is reading is a less honest rater.
    const theirs = await test.asUser<{ direction: string }>(
      rider,
      `select direction from public.ratings where passenger_id = $1`,
      [rider],
    );

    assert.deepEqual(
      theirs.map((r) => r.direction),
      [],
      'a passenger sees no rating written about them',
    );

    const operatorSees = await test.asUser(
      corridor.ownerId,
      `select id from public.ratings where direction = 'operator_to_passenger'`,
    );
    assert.ok(operatorSees.length > 0, 'the operator that wrote it can read it');
  });

  /* ------------------------------------------------ passenger → operator */

  it('lets a passenger rate the operator that actually carried them', async () => {
    const rows = await test.asUser(
      rider,
      `insert into public.ratings (booking_id, direction, rater_id, operator_id, passenger_id, score, comment)
       values ($1, 'passenger_to_operator', $2, $3, $2, 5, 'On time.') returning id`,
      [bookingId, rider, corridor.operatorId],
    );
    assert.equal(rows.length, 1);
  });

  it('refuses a rating of an operator that did not carry them', async () => {
    // The old policy checked only `rater_id = auth.uid()`, so this worked.
    const other = await freshCompletedBooking('Wrong Operator');
    await assert.rejects(
      test.asUser(
        rider,
        `insert into public.ratings (booking_id, direction, rater_id, operator_id, passenger_id, score)
         values ($1, 'passenger_to_operator', $2, $3, $2, 1)`,
        [other, rider, rivalOperator],
      ),
      /row-level security/i,
    );
  });

  it('refuses a rating of somebody else’s booking', async () => {
    await assert.rejects(
      test.asUser(
        stranger,
        `insert into public.ratings (booking_id, direction, rater_id, operator_id, passenger_id, score)
         values ($1, 'passenger_to_operator', $2, $3, $2, 1)`,
        [bookingId, stranger, corridor.operatorId],
      ),
      /row-level security/i,
    );
  });

  it('refuses a passenger writing in the operator’s direction', async () => {
    const other = await freshCompletedBooking('Direction Faker');
    await assert.rejects(
      test.asUser(
        rider,
        `insert into public.ratings (booking_id, direction, rater_id, operator_id, passenger_id, score)
         values ($1, 'operator_to_passenger', $2, $3, $2, 5)`,
        [other, rider, corridor.operatorId],
      ),
      /row-level security/i,
    );
  });

  /* ----------------------------------------------------------- history */

  it('reports the average where the approval decision is made', async () => {
    const [history] = await test.asUser<{ rating_avg: string | null; rating_count: number }>(
      corridor.ownerId,
      `select rating_avg, rating_count from public.passenger_history($1)`,
      [rider],
    );

    assert.equal(Number(history!.rating_avg), 5);
    assert.equal(history!.rating_count, 1);
  });

  it('still tells a stranger nothing, not even zeroes', async () => {
    const rows = await test.asUser(rivalOwner, `select * from public.passenger_history($1)`, [
      rider,
    ]);
    assert.deepEqual(rows, [], 'no row at all is a different claim from zero');
  });

  /**
   * A completed booking for a brand-new passenger, so each test starts clean.
   *
   * Written directly rather than through `request_booking()`: a completed
   * booking still occupies its leg, so going through the front door would
   * exhaust the departure part-way down this file and fail these tests with a
   * capacity error that has nothing to do with ratings. The seeder writes
   * bookings the same way, for the same reason.
   */
  async function freshCompletedBooking(name: string): Promise<string> {
    const who = await passenger(test, `${name} ${Math.random().toString(36).slice(2, 7)}`);

    const [booking] = await test.raw<{ id: string }>(
      `insert into public.bookings
         (departure_id, passenger_id, from_stop_id, to_stop_id, from_seq, to_seq,
          seats, status, base_cents, total_cents)
       values ($1, $2, $3, $4, 1, 2, 1, 'completed', 1000, 1000)
       returning id`,
      [corridor.departureId, who, corridor.stops[0], corridor.stops[1]],
    );

    return booking!.id;
  }
});
