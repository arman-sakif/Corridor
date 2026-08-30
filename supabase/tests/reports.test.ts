import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createUser, migratedDatabase, type TestDb } from './harness.ts';
import { passenger, requestSeat, seedCorridor, type Corridor } from './seed.ts';

/**
 * Complaints, feedback, and the driver's half of a red flag.
 *
 * These are the first channels in the product that carry an accusation, so the
 * questions worth asking are about who may make one, who may read it, and who
 * may close it — not whether the insert works.
 */

describe('reports', () => {
  let test: TestDb;
  let corridor: Corridor;

  let rider: string;
  let bookingId: string;
  let admin: string;
  let rivalOwner: string;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test);

    admin = await createUser(test, { email: 'admin@example.com', name: 'Platform Admin' });
    await test.raw(`update public.profiles set platform_role = 'admin' where id = $1`, [admin]);

    rivalOwner = await createUser(test, { email: 'rival@example.com', name: 'Rival Owner' });
    // Service role for setup: an operator cannot vet itself into `active`, and
    // that refusal has its own test elsewhere. The id is not captured because
    // the insert alone is what makes rivalOwner an owner, through the
    // attach_operator_owner trigger.
    await test.raw(
      `insert into public.operators (name, public_phone, status, created_by)
       values ('Rival Rideshare', '519-555-0188', 'active', $1) returning id`,
      [rivalOwner],
    );

    rider = await passenger(test, 'Ada Rider');
    bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: corridor.stops.length,
      stops: corridor.stops,
    });
    await test.asUser(corridor.ownerId, `select public.approve_booking($1)`, [bookingId]);
  });

  after(async () => test.close());

  function file(userId: string, booking = bookingId, note = 'The driver was on the phone throughout.') {
    return test.asUser<{ file_report: string }>(
      userId,
      `select public.file_report($1, 'driving', $2)`,
      [booking, note],
    );
  }

  it('lets a passenger report their own confirmed trip', async () => {
    const [row] = await file(rider);

    const [report] = await test.raw<{ operator_id: string; status: string; note: string }>(
      `select operator_id, status, note from public.reports where id = $1`,
      [row!.file_report],
    );

    // The operator is resolved from the departure, not taken from the caller —
    // there is no parameter for it.
    assert.equal(report!.operator_id, corridor.operatorId);
    assert.equal(report!.status, 'open');
    assert.equal(report!.note, 'The driver was on the phone throughout.');
  });

  it('refuses a report on somebody else’s booking', async () => {
    const stranger = await passenger(test, 'Nosy Stranger');
    await assert.rejects(file(stranger), /not yours to report/i);
  });

  it('refuses a report on a trip that was never confirmed', async () => {
    const waiting = await passenger(test, 'Held Rider');
    const held = await requestSeat(test, waiting, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 2,
      stops: corridor.stops,
    });

    await assert.rejects(file(waiting, held), /once it has been confirmed/i);
  });

  it('refuses an empty complaint', async () => {
    await assert.rejects(file(rider, bookingId, '   '), /what happened/i);
  });

  it('shows it to the reporter, the operator and an admin — and nobody else', async () => {
    const [row] = await file(rider);
    const id = row!.file_report;

    for (const [who, label] of [
      [rider, 'the passenger who complained'],
      [corridor.ownerId, 'the operator complained about'],
      [admin, 'a platform admin'],
    ] as const) {
      const seen = await test.asUser<{ id: string }>(
        who,
        `select id from public.reports where id = $1`,
        [id],
      );
      assert.equal(seen.length, 1, `${label} must see it`);
    }

    const rivalSees = await test.asUser(rivalOwner, `select id from public.reports`);
    assert.deepEqual(rivalSees, [], 'an unrelated operator must see nothing');
  });

  it('is closed by the operator or an admin, and by nobody else', async () => {
    const [row] = await file(rider);
    const id = row!.file_report;

    await assert.rejects(
      test.asUser(rider, `select public.resolve_report($1, 'nothing to see')`, [id]),
      /not yours to close/i,
    );
    await assert.rejects(
      test.asUser(rivalOwner, `select public.resolve_report($1, 'not mine')`, [id]),
      /not yours to close/i,
    );

    await test.asUser(corridor.ownerId, `select public.resolve_report($1, 'Spoke to the driver.')`, [
      id,
    ]);

    const [report] = await test.raw<{
      status: string;
      resolution: string;
      resolved_by: string;
    }>(`select status, resolution, resolved_by from public.reports where id = $1`, [id]);

    assert.equal(report!.status, 'resolved');
    assert.equal(report!.resolution, 'Spoke to the driver.');
    assert.equal(report!.resolved_by, corridor.ownerId);
  });

  it('cannot be closed twice', async () => {
    const [row] = await file(rider);
    const id = row!.file_report;

    await test.asUser(admin, `select public.resolve_report($1, 'Handled.')`, [id]);
    await assert.rejects(
      test.asUser(admin, `select public.resolve_report($1, 'Again.')`, [id]),
      /already been closed/i,
    );
  });

  it('is read-only to the API, so nobody edits a complaint about themselves', async () => {
    const [row] = await file(rider);

    for (const [who, sql] of [
      [rider, `update public.reports set status = 'resolved'`],
      [corridor.ownerId, `update public.reports set note = 'Actually it was fine'`],
      [rider, `delete from public.reports`],
      [
        rider,
        `insert into public.reports (booking_id, operator_id, reporter_id, category, note)
         values ('${bookingId}', '${corridor.operatorId}', '${rider}', 'safety', 'made up')`,
      ],
    ] as const) {
      await assert.rejects(test.asUser(who, sql), /permission denied/i);
    }

    // And it is still exactly as it was written.
    const [unchanged] = await test.raw<{ status: string }>(
      `select status from public.reports where id = $1`,
      [row!.file_report],
    );
    assert.equal(unchanged!.status, 'open');
  });
});

describe('feedback', () => {
  let test: TestDb;
  let admin: string;
  let author: string;
  let other: string;

  before(async () => {
    test = await migratedDatabase();

    admin = await createUser(test, { email: 'admin@example.com', name: 'Platform Admin' });
    await test.raw(`update public.profiles set platform_role = 'admin' where id = $1`, [admin]);

    author = await createUser(test, { email: 'author@example.com', name: 'Ida Author' });
    other = await createUser(test, { email: 'other@example.com', name: 'Someone Else' });

    await test.asUser(
      author,
      `insert into public.feedback (user_id, kind, message)
       values ($1, 'idea', 'Let search remember my last journey.')`,
      [author],
    );
  });

  after(async () => test.close());

  it('lets anyone signed in send one', async () => {
    const rows = await test.asUser<{ id: string }>(
      other,
      `insert into public.feedback (user_id, kind, message)
       values ($1, 'problem', 'I could not find the cancel button.') returning id`,
      [other],
    );
    assert.equal(rows.length, 1);
  });

  it('does not let one person file under another’s name', async () => {
    await assert.rejects(
      test.asUser(
        other,
        `insert into public.feedback (user_id, kind, message) values ($1, 'idea', 'Not mine')`,
        [author],
      ),
      /row-level security/i,
    );
  });

  it('is read by its author and by admins, and by nobody else', async () => {
    const mine = await test.asUser<{ message: string }>(
      author,
      `select message from public.feedback`,
    );
    assert.deepEqual(
      mine.map((row) => row.message),
      ['Let search remember my last journey.'],
    );

    const all = await test.asUser<{ id: string }>(admin, `select id from public.feedback`);
    assert.ok(all.length >= 2, 'an admin reads everyone’s');

    await assert.rejects(test.asAnon(`select * from public.feedback`), /permission denied/i);
  });
});

describe('a driver flagging a passenger', () => {
  let test: TestDb;
  let corridor: Corridor;

  let driver: string;
  let strangerDriver: string;
  let rider: string;
  let bookingId: string;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test);

    const [vehicle] = await test.asUser<{ id: string }>(
      corridor.ownerId,
      `insert into public.vehicles (operator_id, label, seat_count) values ($1, 'Grey Sienna', 7) returning id`,
      [corridor.operatorId],
    );

    driver = await passenger(test, 'Sam Driver');
    strangerDriver = await passenger(test, 'Other Driver');

    for (const who of [driver, strangerDriver]) {
      await test.asUser(
        corridor.ownerId,
        `insert into public.operator_members (operator_id, user_id, role) values ($1, $2, 'driver')`,
        [corridor.operatorId, who],
      );
    }

    // Only one of them is actually on this trip.
    await test.asUser(
      corridor.ownerId,
      `insert into public.departure_vehicles (departure_id, vehicle_id, driver_id) values ($1, $2, $3)`,
      [corridor.departureId, vehicle!.id, driver],
    );

    rider = await passenger(test, 'Loud Rider');
    bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: corridor.stops.length,
      stops: corridor.stops,
    });
    await test.asUser(corridor.ownerId, `select public.approve_booking($1)`, [bookingId]);
  });

  after(async () => test.close());

  it('lets the assigned driver raise one, with a note', async () => {
    const [row] = await test.asUser<{ raise_red_flag: string }>(
      driver,
      `select public.raise_red_flag($1, 'too_loud', 'Shouting on the phone for two hours.')`,
      [bookingId],
    );

    const [flag] = await test.raw<{ reason: string; note: string; created_by: string }>(
      `select reason, note, created_by from public.red_flags where id = $1`,
      [row!.raise_red_flag],
    );

    // The point of the whole migration: before it, the person who was actually
    // in the van could only reach the two automatic flags, neither of which
    // carries a word of explanation.
    assert.equal(flag!.reason, 'too_loud');
    assert.equal(flag!.note, 'Shouting on the phone for two hours.');
    assert.equal(flag!.created_by, driver);
  });

  it('refuses a driver who was not on that departure', async () => {
    await assert.rejects(
      test.asUser(strangerDriver, `select public.raise_red_flag($1, 'messy', null)`, [bookingId]),
      /only this operator/i,
    );
  });

  it('still lets an operator manager raise one', async () => {
    const rows = await test.asUser(
      corridor.ownerId,
      `select public.raise_red_flag($1, 'haggled', 'Argued about the fare at the kerb.')`,
      [bookingId],
    );
    assert.equal(rows.length, 1);
  });

  it('refuses the passenger themselves', async () => {
    await assert.rejects(
      test.asUser(rider, `select public.raise_red_flag($1, 'other', 'I am lovely')`, [bookingId]),
      /only this operator/i,
    );
  });
});
