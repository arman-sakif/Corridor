import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { migratedDatabase, type TestDb } from './harness.ts';
import { passenger, requestSeat, seedCorridor, type Corridor } from './seed.ts';

/**
 * The four hard rules, tested against a real Postgres.
 *
 * These run the actual migration files, so `request_booking()` here is the
 * same function that will run in Supabase. Everything the TypeScript unit
 * tests assert about capacity and fares is asserted again on the side that
 * actually enforces it.
 */

async function fresh(options?: Parameters<typeof seedCorridor>[1]) {
  const test = await migratedDatabase();
  const corridor = await seedCorridor(test, options);
  return { test, corridor };
}

/** Windsor(1) → Chatham(2) → London(3) → Yorkdale(4), 4 seats per leg. */
describe('per-leg capacity', () => {
  let test: TestDb;
  let corridor: Corridor;

  before(async () => {
    ({ test, corridor } = await fresh({ maxSeats: 4 }));
  });

  after(async () => test.close());

  it('lets three disjoint legs carry twelve seats on a four-seat departure', async () => {
    const legs: [number, number][] = [
      [1, 2],
      [2, 3],
      [3, 4],
    ];

    for (const [index, [fromSeq, toSeq]] of legs.entries()) {
      const rider = await passenger(test, `Disjoint ${index}`);
      await requestSeat(test, rider, {
        departureId: corridor.departureId,
        fromSeq,
        toSeq,
        stops: corridor.stops,
        seats: 4,
      });
    }

    const [totals] = await test.raw<{ total: number }>(
      `select coalesce(sum(seats), 0)::int as total from public.bookings where departure_id = $1`,
      [corridor.departureId],
    );

    // Twelve seats sold on a four-seat departure, and every one of them legal.
    assert.equal(totals!.total, 12);
  });

  it('refuses a booking that would oversell a leg already full', async () => {
    const rider = await passenger(test, 'One Too Many');

    await assert.rejects(
      requestSeat(test, rider, {
        departureId: corridor.departureId,
        fromSeq: 1,
        toSeq: 2,
        stops: corridor.stops,
        seats: 1,
      }),
      /not enough seats/i,
    );
  });

  it('refuses a long booking when only one leg it spans is full', async () => {
    // Legs 1 and 3 are full from the first test; a 1→4 booking crosses them.
    const rider = await passenger(test, 'Long Haul');

    await assert.rejects(
      requestSeat(test, rider, {
        departureId: corridor.departureId,
        fromSeq: 1,
        toSeq: 4,
        stops: corridor.stops,
        seats: 1,
      }),
      /not enough seats/i,
    );
  });

  it('reports the load leg by leg', async () => {
    const loads = await test.asAnon<{ leg_start: number; seats_taken: number }>(
      `select leg_start, seats_taken from public.departure_leg_loads(array[$1]::uuid[]) order by leg_start`,
      [corridor.departureId],
    );

    assert.deepEqual(
      loads.map((load) => [load.leg_start, load.seats_taken]),
      [
        [1, 4],
        [2, 4],
        [3, 4],
      ],
    );
  });
});

describe('holds expire without a cron', () => {
  let test: TestDb;
  let corridor: Corridor;

  before(async () => {
    ({ test, corridor } = await fresh({ maxSeats: 1 }));
  });

  after(async () => test.close());

  it('holds a seat for an hour, and never past the departure', async () => {
    const rider = await passenger(test, 'Holder');
    const bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 4,
      stops: corridor.stops,
    });

    const [row] = await test.raw<{ within_the_hour: boolean; before_departure: boolean }>(
      `select
         hold_expires_at <= now() + interval '1 hour' + interval '5 seconds' as within_the_hour,
         hold_expires_at <= public.toronto_instant(d.service_date, d.departure_time) as before_departure
       from public.bookings b join public.departures d on d.id = b.departure_id
       where b.id = $1`,
      [bookingId],
    );

    assert.equal(row!.within_the_hour, true);
    assert.equal(row!.before_departure, true);
  });

  it('blocks the seat while the hold is live', async () => {
    const other = await passenger(test, 'Blocked');

    await assert.rejects(
      requestSeat(test, other, {
        departureId: corridor.departureId,
        fromSeq: 1,
        toSeq: 4,
        stops: corridor.stops,
      }),
      /not enough seats/i,
    );
  });

  it('frees the seat the instant the hold lapses, with no job having run', async () => {
    // Wind the clock back on the hold. Nothing else changes: the status stays
    // 'held', and no sweep runs.
    await test.raw(
      `update public.bookings set hold_expires_at = now() - interval '1 minute' where status = 'held'`,
    );

    const [held] = await test.raw<{ still_held: number }>(
      `select count(*)::int as still_held from public.bookings where status = 'held'`,
    );
    assert.equal(held!.still_held, 1, 'the row is still labelled held');

    const rider = await passenger(test, 'Second Chance');
    const bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 4,
      stops: corridor.stops,
    });

    assert.ok(bookingId, 'the lapsed hold no longer occupies the seat');
  });

  it('relabels lapsed holds when the sweep does run, without changing capacity', async () => {
    const [swept] = await test.raw<{ expire_stale_holds: number }>(
      `select public.expire_stale_holds()`,
    );
    assert.equal(swept!.expire_stale_holds, 1);

    const [relabelled] = await test.raw<{ expired: number }>(
      `select count(*)::int as expired from public.bookings where status = 'expired'`,
    );
    assert.equal(relabelled!.expired, 1);
  });
});

describe('fares are recomputed server-side', () => {
  it('charges the operator’s through fare, not the sum of the legs', async () => {
    const { test, corridor } = await fresh({ maxSeats: 10 });
    const rider = await passenger(test, 'Matrix Rider');

    const bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 4,
      stops: corridor.stops,
      seats: 2,
    });

    const [row] = await test.raw<{ base_cents: number; total_cents: number }>(
      `select base_cents, total_cents from public.bookings where id = $1`,
      [bookingId],
    );

    // $45 a seat, not the $65 the three legs add up to.
    assert.equal(row!.base_cents, 9000);
    assert.equal(row!.total_cents, 9000);

    await test.close();
  });

  it('adds the legs up on an additive route', async () => {
    const { test, corridor } = await fresh({ maxSeats: 10, pricingMode: 'additive' });
    const rider = await passenger(test, 'Additive Rider');

    const bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 4,
      stops: corridor.stops,
    });

    const [row] = await test.raw<{ base_cents: number }>(
      `select base_cents from public.bookings where id = $1`,
      [bookingId],
    );

    assert.equal(row!.base_cents, 6500);
    await test.close();
  });

  it('refuses a pair of stops the operator has not priced', async () => {
    const { test, corridor } = await fresh({ maxSeats: 10 });
    await test.raw(`delete from public.fares where route_id = $1 and from_seq = 1 and to_seq = 4`, [
      corridor.routeId,
    ]);

    const rider = await passenger(test, 'Unpriced');

    await assert.rejects(
      requestSeat(test, rider, {
        departureId: corridor.departureId,
        fromSeq: 1,
        toSeq: 4,
        stops: corridor.stops,
      }),
      /does not sell/i,
    );

    await test.close();
  });

  it('refuses a journey against the direction of the route', async () => {
    const { test, corridor } = await fresh({ maxSeats: 10 });
    const rider = await passenger(test, 'Backwards');

    await assert.rejects(
      requestSeat(test, rider, {
        departureId: corridor.departureId,
        fromSeq: 4,
        toSeq: 1,
        stops: corridor.stops,
      }),
      /other way/i,
    );

    await test.close();
  });

  it('records every price change with its reason, and nothing when the price is unchanged', async () => {
    const { test, corridor } = await fresh();

    await test.asUser(corridor.ownerId, `select public.set_fare($1, 1, 4, 5000, 'fuel prices')`, [
      corridor.routeId,
    ]);
    await test.asUser(corridor.ownerId, `select public.set_fare($1, 1, 4, 5000, 'fuel prices')`, [
      corridor.routeId,
    ]);

    const changes = await test.raw<{ old_price_cents: number | null; new_price_cents: number; reason: string }>(
      `select old_price_cents, new_price_cents, reason from public.fare_changes
        where route_id = $1 and from_seq = 1 and to_seq = 4 order by created_at`,
      [corridor.routeId],
    );

    assert.equal(changes.length, 2, 'the initial price and one change — not the no-op');
    assert.equal(changes[1]!.old_price_cents, 4500);
    assert.equal(changes[1]!.new_price_cents, 5000);
    assert.equal(changes[1]!.reason, 'fuel prices');

    await assert.rejects(
      test.asUser(corridor.ownerId, `select public.set_fare($1, 1, 4, 5500, '  ')`, [
        corridor.routeId,
      ]),
      /needs a reason/i,
    );

    await test.close();
  });
});

describe('departures snapshot their capacity', () => {
  it('does not change a departure already on sale when the schedule changes', async () => {
    const { test, corridor } = await fresh({ maxSeats: 4 });

    await test.asUser(corridor.ownerId, `update public.schedules set max_seats = 40 where id = $1`, [
      corridor.scheduleId,
    ]);
    await test.asUser(corridor.ownerId, `select public.generate_departures($1, 30)`, [
      corridor.operatorId,
    ]);

    const [row] = await test.raw<{ max_seats: number }>(
      `select max_seats from public.departures where id = $1`,
      [corridor.departureId],
    );

    assert.equal(row!.max_seats, 4, 'the snapshot is what the departure was sold against');
    await test.close();
  });

  it('generates the window idempotently', async () => {
    const { test, corridor } = await fresh();

    const [beforeRun] = await test.raw<{ count: number }>(
      `select count(*)::int as count from public.departures where operator_id = $1`,
      [corridor.operatorId],
    );

    const [run] = await test.asUser<{ generate_departures: number }>(
      corridor.ownerId,
      `select public.generate_departures($1, 30)`,
      [corridor.operatorId],
    );

    const [afterRun] = await test.raw<{ count: number }>(
      `select count(*)::int as count from public.departures where operator_id = $1`,
      [corridor.operatorId],
    );

    assert.equal(run!.generate_departures, 0, 're-running creates nothing');
    assert.equal(afterRun!.count, beforeRun!.count);
    await test.close();
  });
});
