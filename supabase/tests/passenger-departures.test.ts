import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { migratedDatabase, type TestDb } from './harness.ts';
import { passenger, requestSeat, seedCorridor, type Corridor } from './seed.ts';

/**
 * A passenger keeps sight of a departure they booked after it has run.
 *
 * Search only shows scheduled departures, and until `20260830000028` that was
 * the only way a passenger could see one — so every finished trip lost its
 * date on My rides, and ride history could not find past rides at all.
 */

describe('a passenger and the departures they booked', () => {
  let test: TestDb;
  let corridor: Corridor;
  let rider: string;
  let stranger: string;
  let bookingId: string;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test);

    rider = await passenger(test, 'Past Rider');
    stranger = await passenger(test, 'Never Booked');

    bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: corridor.stops.length,
      stops: corridor.stops,
    });
    await test.asUser(corridor.ownerId, `select public.approve_booking($1)`, [bookingId]);

    // A driver and a van on it, so "sees nothing of who drives" means something.
    const [vehicle] = await test.asUser<{ id: string }>(
      corridor.ownerId,
      `insert into public.vehicles (operator_id, label, seat_count) values ($1, 'Van', 7) returning id`,
      [corridor.operatorId],
    );
    await test.asUser(
      corridor.ownerId,
      `insert into public.departure_vehicles (departure_id, vehicle_id) values ($1, $2)`,
      [corridor.departureId, vehicle!.id],
    );

    // The trip runs. From here, search no longer shows this departure.
    await test.raw(`update public.bookings set status = 'completed' where id = $1`, [bookingId]);
    await test.raw(`update public.departures set status = 'completed' where id = $1`, [
      corridor.departureId,
    ]);
  });

  after(async () => test.close());

  it('still sees a departure they booked once it has run', async () => {
    const seen = await test.asUser(rider, `select id from public.departures where id = $1`, [
      corridor.departureId,
    ]);
    assert.equal(seen.length, 1);
  });

  it('reaches it through their booking, the way My rides embeds it', async () => {
    const [row] = await test.asUser<{ service_date: string | null }>(
      rider,
      `select d.service_date::text
         from public.bookings b
         left join public.departures d on d.id = b.departure_id
        where b.id = $1`,
      [bookingId],
    );
    assert.ok(row?.service_date, 'the departure date comes back, not null');
  });

  it('does not show a finished departure to someone who never booked it', async () => {
    const seen = await test.asUser(stranger, `select id from public.departures where id = $1`, [
      corridor.departureId,
    ]);
    assert.deepEqual(seen, []);
  });

  it('shows nothing of the vehicle or driver on it', async () => {
    const vans = await test.asUser(
      rider,
      `select id from public.departure_vehicles where departure_id = $1`,
      [corridor.departureId],
    );
    assert.deepEqual(vans, [], 'a passenger never sees the assignment');
  });
});
