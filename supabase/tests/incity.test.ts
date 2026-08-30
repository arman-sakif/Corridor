import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { createUser, migratedDatabase, type TestDb } from './harness.ts';
import { passenger, requestSeat, seedCorridor, type Corridor } from './seed.ts';

/**
 * The in-city add-on.
 *
 * The one function worth this much attention is `request_incity_ride()`.
 * Nothing in the schema ties the zone, the pickup stop and the selling
 * operator together, and nothing stops a passenger attaching a ride to
 * somebody else's booking — every one of those is checked in the function, so
 * every one of them is checked here.
 */

describe('in-city rides', () => {
  let test: TestDb;
  let corridor: Corridor;

  let rider: string;
  let bookingId: string;

  let incityOwner: string;
  let incityOperator: string;
  let pickupStop: string;
  let zone: string;

  /** A second in-city operator, to prove the parts cannot be mixed. */
  let rivalOperator: string;
  let rivalZone: string;
  let rivalStop: string;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test);

    incityOwner = await createUser(test, { email: 'grace@example.com', name: 'Grace' });

    [incityOperator, rivalOperator] = await Promise.all([
      makeIncityOperator(incityOwner, 'Station Link'),
      makeIncityOperator(incityOwner, 'Rival Local'),
    ]);

    // The drop-off city of the corridor's last stop is where the local
    // operator has to be, so put its pickup point there.
    const dropCity = corridor.cities[corridor.cities.length - 1]!;

    pickupStop = await makeStop(incityOperator, dropCity, 'Yorkdale Mall');
    rivalStop = await makeStop(rivalOperator, dropCity, 'Rival Kerb');

    // A stop in the wrong city, for the check that matters most.
    zone = await makeZone(incityOperator, 'Downtown Toronto', 2200);
    rivalZone = await makeZone(rivalOperator, 'Downtown Toronto', 9900);
  });

  after(async () => test.close());

  beforeEach(async () => {
    // A fresh approved booking per test, so the one-live-ride index does not
    // make these depend on each other's order.
    rider = await passenger(test, `Rider ${Math.random().toString(36).slice(2, 8)}`);
    bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: corridor.stops.length,
      stops: corridor.stops,
    });
    await test.asUser(corridor.ownerId, `select public.approve_booking($1)`, [bookingId]);
  });

  afterEach(async () => {
    // Give the seat back. Every test books the full length of the route, and
    // the departure holds a finite number of them — without this the suite
    // runs out of capacity partway through and reports a per-leg error from
    // request_booking() that has nothing to do with what is being tested.
    await test
      .asUser(rider, `select public.cancel_booking($1)`, [bookingId])
      .catch(() => {});
  });

  async function makeIncityOperator(owner: string, name: string): Promise<string> {
    const [row] = await test.raw<{ id: string }>(
      `insert into public.operators (name, type, public_phone, status, created_by)
       values ($1, 'incity', '416-555-0129', 'active', $2) returning id`,
      [name, owner],
    );
    return row!.id;
  }

  async function makeStop(operatorId: string, cityId: string, label: string): Promise<string> {
    const [row] = await test.raw<{ id: string }>(
      `insert into public.stops (operator_id, city_id, label, is_active)
       values ($1, $2, $3, true) returning id`,
      [operatorId, cityId, label],
    );
    return row!.id;
  }

  async function makeZone(operatorId: string, name: string, cents: number): Promise<string> {
    const [row] = await test.raw<{ id: string }>(
      `insert into public.incity_zones (operator_id, name, flat_price_cents)
       values ($1, $2, $3) returning id`,
      [operatorId, name, cents],
    );
    return row!.id;
  }

  function request(
    userId: string,
    overrides: Partial<{
      booking: string;
      operator: string;
      stop: string;
      zone: string;
      address: string;
    }> = {},
  ) {
    return test.asUser<{ request_incity_ride: string }>(
      userId,
      `select public.request_incity_ride($1, $2, $3, $4, $5)`,
      [
        overrides.booking ?? bookingId,
        overrides.operator ?? incityOperator,
        overrides.stop ?? pickupStop,
        overrides.zone ?? zone,
        overrides.address ?? '12 Elm Street, Apt 4',
      ],
    );
  }

  it('books a local ride at the zone’s price, not the caller’s', async () => {
    const [row] = await request(rider);

    const [ride] = await test.raw<{ price_cents: number; status: string }>(
      `select price_cents, status from public.incity_bookings where id = $1`,
      [row!.request_incity_ride],
    );

    // The caller never supplies a price — there is no parameter for one, which
    // is the same stance request_booking() takes.
    assert.equal(ride!.price_cents, 2200);
    assert.equal(ride!.status, 'held');
  });

  it('refuses to attach a ride to somebody else’s booking', async () => {
    const stranger = await passenger(test, 'Nosy Stranger');
    await assert.rejects(request(stranger), /not yours/i);
  });

  it('refuses until the seat itself is confirmed', async () => {
    const waiting = await passenger(test, 'Still Waiting');
    const held = await requestSeat(test, waiting, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 2,
      stops: corridor.stops,
    });

    await assert.rejects(
      request(waiting, { booking: held }),
      /seat has to be confirmed/i,
    );
  });

  it('refuses a zone belonging to a different operator', async () => {
    // The $99 zone next door must not be bookable through this operator, and
    // the reverse pairing must not quietly charge the wrong price either.
    await assert.rejects(request(rider, { zone: rivalZone }), /not one this operator covers/i);
  });

  it('refuses a pickup point belonging to a different operator', async () => {
    await assert.rejects(request(rider, { stop: rivalStop }), /not one this operator uses/i);
  });

  it('refuses a pickup point in a city the passenger is not arriving in', async () => {
    const elsewhere = corridor.cities[0]!;
    const wrongCity = await makeStop(incityOperator, elsewhere, 'Windsor Kerb');

    await assert.rejects(
      request(rider, { stop: wrongCity }),
      /not in the city you are arriving in/i,
    );
  });

  it('refuses an empty destination', async () => {
    await assert.rejects(request(rider, { address: '   ' }), /where you are going/i);
  });

  it('allows only one live ride per booking', async () => {
    await request(rider);
    await assert.rejects(request(rider), /already have a local ride/i);
  });

  it('lets the selling operator confirm it, and nobody else', async () => {
    const [row] = await request(rider);
    const id = row!.request_incity_ride;

    await assert.rejects(
      test.asUser(rider, `select public.approve_incity_ride($1)`, [id]),
      /only this operator/i,
    );
    await assert.rejects(
      test.asUser(corridor.ownerId, `select public.approve_incity_ride($1)`, [id]),
      /only this operator/i,
    );

    await test.asUser(incityOwner, `select public.approve_incity_ride($1)`, [id]);

    const [ride] = await test.raw<{ status: string }>(
      `select status from public.incity_bookings where id = $1`,
      [id],
    );
    assert.equal(ride!.status, 'approved');
  });

  it('cancels the local ride when the seat behind it goes away', async () => {
    const [row] = await request(rider);
    const id = row!.request_incity_ride;
    await test.asUser(incityOwner, `select public.approve_incity_ride($1)`, [id]);

    // The passenger drops the trip entirely.
    await test.asUser(rider, `select public.cancel_booking($1)`, [bookingId]);

    const [ride] = await test.raw<{ status: string }>(
      `select status from public.incity_bookings where id = $1`,
      [id],
    );
    assert.equal(
      ride!.status,
      'cancelled',
      'a confirmed connection to a trip nobody is on is worse than none',
    );
  });

  it('shows the ride to the passenger and the selling operator, and no one else', async () => {
    const [row] = await request(rider);
    const id = row!.request_incity_ride;

    // The rider is fresh in each test, so this really is all of theirs.
    const mine = await test.asUser<{ id: string }>(rider, `select id from public.incity_bookings`);
    assert.deepEqual(mine, [{ id }]);

    // The in-city owner sees every ride they have sold, including ones earlier
    // tests left behind — so check this one is among them rather than alone.
    const theirs = await test.asUser<{ id: string }>(
      incityOwner,
      `select id from public.incity_bookings`,
    );
    assert.ok(
      theirs.some((sold) => sold.id === id),
      'the selling operator must see the ride they were asked to make',
    );

    // The intercity operator sold the seat, not the local ride. The address is
    // not theirs to read.
    const seller = await test.asUser(corridor.ownerId, `select id from public.incity_bookings`);
    assert.deepEqual(seller, []);
  });

  it('is read-only to the API, so a price cannot be edited after the fact', async () => {
    const [row] = await request(rider);

    await assert.rejects(
      test.asUser(
        rider,
        `update public.incity_bookings set price_cents = 0 where id = $1`,
        [row!.request_incity_ride],
      ),
      /permission denied/i,
    );
  });
});
