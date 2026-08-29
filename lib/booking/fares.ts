/**
 * Fare interpretation. This is the *only* module that reads `pricing_mode`.
 *
 * Two modes, both operator-defined:
 *
 *   matrix   (default) — every bookable segment is priced explicitly and
 *                        independently. Toronto→London $35, London→Windsor
 *                        $30, Toronto→Windsor $45. The last is NOT the sum,
 *                        and assuming it is would silently overcharge every
 *                        long-haul passenger.
 *
 *   additive           — only consecutive legs are priced, and a segment costs
 *                        the sum of the legs it spans. $35 + $30 = $65.
 *
 * Fares are directional: a route runs one way, so Toronto→London and
 * London→Toronto are rows on different routes and need not match.
 */

import type { PricingMode } from '@/lib/supabase/database.types';

export type FareRow = { from_seq: number; to_seq: number; price_cents: number };

export type SurchargePolicy = {
  /** Luggage items carried free. Anything beyond this is charged. */
  freeLuggage: number;
  perExtraLuggageCents: number;
  /** Flat fee when either end of the trip is an airport stop. */
  airportFeeCents: number;
};

export const DEFAULT_SURCHARGES: SurchargePolicy = {
  freeLuggage: 1,
  perExtraLuggageCents: 0,
  airportFeeCents: 0,
};

export type FareBreakdown = {
  base_cents: number;
  luggage_cents: number;
  airport_cents: number;
  total_cents: number;
};

export class FareUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FareUnavailableError';
  }
}

/**
 * Base fare for one seat on the segment `fromSeq → toSeq`.
 *
 * Returns null when the operator has not priced the segment. That is not an
 * error in itself — it means the segment is not for sale, and search must hide
 * it rather than guess a price.
 */
export function segmentBaseCents(
  mode: PricingMode,
  fares: FareRow[],
  fromSeq: number,
  toSeq: number,
): number | null {
  if (toSeq <= fromSeq) return null;

  if (mode === 'matrix') {
    const exact = fares.find((f) => f.from_seq === fromSeq && f.to_seq === toSeq);
    return exact ? exact.price_cents : null;
  }

  // additive: sum every consecutive leg the segment spans. A single missing
  // leg makes the whole segment unsellable rather than cheaper.
  let total = 0;
  for (let seq = fromSeq; seq < toSeq; seq += 1) {
    const leg = fares.find((f) => f.from_seq === seq && f.to_seq === seq + 1);
    if (!leg) return null;
    total += leg.price_cents;
  }
  return total;
}

/**
 * Every segment an operator has priced, keyed "from-to". Search uses this to
 * show a fare beside each departure without a query per segment.
 */
export function priceableSegments(
  mode: PricingMode,
  fares: FareRow[],
  stopCount: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (let from = 1; from <= stopCount; from += 1) {
    for (let to = from + 1; to <= stopCount; to += 1) {
      const cents = segmentBaseCents(mode, fares, from, to);
      if (cents !== null) out.set(`${from}-${to}`, cents);
    }
  }
  return out;
}

/**
 * The full quote for a booking. Always computed server-side from the
 * operator's own fare rows; a price sent by the client is ignored, and the
 * result is snapshotted onto the booking so a later fare change cannot rewrite
 * history.
 */
export function quote({
  mode,
  fares,
  fromSeq,
  toSeq,
  seats,
  luggageCount,
  touchesAirport,
  surcharges = DEFAULT_SURCHARGES,
}: {
  mode: PricingMode;
  fares: FareRow[];
  fromSeq: number;
  toSeq: number;
  seats: number;
  luggageCount: number;
  touchesAirport: boolean;
  surcharges?: SurchargePolicy;
}): FareBreakdown {
  const perSeat = segmentBaseCents(mode, fares, fromSeq, toSeq);
  if (perSeat === null) {
    throw new FareUnavailableError('This operator does not sell that pair of stops.');
  }

  const base_cents = perSeat * seats;

  // The free allowance is per seat: two passengers travelling together carry
  // two free bags.
  const extraBags = Math.max(0, luggageCount - surcharges.freeLuggage * seats);
  const luggage_cents = extraBags * surcharges.perExtraLuggageCents;

  const airport_cents = touchesAirport ? surcharges.airportFeeCents * seats : 0;

  return {
    base_cents,
    luggage_cents,
    airport_cents,
    total_cents: base_cents + luggage_cents + airport_cents,
  };
}
