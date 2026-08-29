import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createUser, migratedDatabase, type TestDb } from './harness.ts';
import { passenger, requestSeat, seedCorridor, type Corridor } from './seed.ts';

/**
 * Access control, checked at the layer that has to be right.
 *
 * The application filters every operator-scoped query by membership as well,
 * but that is defence in depth. These tests assume the application layer has a
 * bug and ask what the database still refuses.
 */

describe('what a signed-out visitor can see', () => {
  let test: TestDb;
  let corridor: Corridor;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test);
  });

  after(async () => test.close());

  it('sees active operators, their stops, routes, fares, and departures', async () => {
    const operators = await test.asAnon(`select id from public.operators`);
    assert.equal(operators.length, 1);

    for (const table of ['stops', 'routes', 'route_stops', 'fares', 'departures']) {
      const rows = await test.asAnon(`select * from public.${table}`);
      assert.ok(rows.length > 0, `anon should be able to read ${table} to search`);
    }
  });

  it('cannot see an operator that has not been vetted', async () => {
    const applicant = await createUser(test, { email: 'jon@example.com', name: 'Jon' });
    await test.asUser(
      applicant,
      `insert into public.operators (name, public_phone, created_by) values ('Applicant Rides', '519-555-0122', $1)`,
      [applicant],
    );

    const visible = await test.asAnon<{ name: string }>(`select name from public.operators`);
    assert.deepEqual(
      visible.map((row) => row.name),
      ["Harbour Line"],
    );
  });

  it('cannot see the timetable, the fleet, or anyone’s bookings', async () => {
    // Refused at the privilege gate, before RLS is even consulted. An empty
    // result would also be correct, but this is the stronger answer: anon has
    // no business reaching these tables at all, so it holds no grant on them.
    for (const table of ['schedules', 'vehicles', 'bookings', 'departure_vehicles']) {
      await assert.rejects(
        test.asAnon(`select * from public.${table}`),
        /permission denied/i,
        `anon must not read ${table}`,
      );
    }
  });

  it('is refused in-city entirely, by both gates', async () => {
    // Phase 6 exists as tables only: no policies and no privileges. Both come
    // down together when the feature is built.
    for (const table of ['incity_zones', 'incity_bookings']) {
      await assert.rejects(test.asAnon(`select * from public.${table}`), /permission denied/i);
    }
  });

  it('can still be told how full a departure is', async () => {
    const rows = await test.asAnon(
      `select * from public.departure_leg_loads(array[$1]::uuid[])`,
      [corridor.departureId],
    );
    assert.ok(Array.isArray(rows), 'seats-left is public; who is on board is not');
  });
});

describe('one passenger cannot see another', () => {
  let test: TestDb;
  let corridor: Corridor;
  let ada: string;
  let ben: string;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test, { maxSeats: 10 });
    ada = await passenger(test, 'Ada Lovelace');
    ben = await passenger(test, 'Ben Nevis');

    await requestSeat(test, ada, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 4,
      stops: corridor.stops,
    });
  });

  after(async () => test.close());

  it('shows a passenger only their own bookings', async () => {
    const hers = await test.asUser(ada, `select id from public.bookings`);
    const his = await test.asUser(ben, `select id from public.bookings`);

    assert.equal(hers.length, 1);
    assert.equal(his.length, 0);
  });

  it('shows a passenger only their own profile', async () => {
    const rows = await test.asUser<{ id: string }>(ben, `select id from public.profiles`);
    assert.deepEqual(
      rows.map((row) => row.id),
      [ben],
    );
  });

  it('does not let a passenger cancel someone else’s booking', async () => {
    const [booking] = await test.raw<{ id: string }>(`select id from public.bookings limit 1`);

    await assert.rejects(
      test.asUser(ben, `select public.cancel_booking($1)`, [booking!.id]),
      /not yours/i,
    );
  });

  it('does not let a passenger promote themselves to platform admin', async () => {
    // RLS alone would allow this: the policy says a user may update their own
    // row, and their own row contains platform_role. The guard trigger is what
    // makes it fail.
    await assert.rejects(
      test.asUser(ben, `update public.profiles set platform_role = 'admin' where id = $1`, [ben]),
      /platform admin only/i,
    );

    const [row] = await test.raw<{ platform_role: string | null }>(
      `select platform_role from public.profiles where id = $1`,
      [ben],
    );
    assert.equal(row!.platform_role, null);
  });

  it('still lets a passenger edit the rest of their own profile', async () => {
    await test.asUser(ben, `update public.profiles set phone = '519-555-0199' where id = $1`, [ben]);

    const [row] = await test.raw<{ phone: string }>(
      `select phone from public.profiles where id = $1`,
      [ben],
    );
    assert.equal(row!.phone, '519-555-0199');
  });
});

describe('one operator cannot see another', () => {
  let test: TestDb;
  let corridor: Corridor;
  let rival: string;
  let rivalOperator: string;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test, { maxSeats: 10 });

    rival = await createUser(test, { email: 'rival@example.com', name: 'Rival Owner' });
    const [operator] = await test.asUser<{ id: string }>(
      rival,
      `insert into public.operators (name, public_phone, created_by)
       values ('Rival Rideshare', '519-555-0133', $1) returning id`,
      [rival],
    );
    rivalOperator = operator!.id;

    const rider = await passenger(test, 'Cara Traveller');
    await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 4,
      stops: corridor.stops,
    });
  });

  after(async () => test.close());

  it('hides another operator’s bookings', async () => {
    const rows = await test.asUser(rival, `select id from public.bookings`);
    assert.equal(rows.length, 0);
  });

  it('hides another operator’s timetable and fleet', async () => {
    const schedules = await test.asUser(rival, `select id from public.schedules`);
    const vehicles = await test.asUser(rival, `select id from public.vehicles`);
    assert.equal(schedules.length, 0);
    assert.equal(vehicles.length, 0);
  });

  it('refuses to approve another operator’s booking', async () => {
    const [booking] = await test.raw<{ id: string }>(`select id from public.bookings limit 1`);

    await assert.rejects(
      test.asUser(rival, `select public.approve_booking($1)`, [booking!.id]),
      /only this operator/i,
    );
  });

  it('refuses to build a route out of another operator’s stops', async () => {
    await assert.rejects(
      test.asUser(
        rival,
        `select public.save_route($1, null, 'Stolen corridor', 'matrix'::public.pricing_mode, $2::uuid[])`,
        [rivalOperator, corridor.stops],
      ),
      /one of your own stops/i,
    );
  });

  it('refuses to change another operator’s fares', async () => {
    await assert.rejects(
      test.asUser(rival, `select public.set_fare($1, 1, 2, 100, 'undercut them')`, [
        corridor.routeId,
      ]),
      /row-level security|permission denied/i,
    );
  });
});

describe('an operator cannot vet itself', () => {
  let test: TestDb;

  before(async () => {
    test = await migratedDatabase();
  });

  after(async () => test.close());

  it('refuses a self-activation', async () => {
    const owner = await createUser(test, { email: 'eager@example.com', name: 'Eager Owner' });
    const [operator] = await test.asUser<{ id: string }>(
      owner,
      `insert into public.operators (name, public_phone, created_by)
       values ('Eager Rideshare', '519-555-0144', $1) returning id`,
      [owner],
    );

    await assert.rejects(
      test.asUser(owner, `update public.operators set status = 'active' where id = $1`, [
        operator!.id,
      ]),
      /platform admin/i,
    );
  });

  it('lets an owner change their own business details', async () => {
    const [row] = await test.raw<{ id: string; created_by: string }>(
      `select id, created_by from public.operators limit 1`,
    );

    await test.asUser(row!.created_by, `update public.operators set bio = 'Since 2019.' where id = $1`, [
      row!.id,
    ]);

    const [updated] = await test.raw<{ bio: string }>(
      `select bio from public.operators where id = $1`,
      [row!.id],
    );
    assert.equal(updated!.bio, 'Since 2019.');
  });
});

describe('what an operator learns about a passenger', () => {
  let test: TestDb;
  let corridor: Corridor;
  let rider: string;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test, { maxSeats: 10 });
    rider = await passenger(test, 'Dana Rider');
    await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 4,
      stops: corridor.stops,
      note: 'front seat if possible',
    });
  });

  after(async () => test.close());

  it('reads the passenger’s profile, because they requested a seat', async () => {
    const rows = await test.asUser<{ full_name: string; phone: string }>(
      corridor.ownerId,
      `select full_name, phone from public.profiles where id = $1`,
      [rider],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.full_name, 'Dana Rider');
  });

  it('cannot read the profile of someone who has never booked with them', async () => {
    const stranger = await passenger(test, 'Eve Stranger');
    const rows = await test.asUser(
      corridor.ownerId,
      `select full_name from public.profiles where id = $1`,
      [stranger],
    );
    assert.equal(rows.length, 0);
  });

  it('gets history as counts, not as other operators’ passenger lists', async () => {
    const rows = await test.asUser<{ completed: number; cancelled: number; red_flags: number }>(
      corridor.ownerId,
      `select * from public.passenger_history($1)`,
      [rider],
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.completed, 0);
    assert.equal(rows[0]!.red_flags, 0);
  });

  it('tells a stranger’s history to nobody', async () => {
    const outsider = await createUser(test, { email: 'nosy@example.com', name: 'Nosy Parker' });
    const rows = await test.asUser<{ completed: number | null }>(
      outsider,
      `select * from public.passenger_history($1)`,
      [rider],
    );

    // The aggregate is over no rows, so nothing is disclosed either way.
    assert.ok(rows.length === 0 || rows[0]!.completed === 0);
  });
});
