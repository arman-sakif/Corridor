import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { migratedDatabase, type TestDb } from './harness.ts';
import { passenger, requestSeat, seedCorridor, type Corridor } from './seed.ts';
import { quote } from '../../lib/booking/fares.ts';

/**
 * Surcharges are fixed amounts the operator sets: a per-item luggage charge
 * beyond a free allowance, and a flat airport fee. Never a percentage, never
 * set by us, and never different for cash and e-transfer.
 */

describe('luggage and airport surcharges', () => {
  let test: TestDb;
  let corridor: Corridor;

  before(async () => {
    test = await migratedDatabase();
    corridor = await seedCorridor(test, { maxSeats: 20 });

    // $5 a bag beyond one per seat, $10 flat if either end is an airport.
    await test.asUser(
      corridor.ownerId,
      `update public.operators
          set free_luggage_per_seat = 1, extra_luggage_cents = 500, airport_fee_cents = 1000
        where id = $1`,
      [corridor.operatorId],
    );
  });

  after(async () => test.close());

  it('charges nothing when the bags are within the allowance', async () => {
    const rider = await passenger(test, 'Light Packer');
    const bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 4,
      stops: corridor.stops,
      seats: 2,
      luggage: 2,
    });

    const [row] = await test.raw<{ luggage_cents: number; total_cents: number }>(
      `select luggage_cents, total_cents from public.bookings where id = $1`,
      [bookingId],
    );

    assert.equal(row!.luggage_cents, 0, 'two seats carry two bags free');
    assert.equal(row!.total_cents, 9000);
  });

  it('charges per item beyond the allowance, counted per seat', async () => {
    const rider = await passenger(test, 'Heavy Packer');
    const bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 4,
      stops: corridor.stops,
      seats: 1,
      luggage: 3,
    });

    const [row] = await test.raw<{
      luggage_cents: number;
      base_cents: number;
      total_cents: number;
    }>(`select luggage_cents, base_cents, total_cents from public.bookings where id = $1`, [
      bookingId,
    ]);

    assert.equal(row!.luggage_cents, 1000, 'two bags over the allowance at $5 each');
    assert.equal(row!.total_cents, row!.base_cents + row!.luggage_cents);
  });

  it('adds the airport fee per seat when either end is an airport', async () => {
    await test.asUser(corridor.ownerId, `update public.stops set is_airport = true where id = $1`, [
      corridor.stops[3],
    ]);

    const rider = await passenger(test, 'Airport Bound');
    const bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 4,
      stops: corridor.stops,
      seats: 2,
      luggage: 0,
    });

    const [row] = await test.raw<{ airport_cents: number; total_cents: number }>(
      `select airport_cents, total_cents from public.bookings where id = $1`,
      [bookingId],
    );

    assert.equal(row!.airport_cents, 2000);
    assert.equal(row!.total_cents, 9000 + 2000);
  });

  it('leaves a journey that touches no airport alone', async () => {
    const rider = await passenger(test, 'Inland Rider');
    const bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 3,
      stops: corridor.stops,
    });

    const [row] = await test.raw<{ airport_cents: number }>(
      `select airport_cents from public.bookings where id = $1`,
      [bookingId],
    );
    assert.equal(row!.airport_cents, 0);
  });

  it('quotes exactly what it will charge', async () => {
    // Named for the row, not the function: `quote` here is the imported
    // TypeScript quoter, and shadowing it inside a file that compares the two
    // is asking to compare a thing with itself.
    const [quoted] = await test.asAnon<{
      base_cents: number;
      luggage_cents: number;
      airport_cents: number;
      total_cents: number;
    }>(`select * from public.quote_booking($1, $2, $3, 2, 5)`, [
      corridor.departureId,
      corridor.stops[0],
      corridor.stops[3],
    ]);

    const rider = await passenger(test, 'Quoted Rider');
    const bookingId = await requestSeat(test, rider, {
      departureId: corridor.departureId,
      fromSeq: 1,
      toSeq: 4,
      stops: corridor.stops,
      seats: 2,
      luggage: 5,
    });

    const [charged] = await test.raw<{
      base_cents: number;
      luggage_cents: number;
      airport_cents: number;
      total_cents: number;
    }>(
      `select base_cents, luggage_cents, airport_cents, total_cents
         from public.bookings where id = $1`,
      [bookingId],
    );

    // A quote that disagrees with the charge is worse than no quote.
    assert.deepEqual(quoted, charged);
  });

  it('quotes nothing for a pair of stops that is not for sale', async () => {
    const rows = await test.asAnon(`select * from public.quote_booking($1, $2, $3, 1, 0)`, [
      corridor.departureId,
      corridor.stops[3],
      corridor.stops[0],
    ]);
    assert.equal(rows.length, 0, 'backwards along the route is not a journey');
  });

  it('agrees with the TypeScript quote, so the booking form cannot mislead', async () => {
    // The passenger's running total is computed by lib/booking/fares.ts while
    // the charge is computed in SQL. Two implementations of one rule drift, so
    // this pins them together.
    const fares = await test.raw<{ from_seq: number; to_seq: number; price_cents: number }>(
      `select from_seq, to_seq, price_cents from public.fares where route_id = $1`,
      [corridor.routeId],
    );

    const inTypeScript = quote({
      mode: 'matrix',
      fares,
      fromSeq: 1,
      toSeq: 4,
      seats: 2,
      luggageCount: 5,
      touchesAirport: true,
      surcharges: { freeLuggage: 1, perExtraLuggageCents: 500, airportFeeCents: 1000 },
    });

    const [inSql] = await test.asAnon<{
      base_cents: number;
      luggage_cents: number;
      airport_cents: number;
      total_cents: number;
    }>(`select * from public.quote_booking($1, $2, $3, 2, 5)`, [
      corridor.departureId,
      corridor.stops[0],
      corridor.stops[3],
    ]);

    assert.deepEqual(inSql, inTypeScript);
  });

  it('defaults to no surcharges for an operator that has set none', async () => {
    const [row] = await test.raw<{
      free_luggage_per_seat: number;
      extra_luggage_cents: number;
      airport_fee_cents: number;
    }>(
      `select free_luggage_per_seat, extra_luggage_cents, airport_fee_cents
         from public.operators where id <> $1 limit 1`,
      [corridor.operatorId],
    );

    if (row) {
      assert.equal(row.extra_luggage_cents, 0);
      assert.equal(row.airport_fee_cents, 0);
    }
  });
});
