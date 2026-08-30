import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { priceableSegments, type FareRow } from './fares';
import { seatsAvailable, type CapacityBooking } from './capacity';
import type { PricingMode } from '@/lib/supabase/database.types';
import type { ServiceDate } from '@/lib/time';

/**
 * Search: city pair plus a date, across every active operator.
 *
 * A passenger picks a *company and a departure time*, not a driver or a
 * vehicle. Nothing about who is driving or what is being driven appears in
 * anything this module returns.
 *
 * Cities can hold several of an operator's stops, so one departure may offer
 * more than one way to make the same journey — Yorkdale or Union at the
 * Toronto end, for instance. Each of those is a `Boarding`, priced
 * independently, and the passenger chooses between them on the departure page.
 */

export type Boarding = {
  fromStopId: string;
  fromStopLabel: string;
  fromStopDescription: string | null;
  fromSeq: number;
  toStopId: string;
  toStopLabel: string;
  toStopDescription: string | null;
  toSeq: number;
  baseCents: number;
  /** The operator's flat airport fee, when either end is an airport. */
  airportCents: number;
  seatsLeft: number;
};

export type SearchResult = {
  departureId: string;
  serviceDate: ServiceDate;
  departureTime: string;
  operator: { id: string; name: string; publicPhone: string | null; airportFeeCents: number };
  routeName: string;
  maxSeats: number;
  /** Cheapest boarding, which is what the result card leads with. */
  fromCents: number;
  seatsLeft: number;
  boardings: Boarding[];
};

type RouteShape = {
  id: string;
  name: string;
  operator_id: string;
  pricing_mode: PricingMode;
  stops: {
    seq: number;
    stopId: string;
    cityId: string;
    label: string;
    description: string | null;
    isAirport: boolean;
  }[];
  fares: FareRow[];
};

/**
 * Every departure that can carry someone from one city to the other on a
 * given date, cheapest boarding first within each departure time.
 */
export async function searchDepartures({
  fromCityId,
  toCityId,
  date,
  seats = 1,
}: {
  fromCityId: string;
  toCityId: string;
  date: ServiceDate;
  seats?: number;
}): Promise<SearchResult[]> {
  if (fromCityId === toCityId) return [];

  const supabase = await createClient();

  // RLS keeps this to routes belonging to active operators, so no status
  // filter is needed here — but the explicit operator join below is the second
  // layer, in case a policy is ever loosened by mistake.
  const { data: routeRows } = await supabase
    .from('routes')
    .select(
      `id, name, operator_id, pricing_mode,
       operator:operators!inner(id, name, public_phone, status, airport_fee_cents),
       route_stops(seq, stop:stops(id, city_id, label, description, is_airport)),
       fares(from_seq, to_seq, price_cents)`,
    )
    .eq('is_active', true)
    .eq('operator.status', 'active');

  if (!routeRows?.length) return [];

  const operators = new Map<
    string,
    { id: string; name: string; publicPhone: string | null; airportFeeCents: number }
  >();
  const routes = new Map<string, RouteShape>();

  for (const row of routeRows) {
    const operator = row.operator as unknown as {
      id: string;
      name: string;
      public_phone: string | null;
      airport_fee_cents: number;
    } | null;
    if (!operator) continue;

    operators.set(operator.id, {
      id: operator.id,
      name: operator.name,
      publicPhone: operator.public_phone,
      airportFeeCents: operator.airport_fee_cents ?? 0,
    });

    routes.set(row.id, {
      id: row.id,
      name: row.name,
      operator_id: row.operator_id,
      pricing_mode: row.pricing_mode,
      stops: (row.route_stops ?? [])
        .map((rs) => ({
          seq: rs.seq,
          stopId: rs.stop?.id ?? '',
          cityId: rs.stop?.city_id ?? '',
          label: rs.stop?.label ?? '',
          description: rs.stop?.description ?? null,
          isAirport: rs.stop?.is_airport ?? false,
        }))
        .sort((a, b) => a.seq - b.seq),
      fares: row.fares ?? [],
    });
  }

  // A route is one direction, so a usable pair is one where the origin city
  // comes before the destination city along the route.
  const usable = [...routes.values()].filter((route) =>
    route.stops.some(
      (from) =>
        from.cityId === fromCityId &&
        route.stops.some((to) => to.cityId === toCityId && to.seq > from.seq),
    ),
  );

  if (usable.length === 0) return [];

  const { data: departures } = await supabase
    .from('departures')
    .select('id, route_id, operator_id, service_date, departure_time, max_seats')
    .eq('service_date', date)
    .eq('status', 'scheduled')
    .in(
      'route_id',
      usable.map((route) => route.id),
    )
    .order('departure_time');

  if (!departures?.length) return [];

  // Seats left comes from an aggregate function rather than the bookings
  // table: a passenger may see how full a departure is, never who is on it.
  const { data: loads } = await supabase.rpc('departure_leg_loads', {
    p_departure_ids: departures.map((d) => d.id),
  });

  const loadIndex = new Map<string, Map<number, number>>();
  for (const load of loads ?? []) {
    const perLeg = loadIndex.get(load.departure_id) ?? new Map<number, number>();
    perLeg.set(load.leg_start, load.seats_taken);
    loadIndex.set(load.departure_id, perLeg);
  }

  const results: SearchResult[] = [];

  for (const departure of departures) {
    const route = routes.get(departure.route_id);
    if (!route) continue;

    const priced = priceableSegments(route.pricing_mode, route.fares, route.stops.length);
    const perLeg = loadIndex.get(departure.id) ?? new Map<number, number>();

    const boardings: Boarding[] = [];

    for (const from of route.stops) {
      if (from.cityId !== fromCityId) continue;
      for (const to of route.stops) {
        if (to.cityId !== toCityId || to.seq <= from.seq) continue;

        const baseCents = priced.get(`${from.seq}-${to.seq}`);
        // Unpriced means not for sale. Search hides it rather than guessing.
        if (baseCents === undefined) continue;

        let busiest = 0;
        for (let leg = from.seq; leg < to.seq; leg += 1) {
          busiest = Math.max(busiest, perLeg.get(leg) ?? 0);
        }

        // A card showing $45 for a trip that costs $105 is worse than no
        // price at all, so the airport fee travels with the boarding.
        const airportCents =
          from.isAirport || to.isAirport ? (operators.get(departure.operator_id)?.airportFeeCents ?? 0) : 0;

        boardings.push({
          airportCents,
          fromStopId: from.stopId,
          fromStopLabel: from.label,
          fromStopDescription: from.description,
          fromSeq: from.seq,
          toStopId: to.stopId,
          toStopLabel: to.label,
          toStopDescription: to.description,
          toSeq: to.seq,
          baseCents,
          seatsLeft: Math.max(0, departure.max_seats - busiest),
        });
      }
    }

    const sellable = boardings.filter((boarding) => boarding.seatsLeft >= seats);
    if (sellable.length === 0) continue;

    // Cheapest all-in, not cheapest base — otherwise an airport boarding
    // could lead the card at a price nobody can actually pay.
    sellable.sort((a, b) => a.baseCents + a.airportCents - (b.baseCents + b.airportCents));

    const operator = operators.get(departure.operator_id);
    if (!operator) continue;

    results.push({
      departureId: departure.id,
      serviceDate: departure.service_date,
      departureTime: departure.departure_time,
      operator,
      routeName: route.name,
      maxSeats: departure.max_seats,
      fromCents: sellable[0]!.baseCents + sellable[0]!.airportCents,
      seatsLeft: Math.max(...sellable.map((b) => b.seatsLeft)),
      boardings: sellable,
    });
  }

  return results.sort((a, b) => a.departureTime.localeCompare(b.departureTime));
}

/**
 * The boardings for one departure and one city pair — what the departure page
 * needs to let a passenger choose their exact pickup and drop-off.
 */
export async function departureBoardings({
  departureId,
  fromCityId,
  toCityId,
}: {
  departureId: string;
  fromCityId?: string;
  toCityId?: string;
}) {
  const supabase = await createClient();

  const { data: departure } = await supabase
    .from('departures')
    .select(
      `id, service_date, departure_time, max_seats, status, route_id,
       operator:operators(id, name, public_phone, bio,
         free_luggage_per_seat, extra_luggage_cents, airport_fee_cents),
       route:routes(id, name, pricing_mode,
         route_stops(seq, stop:stops(id, city_id, label, description, is_airport,
           city:cities(name))),
         fares(from_seq, to_seq, price_cents))`,
    )
    .eq('id', departureId)
    .maybeSingle();

  if (!departure?.route) return null;

  const route = departure.route as unknown as {
    id: string;
    name: string;
    pricing_mode: PricingMode;
    route_stops: {
      seq: number;
      stop: {
        id: string;
        city_id: string;
        label: string;
        description: string | null;
        is_airport: boolean;
        city: { name: string } | null;
      } | null;
    }[];
    fares: FareRow[];
  };

  const stops = route.route_stops
    .map((rs) => ({
      seq: rs.seq,
      stopId: rs.stop?.id ?? '',
      cityId: rs.stop?.city_id ?? '',
      cityName: rs.stop?.city?.name ?? '',
      label: rs.stop?.label ?? '',
      description: rs.stop?.description ?? null,
      isAirport: rs.stop?.is_airport ?? false,
    }))
    .sort((a, b) => a.seq - b.seq);

  const operatorSurcharges = departure.operator as unknown as {
    free_luggage_per_seat: number;
    extra_luggage_cents: number;
    airport_fee_cents: number;
  } | null;

  const priced = priceableSegments(route.pricing_mode, route.fares, stops.length);

  const { data: loads } = await supabase.rpc('departure_leg_loads', {
    p_departure_ids: [departureId],
  });

  const perLeg = new Map<number, number>();
  for (const load of loads ?? []) perLeg.set(load.leg_start, load.seats_taken);

  const boardings = stops
    // The origin filter belongs out here. It was inside the inner chain,
    // written as a predicate on `to` that only ever read `from` — so it was
    // invariant across the whole inner loop, keeping every pair or discarding
    // every pair, and re-deciding that for each one.
    .filter((from) => !fromCityId || from.cityId === fromCityId)
    .flatMap((from) =>
      stops
        .filter((to) => to.seq > from.seq)
        .filter((to) => !toCityId || to.cityId === toCityId)
        .flatMap((to) => {
          const baseCents = priced.get(`${from.seq}-${to.seq}`);
          if (baseCents === undefined) return [];

          let busiest = 0;
          for (let leg = from.seq; leg < to.seq; leg += 1) {
            busiest = Math.max(busiest, perLeg.get(leg) ?? 0);
          }

          return [
            {
              from,
              to,
              baseCents,
              seatsLeft: Math.max(0, departure.max_seats - busiest),
            },
          ];
        }),
    );

  return {
    id: departure.id,
    serviceDate: departure.service_date,
    departureTime: departure.departure_time,
    maxSeats: departure.max_seats,
    status: departure.status,
    operator: departure.operator as unknown as {
      id: string;
      name: string;
      public_phone: string | null;
      bio: string | null;
    } | null,
    // The operator's own surcharge settings, so the page can show a running
    // total that matches what request_booking() will actually charge.
    surcharges: {
      freeLuggage: operatorSurcharges?.free_luggage_per_seat ?? 1,
      perExtraLuggageCents: operatorSurcharges?.extra_luggage_cents ?? 0,
      airportFeeCents: operatorSurcharges?.airport_fee_cents ?? 0,
    },
    routeName: route.name,
    stops,
    boardings,
  };
}

/** Advisory seat count for one segment, used to render a warning before the
 *  passenger commits. The authority is always `request_booking()`. */
export function advisorySeatsLeft(
  bookings: CapacityBooking[],
  maxSeats: number,
  fromSeq: number,
  toSeq: number,
): number {
  return seatsAvailable({ bookings, maxSeats, fromSeq, toSeq });
}
