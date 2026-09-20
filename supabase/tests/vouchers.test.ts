import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { migratedDatabase, type TestDb } from './harness.ts';
import { passenger, requestSeat, seedCorridor, type Corridor } from './seed.ts';

/**
 * Voucher codes, against the real migrations.
 *
 * The rules worth protecting here are the ones that cost money when they go
 * wrong: the discount is computed from the operator's own row and never from
 * the caller, a code belongs to one business, a use comes back when its hold
 * lapses, and neither the ceiling nor the one-per-passenger rule can be walked
 * past by asking twice.
 */

/** Creates a code as the operator and returns it. */
async function createVoucher(
  test: TestDb,
  corridor: Corridor,
  {
    kind = 'amount',
    value = 500,
    window = '7d',
    maxUses = 10,
  }: { kind?: 'amount' | 'percent'; value?: number; window?: string; maxUses?: number } = {},
): Promise<string> {
  const rows = await test.asUser<{ create_voucher: string }>(
    corridor.ownerId,
    `select public.create_voucher($1, $2::public.voucher_kind, $3,
                                  $4::public.voucher_window, $5)`,
    [corridor.operatorId, kind, value, window, maxUses],
  );
  return rows[0]!.create_voucher;
}

async function bookingOf(test: TestDb, bookingId: string) {
  const [row] = await test.raw<{
    base_cents: number;
    luggage_cents: number;
    airport_cents: number;
    discount_cents: number;
    total_cents: number;
    voucher_id: string | null;
  }>(
    `select base_cents, luggage_cents, airport_cents, discount_cents, total_cents, voucher_id
       from public.bookings where id = $1`,
    [bookingId],
  );
  return row!;
}

describe('creating a voucher', () => {
  let test: TestDb;
  let corridor: Corridor;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test, { maxSeats: 20 });
  });

  after(async () => test.close());

  it('generates a six-digit code the operator did not choose', async () => {
    const code = await createVoucher(test, corridor);
    assert.match(code, /^[0-9]{6}$/);
  });

  it('computes the expiry from the window, in the database', async () => {
    const code = await createVoucher(test, corridor, { window: '3d' });

    const [row] = await test.asUser<{ days: number; validity: string }>(
      corridor.ownerId,
      `select round(extract(epoch from (expires_at - now())) / 86400)::int as days, validity::text
         from public.vouchers where operator_id = $1 and code = $2`,
      [corridor.operatorId, code],
    );

    assert.equal(row!.days, 3);
    assert.equal(row!.validity, '3d');
  });

  it('refuses a percentage outside 1–100', async () => {
    await assert.rejects(
      () => createVoucher(test, corridor, { kind: 'percent', value: 150 }),
      /between 1 and 100/,
    );
  });

  it('refuses anyone who does not manage the business', async () => {
    const outsider = await passenger(test, 'Nosy Neighbour');
    await assert.rejects(
      () =>
        test.asUser(
          outsider,
          `select public.create_voucher($1, 'amount'::public.voucher_kind, 500,
                                        '7d'::public.voucher_window, 5)`,
          [corridor.operatorId],
        ),
      /Only this operator/,
    );
  });

  it('will not issue one for an in-city business, which sells no seats', async () => {
    const localOwner = await passenger(test, 'Local Shuttle Owner');
    const [operator] = await test.asUser<{ id: string }>(
      localOwner,
      `insert into public.operators (name, type, status, created_by)
       values ('Yorkdale Local', 'incity', 'pending', $1) returning id`,
      [localOwner],
    );

    await assert.rejects(
      () =>
        test.asUser(
          localOwner,
          `select public.create_voucher($1, 'amount'::public.voucher_kind, 500,
                                        '7d'::public.voucher_window, 5)`,
          [operator!.id],
        ),
      /in-city operators do not sell/,
    );
  });

  it('keeps a code readable to its own operator and to nobody else', async () => {
    await createVoucher(test, corridor);
    const outsider = await passenger(test, 'Rival Operator');

    const mine = await test.asUser(
      corridor.ownerId,
      `select id from public.vouchers where operator_id = $1`,
      [corridor.operatorId],
    );
    const theirs = await test.asUser(
      outsider,
      `select id from public.vouchers where operator_id = $1`,
      [corridor.operatorId],
    );

    assert.ok(mine.length > 0);
    assert.equal(theirs.length, 0, 'a voucher table anyone could read is a voucher table');
  });
});

describe('spending a voucher', () => {
  let test: TestDb;
  let corridor: Corridor;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test, { maxSeats: 20 });
  });

  after(async () => test.close());

  it('takes a fixed amount off the fare and says so on the booking', async () => {
    const code = await createVoucher(test, corridor, { kind: 'amount', value: 500 });
    const rider = await passenger(test, 'Amount');

    const bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 4,
      stops: corridor.stops,
      voucher: code,
    });

    const booking = await bookingOf(test, bookingId);
    assert.equal(booking.base_cents, 4500, 'the matrix through-fare, unchanged');
    assert.equal(booking.discount_cents, 500);
    assert.equal(booking.total_cents, 4000);
    assert.ok(booking.voucher_id, 'the booking remembers which code it spent');
  });

  it('takes a percentage of the whole fare, surcharges included', async () => {
    await test.asUser(
      corridor.ownerId,
      `update public.operators
          set free_luggage_per_seat = 0, extra_luggage_cents = 500
        where id = $1`,
      [corridor.operatorId],
    );

    const code = await createVoucher(test, corridor, { kind: 'percent', value: 10 });
    const rider = await passenger(test, 'Percent');

    const bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 4,
      stops: corridor.stops,
      luggage: 2,
      voucher: code,
    });

    const booking = await bookingOf(test, bookingId);
    // $45 fare + $10 of bags = $55, less 10%.
    assert.equal(booking.base_cents + booking.luggage_cents, 5500);
    assert.equal(booking.discount_cents, 550);
    assert.equal(booking.total_cents, 4950);
  });

  it('never discounts past free', async () => {
    const code = await createVoucher(test, corridor, { kind: 'amount', value: 100000 });
    const rider = await passenger(test, 'Bigcode');

    const bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 2,
      stops: corridor.stops,
      voucher: code,
    });

    const booking = await bookingOf(test, bookingId);
    assert.equal(booking.total_cents, 0);
    assert.equal(booking.discount_cents, booking.base_cents);
  });

  it('refuses a code from a different business', async () => {
    // A rival with its own promotion. Six digits is a small space and two
    // operators may well land on the same code; neither can spend the other's.
    const rivalOwner = await passenger(test, 'Rival Owner');
    const [rival] = await test.asUser<{ id: string }>(
      rivalOwner,
      `insert into public.operators (name, type, status, created_by)
       values ('Rival Rides', 'intercity', 'pending', $1) returning id`,
      [rivalOwner],
    );

    const rows = await test.asUser<{ create_voucher: string }>(
      rivalOwner,
      `select public.create_voucher($1, 'amount'::public.voucher_kind, 500,
                                    '7d'::public.voucher_window, 10)`,
      [rival!.id],
    );
    const code = rows[0]!.create_voucher;
    const rider = await passenger(test, 'Crossed');

    await assert.rejects(
      () =>
        requestSeat(test, rider, {
          departureId: corridor.departureId,
          fromSeq: 1,
          toSeq: 4,
          stops: corridor.stops,
          voucher: code,
        }),
      /not one this operator has issued/,
    );
  });

  it('refuses an expired code rather than quietly charging full price', async () => {
    const code = await createVoucher(test, corridor);
    await test.raw(
      `update public.vouchers set expires_at = now() - interval '1 day'
        where operator_id = $1 and code = $2`,
      [corridor.operatorId, code],
    );

    const rider = await passenger(test, 'Late');
    await assert.rejects(
      () =>
        requestSeat(test, rider, {
          departureId: corridor.departureId,
          fromSeq: 1,
          toSeq: 4,
          stops: corridor.stops,
          voucher: code,
        }),
      /expired/,
    );

    const [count] = await test.raw<{ n: number }>(
      `select count(*)::int as n from public.bookings where passenger_id = $1`,
      [rider],
    );
    assert.equal(count!.n, 0, 'nothing is booked at a price they did not agree to');
  });

  it('refuses a withdrawn code', async () => {
    const code = await createVoucher(test, corridor);
    const [voucher] = await test.asUser<{ id: string }>(
      corridor.ownerId,
      `select id from public.vouchers where operator_id = $1 and code = $2`,
      [corridor.operatorId, code],
    );
    await test.asUser(corridor.ownerId, `select public.set_voucher_active($1, false)`, [
      voucher!.id,
    ]);

    const rider = await passenger(test, 'Withdrawn');
    await assert.rejects(
      () =>
        requestSeat(test, rider, {
          departureId: corridor.departureId,
          fromSeq: 1,
          toSeq: 4,
          stops: corridor.stops,
          voucher: code,
        }),
      /withdrawn/,
    );
  });

  it('lets one passenger spend a code once', async () => {
    const code = await createVoucher(test, corridor);
    const rider = await passenger(test, 'Repeat');

    await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 2,
      stops: corridor.stops,
      voucher: code,
    });

    await assert.rejects(
      () =>
        requestSeat(test, rider, {
          departureId: corridor.departureId,
          fromSeq: 2,
          toSeq: 3,
          stops: corridor.stops,
          voucher: code,
        }),
      /already used that code/,
    );
  });

  it('stops at the ceiling the operator set', async () => {
    const code = await createVoucher(test, corridor, { maxUses: 2 });

    for (const name of ['First', 'Second']) {
      const rider = await passenger(test, `${name} ${Date.now()}`);
      await requestSeat(test, rider, {
        departureId: corridor.departureId,
        fromSeq: 1,
        toSeq: 2,
        stops: corridor.stops,
        voucher: code,
      });
    }

    const third = await passenger(test, 'Third');
    await assert.rejects(
      () =>
        requestSeat(test, third, {
          departureId: corridor.departureId,
          fromSeq: 1,
          toSeq: 2,
          stops: corridor.stops,
          voucher: code,
        }),
      /used up/,
    );
  });

  /**
   * The same rule §5.2 states for seats. A hold that lapses gives its use back
   * without any job having run — and it has to, or a code with two uses could
   * be exhausted by two people who never turned up.
   */
  it('gives a use back the instant the hold behind it lapses', async () => {
    const code = await createVoucher(test, corridor, { maxUses: 1 });
    const first = await passenger(test, 'Indecisive');

    const bookingId = await requestSeat(test, first, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 2,
      stops: corridor.stops,
      voucher: code,
    });

    const second = await passenger(test, 'Waiting');
    await assert.rejects(
      () =>
        requestSeat(test, second, {
          departureId: corridor.departureId,
          fromSeq: 1,
          toSeq: 2,
          stops: corridor.stops,
          voucher: code,
        }),
      /used up/,
      'while the first hold is live, the last use is spoken for',
    );

    // Lapse it. Nothing else — no sweep, no relabelling.
    await test.raw(
      `update public.bookings set hold_expires_at = now() - interval '1 minute' where id = $1`,
      [bookingId],
    );

    const laterId = await requestSeat(test, second, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 2,
      stops: corridor.stops,
      voucher: code,
    });

    const booking = await bookingOf(test, laterId);
    assert.equal(booking.discount_cents, 500);
  });

  it('keeps the discount on the booking when the code is later withdrawn', async () => {
    const code = await createVoucher(test, corridor);
    const rider = await passenger(test, 'Snapshot');

    const bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 4,
      stops: corridor.stops,
      voucher: code,
    });

    const [voucher] = await test.asUser<{ id: string }>(
      corridor.ownerId,
      `select id from public.vouchers where operator_id = $1 and code = $2`,
      [corridor.operatorId, code],
    );
    await test.asUser(corridor.ownerId, `select public.set_voucher_active($1, false)`, [
      voucher!.id,
    ]);

    const booking = await bookingOf(test, bookingId);
    assert.equal(booking.total_cents, 4000, 'a snapshot, not a live lookup');
  });

  it('books at full price when no code is given', async () => {
    const rider = await passenger(test, 'Plain');
    const bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 4,
      stops: corridor.stops,
    });

    const booking = await bookingOf(test, bookingId);
    assert.equal(booking.discount_cents, 0);
    assert.equal(booking.total_cents, 4500);
    assert.equal(booking.voucher_id, null);
  });
});

describe('checking a code before committing', () => {
  let test: TestDb;
  let corridor: Corridor;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test, { maxSeats: 20 });
  });

  after(async () => test.close());

  it('tells a signed-in passenger what a live code is worth', async () => {
    const code = await createVoucher(test, corridor, { kind: 'percent', value: 15 });
    const rider = await passenger(test, 'Checker');

    const [row] = await test.asUser<{ kind: string; value: number }>(
      rider,
      `select kind::text, value from public.check_voucher($1, $2)`,
      [corridor.departureId, code],
    );

    assert.equal(row!.kind, 'percent');
    assert.equal(row!.value, 15);
  });

  it('gives a signed-out visitor nothing to sweep', async () => {
    const code = await createVoucher(test, corridor);
    await assert.rejects(
      () => test.asAnon(`select * from public.check_voucher($1, $2)`, [corridor.departureId, code]),
      /permission denied|Sign in/,
    );
  });

  it('says a code is six digits rather than pretending to look it up', async () => {
    const rider = await passenger(test, 'Typo');
    await assert.rejects(
      () =>
        test.asUser(rider, `select * from public.check_voucher($1, $2)`, [
          corridor.departureId,
          'FREE',
        ]),
      /six digits/,
    );
  });
});
