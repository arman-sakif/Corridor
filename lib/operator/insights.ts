/**
 * What an operator is shown about their own trade.
 *
 * The aggregation itself is `operator_insights()` in
 * `20260920000031_insights.sql`, for two reasons: PostgREST caps a select at
 * 1000 rows and a quarter of departures with their bookings is well past it,
 * and "how full was that departure" has one correct definition — the load on
 * its busiest leg — which belongs next to the capacity rule it comes from.
 *
 * Everything here is the shaping around that — seven days whether or not the
 * operator ran on all seven, percentages, and the one sentence worth putting
 * at the top of the page — and it is pure, so it is tested without a database.
 * The call itself lives in `lib/operator/queries.ts`.
 */

import { DAY_NAMES } from '../time.ts';

/** The windows the page offers, and what each is called. */
export const INSIGHT_RANGES = [
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 90 days', days: 90 },
  { value: '365', label: 'Last 12 months', days: 365 },
] as const;

export type InsightRange = (typeof INSIGHT_RANGES)[number]['value'];

export function rangeDays(value: string | undefined): number {
  return INSIGHT_RANGES.find((range) => range.value === value)?.days ?? 30;
}

export type DayRow = {
  /** 0 = Sunday, matching Postgres `extract(dow)` and `Date#getDay`. */
  dow: number;
  name: string;
  departures: number;
  seatsOffered: number;
  seatsTaken: number;
  fullDepartures: number;
  bookings: number;
  passengers: number;
  faresCents: number;
  discountCents: number;
  turnedAway: number;
  /** Busiest-leg seats as a share of seats offered, 0–100. */
  occupancy: number;
};

export type Insights = {
  days: DayRow[];
  totals: Omit<DayRow, 'dow' | 'name'>;
  /** The fullest and emptiest days that actually ran, or null if none did. */
  best: DayRow | null;
  worst: DayRow | null;
};

function occupancyOf(seatsTaken: number, seatsOffered: number): number {
  return seatsOffered === 0 ? 0 : Math.round((seatsTaken / seatsOffered) * 100);
}

/**
 * Seven rows, always, in Sunday-first order. A weekday an operator has never
 * run is a real answer — "you do not run Mondays" — and dropping it would make
 * the chart silently re-scale each time the window changed.
 */
export function summarize(
  raw: {
    dow: number;
    departures: number;
    seats_offered: number;
    seats_taken: number;
    full_departures: number;
    bookings: number;
    passengers: number;
    fares_cents: number;
    discount_cents: number;
    turned_away: number;
  }[],
): Insights {
  const days: DayRow[] = DAY_NAMES.map((name, dow) => {
    const row = raw.find((candidate) => Number(candidate.dow) === dow);
    const seatsOffered = Number(row?.seats_offered ?? 0);
    const seatsTaken = Number(row?.seats_taken ?? 0);

    return {
      dow,
      name,
      departures: Number(row?.departures ?? 0),
      seatsOffered,
      seatsTaken,
      fullDepartures: Number(row?.full_departures ?? 0),
      bookings: Number(row?.bookings ?? 0),
      passengers: Number(row?.passengers ?? 0),
      faresCents: Number(row?.fares_cents ?? 0),
      discountCents: Number(row?.discount_cents ?? 0),
      turnedAway: Number(row?.turned_away ?? 0),
      occupancy: occupancyOf(seatsTaken, seatsOffered),
    };
  });

  const sum = (pick: (day: DayRow) => number) => days.reduce((acc, day) => acc + pick(day), 0);

  const seatsOffered = sum((day) => day.seatsOffered);
  const seatsTaken = sum((day) => day.seatsTaken);

  // Only days that ran can be best or worst. A day with no departures has an
  // occupancy of 0, and calling that "your quietest day" would be a lie about
  // a day the operator never offered.
  const ran = days.filter((day) => day.departures > 0);
  const byOccupancy = [...ran].sort((a, b) => b.occupancy - a.occupancy);

  return {
    days,
    totals: {
      departures: sum((day) => day.departures),
      seatsOffered,
      seatsTaken,
      fullDepartures: sum((day) => day.fullDepartures),
      bookings: sum((day) => day.bookings),
      passengers: sum((day) => day.passengers),
      faresCents: sum((day) => day.faresCents),
      discountCents: sum((day) => day.discountCents),
      turnedAway: sum((day) => day.turnedAway),
      occupancy: occupancyOf(seatsTaken, seatsOffered),
    },
    // Two days of trade is not a pattern, and pointing at one would send
    // somebody to cancel a Tuesday over a single quiet week.
    best: ran.length >= 2 ? (byOccupancy[0] ?? null) : null,
    worst: ran.length >= 2 ? (byOccupancy.at(-1) ?? null) : null,
  };
}
