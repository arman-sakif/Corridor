import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rangeDays, summarize } from './insights.ts';

type Raw = Parameters<typeof summarize>[0][number];

function day(dow: number, partial: Partial<Raw> = {}): Raw {
  return {
    dow,
    departures: 1,
    seats_offered: 4,
    seats_taken: 2,
    full_departures: 0,
    bookings: 2,
    passengers: 2,
    fares_cents: 9000,
    discount_cents: 0,
    turned_away: 0,
    ...partial,
  };
}

describe('summarize', () => {
  it('returns all seven days, Sunday first, even when only one ran', () => {
    const { days } = summarize([day(3)]);

    assert.equal(days.length, 7);
    assert.deepEqual(
      days.map((d) => d.name),
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    );
    assert.equal(days[3]!.departures, 1);
    assert.equal(days[0]!.departures, 0, 'a day never run is a real answer, not a missing row');
  });

  it('reads occupancy off the busiest leg against the seats offered', () => {
    const { days } = summarize([day(1, { seats_offered: 16, seats_taken: 12 })]);
    assert.equal(days[1]!.occupancy, 75);
  });

  it('calls a day with no departures 0% rather than dividing by nothing', () => {
    const { days } = summarize([]);
    assert.equal(days[2]!.occupancy, 0);
    assert.ok(Number.isFinite(days[2]!.occupancy));
  });

  it('totals across the week, and takes occupancy from the totals', () => {
    const { totals } = summarize([
      day(5, { seats_offered: 10, seats_taken: 9, fares_cents: 20000, discount_cents: 500 }),
      day(6, { seats_offered: 10, seats_taken: 1, fares_cents: 4000 }),
    ]);

    assert.equal(totals.departures, 2);
    assert.equal(totals.seatsOffered, 20);
    assert.equal(totals.seatsTaken, 10);
    assert.equal(totals.occupancy, 50, 'not the average of 90% and 10% by accident');
    assert.equal(totals.faresCents, 24000);
    assert.equal(totals.discountCents, 500);
  });

  it('names the fullest and emptiest days that actually ran', () => {
    const { best, worst } = summarize([
      day(0, { seats_offered: 10, seats_taken: 9 }),
      day(2, { seats_offered: 10, seats_taken: 2 }),
    ]);

    assert.equal(best?.name, 'Sun');
    assert.equal(worst?.name, 'Tue');
  });

  it('never points at a day the operator does not run as their quietest', () => {
    const { worst } = summarize([
      day(0, { seats_offered: 10, seats_taken: 9 }),
      day(2, { seats_offered: 10, seats_taken: 2 }),
    ]);

    assert.notEqual(worst?.name, 'Mon', 'Monday had no departures at all');
  });

  it('withholds a verdict until there are two days to compare', () => {
    const { best, worst } = summarize([day(4)]);
    assert.equal(best, null);
    assert.equal(worst, null);
  });

  it('copes with counts arriving as strings, the way bigint does', () => {
    const { days } = summarize([
      { ...day(1), fares_cents: '9000' as unknown as number },
    ]);

    assert.equal(days[1]!.faresCents, 9000);
    assert.equal(typeof days[1]!.faresCents, 'number');
  });
});

describe('rangeDays', () => {
  it('reads the window off the query string', () => {
    assert.equal(rangeDays('90'), 90);
    assert.equal(rangeDays('365'), 365);
  });

  it('falls back to a month for anything it does not recognise', () => {
    assert.equal(rangeDays(undefined), 30);
    assert.equal(rangeDays('all-time'), 30);
  });
});
