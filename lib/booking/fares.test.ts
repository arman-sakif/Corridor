import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_SURCHARGES, priceableSegments, quote, segmentBaseCents } from './fares.ts';
import type { FareRow } from './fares.ts';

// Windsor(1) → Chatham(2) → London(3) → Yorkdale(4), priced the way these
// operators actually price: the long haul is cheaper than the sum of its legs.
const matrixFares: FareRow[] = [
  { from_seq: 1, to_seq: 2, price_cents: 1500 },
  { from_seq: 2, to_seq: 3, price_cents: 2000 },
  { from_seq: 3, to_seq: 4, price_cents: 3000 },
  { from_seq: 1, to_seq: 3, price_cents: 3000 },
  { from_seq: 1, to_seq: 4, price_cents: 4500 },
  { from_seq: 2, to_seq: 4, price_cents: 4000 },
];

const additiveFares: FareRow[] = [
  { from_seq: 1, to_seq: 2, price_cents: 1500 },
  { from_seq: 2, to_seq: 3, price_cents: 2000 },
  { from_seq: 3, to_seq: 4, price_cents: 3000 },
];

describe('segmentBaseCents — matrix', () => {
  it('uses the explicit segment price, not the sum of its legs', () => {
    // The legs total $65. The operator sells the through fare for $45.
    assert.equal(segmentBaseCents('matrix', matrixFares, 1, 4), 4500);
  });

  it('returns null for a segment the operator has not priced', () => {
    const sparse = matrixFares.filter((f) => !(f.from_seq === 1 && f.to_seq === 4));
    assert.equal(segmentBaseCents('matrix', sparse, 1, 4), null);
  });

  it('refuses a backwards or zero-length segment', () => {
    assert.equal(segmentBaseCents('matrix', matrixFares, 3, 1), null);
    assert.equal(segmentBaseCents('matrix', matrixFares, 2, 2), null);
  });
});

describe('segmentBaseCents — additive', () => {
  it('sums the legs the segment spans', () => {
    assert.equal(segmentBaseCents('additive', additiveFares, 1, 4), 6500);
    assert.equal(segmentBaseCents('additive', additiveFares, 2, 4), 5000);
  });

  it('makes a segment unsellable when one leg in the middle is unpriced', () => {
    const gapped = additiveFares.filter((f) => f.from_seq !== 2);
    assert.equal(segmentBaseCents('additive', gapped, 1, 4), null);
  });
});

describe('priceableSegments', () => {
  it('lists every segment a matrix route sells, and only those', () => {
    const segments = priceableSegments('matrix', matrixFares, 4);
    assert.equal(segments.size, 6);
    assert.equal(segments.get('1-4'), 4500);
    assert.equal(segments.get('3-4'), 3000);
  });

  it('derives all ten segments of a four-stop additive route from three legs', () => {
    const segments = priceableSegments('additive', additiveFares, 4);
    assert.equal(segments.size, 6);
    assert.equal(segments.get('1-4'), 6500);
  });
});

describe('quote', () => {
  it('multiplies the base fare by seats', () => {
    const result = quote({
      mode: 'matrix',
      fares: matrixFares,
      fromSeq: 1,
      toSeq: 4,
      seats: 2,
      luggageCount: 0,
      touchesAirport: false,
    });
    assert.equal(result.base_cents, 9000);
    assert.equal(result.total_cents, 9000);
  });

  it('charges only bags beyond the per-seat free allowance', () => {
    const surcharges = { freeLuggage: 1, perExtraLuggageCents: 500, airportFeeCents: 0 };

    const twoSeatsTwoBags = quote({
      mode: 'matrix',
      fares: matrixFares,
      fromSeq: 1,
      toSeq: 4,
      seats: 2,
      luggageCount: 2,
      touchesAirport: false,
      surcharges,
    });
    assert.equal(twoSeatsTwoBags.luggage_cents, 0);

    const oneSeatThreeBags = quote({
      mode: 'matrix',
      fares: matrixFares,
      fromSeq: 1,
      toSeq: 4,
      seats: 1,
      luggageCount: 3,
      touchesAirport: false,
      surcharges,
    });
    assert.equal(oneSeatThreeBags.luggage_cents, 1000);
  });

  it('adds the airport fee per seat and keeps the total consistent', () => {
    const result = quote({
      mode: 'matrix',
      fares: matrixFares,
      fromSeq: 1,
      toSeq: 4,
      seats: 2,
      luggageCount: 0,
      touchesAirport: true,
      surcharges: { ...DEFAULT_SURCHARGES, airportFeeCents: 1000 },
    });
    assert.equal(result.airport_cents, 2000);
    assert.equal(
      result.total_cents,
      result.base_cents + result.luggage_cents + result.airport_cents,
    );
  });

  it('throws rather than guessing a price for an unsold pair of stops', () => {
    assert.throws(
      () =>
        quote({
          mode: 'matrix',
          fares: [],
          fromSeq: 1,
          toSeq: 2,
          seats: 1,
          luggageCount: 0,
          touchesAirport: false,
        }),
      /does not sell/,
    );
  });
});
