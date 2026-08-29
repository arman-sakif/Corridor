import { createUser, type TestDb } from './harness.ts';

/**
 * A realistic operator: the Windsor → Toronto corridor these businesses
 * actually run, with four stops and a matrix of fares where the through trip
 * is deliberately cheaper than the sum of its legs.
 */

export type Corridor = {
  ownerId: string;
  operatorId: string;
  routeId: string;
  scheduleId: string;
  departureId: string;
  /** Stop ids by sequence, 1-based. */
  stops: string[];
  cities: string[];
  serviceDate: string;
};

const FARES_MATRIX: [number, number, number][] = [
  [1, 2, 1500], // Windsor → Chatham
  [2, 3, 2000], // Chatham → London
  [3, 4, 3000], // London → Yorkdale
  [1, 3, 3000], // Windsor → London
  [2, 4, 4000], // Chatham → Yorkdale
  [1, 4, 4500], // Windsor → Yorkdale — NOT 6500
];

export async function seedCorridor(
  test: TestDb,
  {
    maxSeats = 4,
    pricingMode = 'matrix',
    daysAhead = 3,
  }: { maxSeats?: number; pricingMode?: 'matrix' | 'additive'; daysAhead?: number } = {},
): Promise<Corridor> {
  const ownerId = await createUser(test, { email: 'owner@example.com', name: 'Test Owner' });

  const cityNames = ['Windsor', 'Chatham', 'London', 'Toronto'];
  const cities: string[] = [];
  for (const name of cityNames) {
    const [city] = await test.raw<{ id: string }>(
      `insert into public.cities (name) values ($1)
       on conflict (name) do update set name = excluded.name
       returning id`,
      [name],
    );
    cities.push(city!.id);
  }

  // Applying creates a pending operator; the platform activates it.
  const [operator] = await test.asUser<{ id: string }>(
    ownerId,
    `insert into public.operators (name, type, public_phone, status, created_by)
     values ('Harbour Line', 'intercity', '519-555-0111', 'pending', $1)
     returning id`,
    [ownerId],
  );
  const operatorId = operator!.id;

  // Vetting is a platform admin's job, so the seed does it the way the admin
  // dashboard does — through the guard trigger, not around it.
  const adminId = await createUser(test, { email: 'admin@corridor.example', name: 'Platform Admin' });
  await test.raw(`update public.profiles set platform_role = 'admin' where id = $1`, [adminId]);
  await test.asUser(adminId, `update public.operators set status = 'active' where id = $1`, [
    operatorId,
  ]);

  const labels = [
    'Devonshire Mall',
    'Chatham Park Avenue',
    'London White Oaks',
    'Yorkdale Mall',
  ];
  const stops: string[] = [];
  for (const [index, label] of labels.entries()) {
    const [stop] = await test.asUser<{ id: string }>(
      ownerId,
      `insert into public.stops (operator_id, city_id, label) values ($1, $2, $3) returning id`,
      [operatorId, cities[index], label],
    );
    stops.push(stop!.id);
  }

  const [routeId] = await test.asUser<{ save_route: string }>(
    ownerId,
    `select public.save_route($1, null, 'Windsor to Toronto', $2::public.pricing_mode, $3::uuid[])`,
    [operatorId, pricingMode, stops],
  );
  const route = routeId!.save_route;

  const fares =
    pricingMode === 'matrix'
      ? FARES_MATRIX
      : FARES_MATRIX.filter(([from, to]) => to === from + 1);

  for (const [from, to, cents] of fares) {
    await test.asUser(
      ownerId,
      `select public.set_fare($1, $2, $3, $4, 'initial pricing')`,
      [route, from, to, cents],
    );
  }

  const [schedule] = await test.asUser<{ id: string }>(
    ownerId,
    `insert into public.schedules (route_id, departure_time, days_of_week, max_seats, active_from)
     values ($1, '09:00', array[0,1,2,3,4,5,6]::smallint[], $2, current_date)
     returning id`,
    [route, maxSeats],
  );

  await test.asUser(ownerId, `select public.generate_departures($1, 30)`, [operatorId]);

  const [departure] = await test.raw<{ id: string; service_date: string }>(
    `select id, service_date::text from public.departures
      where operator_id = $1 and service_date = (current_date + $2::int)
      limit 1`,
    [operatorId, daysAhead],
  );

  return {
    ownerId,
    operatorId,
    routeId: route,
    scheduleId: schedule!.id,
    departureId: departure!.id,
    stops,
    cities,
    serviceDate: departure!.service_date,
  };
}

export async function passenger(test: TestDb, name: string): Promise<string> {
  return createUser(test, {
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    name,
  });
}

/** Requests a seat and returns the booking id, or throws with the SQL error. */
export async function requestSeat(
  test: TestDb,
  userId: string,
  {
    departureId,
    fromSeq,
    toSeq,
    stops,
    seats = 1,
    luggage = 0,
    note = null,
  }: {
    departureId: string;
    fromSeq: number;
    toSeq: number;
    stops: string[];
    seats?: number;
    luggage?: number;
    note?: string | null;
  },
): Promise<string> {
  const rows = await test.asUser<{ request_booking: string }>(
    userId,
    `select public.request_booking($1, $2, $3, $4, $5, $6)`,
    [departureId, stops[fromSeq - 1], stops[toSeq - 1], seats, luggage, note],
  );
  return rows[0]!.request_booking;
}
