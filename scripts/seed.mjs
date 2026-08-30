/**
 * Seeds the database from the operator notes.
 *
 *   node scripts/seed.mjs           # wipe the seed data and rebuild it
 *   node scripts/seed.mjs --remove  # take it all back out
 *
 * Two things this does not do, on purpose:
 *
 * **It does not invent fares.** Segment prices come from `lib/booking/fares.ts`
 * — the same module the app uses — so a seeded booking's snapshot is computed
 * by the code under test rather than by a second implementation that could
 * drift from it.
 *
 * **It does not oversell.** Bookings are written directly (the service role
 * bypasses RLS, and `bookings` has no insert policy by design), which means
 * `request_booking()` is not there to catch a mistake. So the seeder tracks
 * per-leg load itself and refuses any booking that would exceed a departure's
 * snapshotted `max_seats`. Seed data that violated the central invariant would
 * make every capacity bug impossible to see.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

import {
  CITIES,
  INCITY_OPERATOR,
  OPERATORS,
  PASSENGERS,
  SCHEDULE_DAYS,
  SUBSCRIPTIONS,
} from './seed-data.mjs';
import { segmentBaseCents } from '../lib/booking/fares.ts';
import { addDays, todayInToronto } from '../lib/time.ts';

/* ------------------------------------------------------------------ setup */

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSWORD = 'local-demo-password';
const cents = (dollars) => Math.round(dollars * 100);
const pairKey = (a, b) => [a, b].sort().join('|');

const die = (what, error) => {
  console.error(`\n${what}:`, error?.message ?? error);
  process.exit(1);
};

/** Deterministic pseudo-random, so a reseed produces the same database. */
let seed = 20260829;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const today = new Date();
const isoDate = (offsetDays) =>
  new Date(today.getTime() + offsetDays * 86400000).toISOString().slice(0, 10);

/* ----------------------------------------------------------------- remove */

async function removeAll() {
  const names = [...OPERATORS.map((o) => o.name), INCITY_OPERATOR.name];
  const { data: operators } = await db.from('operators').select('id, name').in('name', names);
  const operatorIds = (operators ?? []).map((o) => o.id);

  if (operatorIds.length) {
    // Order matters here, and only in one place.
    //
    // `departures.route_id` is ON DELETE RESTRICT on purpose: a route with
    // sold departures must not be deletable, or an operator tidying up their
    // routes would take paid bookings with them. So departures have to go
    // before routes. Everything else hangs off CASCADE chains — deleting
    // departures takes their bookings, ratings, flags, and vehicle
    // assignments; deleting routes takes stops, fares, and schedules.
    //
    // Deleting by operator_id rather than by a list of ids is deliberate:
    // PostgREST caps a select at 1000 rows, so listing ids first silently
    // missed two thirds of the departures and the delete then failed against
    // the RESTRICT above.
    const step = async (label, query) => {
      const { error } = await query;
      if (error) die(`Could not remove ${label}`, error);
    };

    await step('departures', db.from('departures').delete().in('operator_id', operatorIds));
    await step('routes', db.from('routes').delete().in('operator_id', operatorIds));
    await step('zones', db.from('incity_zones').delete().in('operator_id', operatorIds));
    await step('stops', db.from('stops').delete().in('operator_id', operatorIds));
    await step('vehicles', db.from('vehicles').delete().in('operator_id', operatorIds));
    await step('team', db.from('operator_members').delete().in('operator_id', operatorIds));
    await step(
      'subscription payments',
      db.from('subscription_payments').delete().in('operator_id', operatorIds),
    );
    await step('subscriptions', db.from('subscriptions').delete().in('operator_id', operatorIds));
    await step('operators', db.from('operators').delete().in('id', operatorIds));
  }

  console.log(`Removed ${operatorIds.length} operators and everything under them.`);

  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  const demoEmails = new Set([
    ...OPERATORS.map((o) => o.ownerEmail),
    ...OPERATORS.flatMap((o) => o.drivers.map(([email]) => email)),
    INCITY_OPERATOR.ownerEmail,
    ...PASSENGERS.map(([name]) => passengerEmail(name)),
  ]);

  let removed = 0;
  for (const user of users?.users ?? []) {
    if (demoEmails.has(user.email)) {
      await db.auth.admin.deleteUser(user.id);
      removed += 1;
    }
  }
  console.log(`Removed ${removed} demo accounts.`);

  const { error: cityError } = await db.from('cities').delete().in(
    'name',
    CITIES.map(([name]) => name),
  );
  if (cityError) die('Could not remove the demo cities', cityError);
  console.log('Removed the demo cities.');
}

function passengerEmail(name) {
  return `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`;
}

/* ------------------------------------------------------------------- seed */

async function ensureUser(email, fullName, { phone = null, gender = null, notes = null } = {}) {
  const { data: existing } = await db.auth.admin.listUsers({ perPage: 1000 });
  let user = existing?.users.find((u) => u.email === email);

  if (!user) {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) die(`Could not create ${email}`, error);
    user = data.user;
  }

  await db
    .from('profiles')
    .update({
      full_name: fullName,
      phone: phone ?? `519-555-${String(between(1000, 9999))}`,
      gender,
      accommodation_notes: notes,
    })
    .eq('id', user.id);

  return user.id;
}

async function seedAll() {
  console.log('Clearing any previous seed…');
  await removeAll();

  /* ---- cities --------------------------------------------------------- */
  const cityId = {};
  for (const [name, province] of CITIES) {
    const { data, error } = await db
      .from('cities')
      .upsert({ name, province }, { onConflict: 'name' })
      .select('id, name')
      .single();
    if (error) die(`Could not create ${name}`, error);
    cityId[name] = data.id;
  }
  console.log(`\n${CITIES.length} cities.`);

  /* ---- accounts, in one pass so listUsers is not called per row -------- */
  const passengerIds = [];
  for (const [name, gender, notes] of PASSENGERS) {
    passengerIds.push(await ensureUser(passengerEmail(name), name, { gender, notes }));
  }
  console.log(`${passengerIds.length} passengers.`);

  const departureRows = [];
  const ratingRows = [];
  const redFlagRows = [];
  let routeCount = 0;
  let scheduleCount = 0;
  let stopCount = 0;

  // Kept so the subscription block below can find each business again by the
  // slug its facts are written under.
  const operatorIdBySlug = {};

  for (const op of OPERATORS) {
    const ownerId = await ensureUser(op.ownerEmail, op.ownerName, { phone: op.phone });

    /* ---- operator ----------------------------------------------------- */
    const { data: operator, error: opError } = await db
      .from('operators')
      .insert({
        name: op.name,
        type: op.type,
        public_phone: op.phone,
        bio: op.bio,
        status: op.status,
        created_by: ownerId,
        free_luggage_per_seat: op.surcharges.freeLuggagePerSeat,
        extra_luggage_cents: cents(op.surcharges.extraLuggage),
        airport_fee_cents: cents(op.surcharges.airportFee),
      })
      .select('id')
      .single();
    if (opError) die(`Could not create ${op.name}`, opError);
    const operatorId = operator.id;
    operatorIdBySlug[op.slug] = operatorId;

    await db
      .from('operator_members')
      .upsert(
        { operator_id: operatorId, user_id: ownerId, role: 'owner' },
        { onConflict: 'operator_id,user_id' },
      );

    /* ---- drivers ------------------------------------------------------- */
    const driverIds = [];
    for (const [email, name] of op.drivers) {
      const driverId = await ensureUser(email, name);
      await db
        .from('operator_members')
        .upsert(
          { operator_id: operatorId, user_id: driverId, role: 'driver' },
          { onConflict: 'operator_id,user_id' },
        );
      driverIds.push(driverId);
    }

    /* ---- stops --------------------------------------------------------- */
    // Keyed by the stop's fare key, not its city: an operator can have two
    // stops in one city (Yorkdale and Pearson are both Toronto) and each needs
    // its own price.
    const stopIdByKey = {};
    for (const stop of op.stops) {
      const { data, error } = await db
        .from('stops')
        .insert({
          operator_id: operatorId,
          city_id: cityId[stop.city],
          label: stop.label,
          description: stop.description ?? null,
          is_airport: stop.isAirport ?? false,
          is_active: true,
        })
        .select('id')
        .single();
      if (error) die(`Could not create the stop ${stop.label}`, error);
      stopIdByKey[stop.key ?? stop.city] = data.id;
      stopCount += 1;
    }

    /* ---- vehicles ------------------------------------------------------ */
    const vehicleIds = [];
    for (const [label, seats] of op.vehicles) {
      const { data, error } = await db
        .from('vehicles')
        .insert({ operator_id: operatorId, label, seat_count: seats, is_active: true })
        .select('id')
        .single();
      if (error) die(`Could not create the vehicle ${label}`, error);
      vehicleIds.push(data.id);
    }

    /* ---- routes, both directions --------------------------------------- */
    const priceByPair = new Map(op.fares.map(([a, b, price]) => [pairKey(a, b), cents(price)]));
    const forwardKeys = op.stops.map((stop) => stop.key ?? stop.city);
    const cityOfKey = new Map(op.stops.map((stop) => [stop.key ?? stop.city, stop.city]));

    for (const direction of ['forward', 'reverse']) {
      const orderedKeys = direction === 'forward' ? forwardKeys : [...forwardKeys].reverse();

      // Named by city, because that is what an operator calls the run.
      const routeName = `${cityOfKey.get(orderedKeys[0])} to ${cityOfKey.get(orderedKeys.at(-1))}`;

      const { data: route, error: routeError } = await db
        .from('routes')
        .insert({
          operator_id: operatorId,
          name: routeName,
          pricing_mode: op.pricingMode,
          is_active: true,
        })
        .select('id')
        .single();
      if (routeError) die(`Could not create the route ${routeName}`, routeError);
      routeCount += 1;

      const { error: rsError } = await db.from('route_stops').insert(
        orderedKeys.map((key, index) => ({
          route_id: route.id,
          stop_id: stopIdByKey[key],
          seq: index + 1,
        })),
      );
      if (rsError) die(`Could not order stops on ${routeName}`, rsError);

      // Resolve each city-pair price to the sequence positions those cities
      // occupy in THIS direction. The document says the reverse mirrors the
      // forward, and a route runs one way, so the same pair yields a fare row
      // on both routes.
      const fareRows = [];
      for (let a = 0; a < orderedKeys.length; a += 1) {
        for (let b = a + 1; b < orderedKeys.length; b += 1) {
          const price = priceByPair.get(pairKey(orderedKeys[a], orderedKeys[b]));
          if (price === undefined) continue;
          // Under additive only consecutive legs are stored; anything longer
          // is summed at read time by lib/booking/fares.ts.
          if (op.pricingMode === 'additive' && b !== a + 1) continue;
          fareRows.push({
            route_id: route.id,
            from_seq: a + 1,
            to_seq: b + 1,
            price_cents: price,
          });
        }
      }

      const { error: fareError } = await db.from('fares').insert(fareRows);
      if (fareError) die(`Could not price ${routeName}`, fareError);

      await db.from('fare_changes').insert(
        fareRows.map((fare) => ({
          route_id: route.id,
          from_seq: fare.from_seq,
          to_seq: fare.to_seq,
          old_price_cents: null,
          new_price_cents: fare.price_cents,
          reason: 'initial pricing',
          changed_by: ownerId,
        })),
      );

      /* ---- schedules --------------------------------------------------- */
      for (const time of op.departures[direction]) {
        const { error } = await db.from('schedules').insert({
          route_id: route.id,
          departure_time: time,
          days_of_week: SCHEDULE_DAYS,
          max_seats: op.maxSeats,
          active_from: isoDate(-40),
        });
        if (error) die(`Could not schedule ${routeName} at ${time}`, error);
        scheduleCount += 1;

        // Departures behind us, so dashboards have finished trips to show.
        // generate_departures only ever looks forward.
        for (let back = 1; back <= 14; back += 1) {
          departureRows.push({
            operator_id: operatorId,
            route_id: route.id,
            schedule_id: null,
            service_date: isoDate(-back),
            departure_time: time,
            max_seats: op.maxSeats,
            status: 'completed',
          });
        }
      }
    }

    console.log(
      `${op.name}: ${op.stops.length} stops, 2 routes, ${op.vehicles.length} vehicles` +
        (op.status === 'pending' ? ' (pending — invisible in search)' : ''),
    );

    // Stash what the booking pass needs.
    op._runtime = { operatorId, stopIdByKey, vehicleIds, driverIds, ownerId };
  }

  /* ---- past departures, inserted directly ----------------------------- */
  for (let i = 0; i < departureRows.length; i += 500) {
    const { error } = await db.from('departures').insert(departureRows.slice(i, i + 500));
    if (error) die('Could not create past departures', error);
  }
  console.log(`\n${departureRows.length} past departures.`);

  /* ---- future departures, through the real generator ------------------ */
  const { error: genError } = await db.rpc('generate_departures', {
    p_operator_id: null,
    p_days: 30,
  });
  if (genError) die('Could not generate departures', genError);

  const { count: departureCount } = await db
    .from('departures')
    .select('id', { count: 'exact', head: true });
  console.log(`${departureCount} departures in total (rolling 30 days forward).`);

  /* ---- in-city (Phase 6 tables) --------------------------------------- */
  const incityOwner = await ensureUser(INCITY_OPERATOR.ownerEmail, INCITY_OPERATOR.ownerName, {
    phone: INCITY_OPERATOR.phone,
  });
  const { data: incityOp, error: incityError } = await db
    .from('operators')
    .insert({
      name: INCITY_OPERATOR.name,
      type: INCITY_OPERATOR.type,
      public_phone: INCITY_OPERATOR.phone,
      bio: INCITY_OPERATOR.bio,
      status: INCITY_OPERATOR.status,
      created_by: incityOwner,
    })
    .select('id')
    .single();
  if (incityError) die('Could not create the in-city operator', incityError);

  // The pickup points come first: matching is by city, so an in-city operator
  // with no stop anywhere is offered to nobody however many zones it prices.
  const { error: pickupError } = await db.from('stops').insert(
    INCITY_OPERATOR.pickups.map((pickup) => ({
      operator_id: incityOp.id,
      city_id: cityId[pickup.city],
      label: pickup.label,
      description: pickup.description ?? null,
      is_active: true,
    })),
  );
  if (pickupError) die('Could not create the in-city pickup points', pickupError);

  await db.from('incity_zones').insert(
    INCITY_OPERATOR.zones.map(([name, price]) => ({
      operator_id: incityOp.id,
      name,
      flat_price_cents: cents(price),
      is_active: true,
    })),
  );
  console.log(`${INCITY_OPERATOR.name}: ${INCITY_OPERATOR.zones.length} zones (Phase 6 tables).`);

  /* ---- subscriptions ---------------------------------------------------- */
  // Never seeded before, so every environment opened /admin/subscriptions to
  // seven operators and no data, and the past-due warning had no way to be
  // seen at all without editing the database by hand. Second Line is overdue on
  // purpose. Pending Line is absent on purpose — an operator with no subscription
  // row is a state the screens have to render too.
  const slugToOperator = { ...operatorIdBySlug, [INCITY_OPERATOR.slug]: incityOp.id };
  let subscriptionCount = 0;

  for (const [slug, plan] of Object.entries(SUBSCRIPTIONS)) {
    const id = slugToOperator[slug];
    if (!id) continue;

    const paidThrough = addDays(todayInToronto(), plan.paidThrough);

    const { error: subError } = await db.from('subscriptions').insert({
      operator_id: id,
      plan: plan.plan,
      status: plan.status,
      amount_cents: cents(plan.amount),
      current_period_end: paidThrough,
    });
    if (subError) die(`Could not create the subscription for ${slug}`, subError);

    // One payment behind each, so an operator opening Billing sees a history
    // rather than an empty table under a number they are being asked to pay.
    await db.from('subscription_payments').insert({
      operator_id: id,
      amount_cents: cents(plan.amount),
      paid_on: addDays(paidThrough, plan.plan === 'weekly' ? -7 : -30),
      covers_until: paidThrough,
      note: 'e-transfer',
    });

    subscriptionCount += 1;
  }

  console.log(`${subscriptionCount} subscriptions, one of them past due.`);

  /* ---- bookings -------------------------------------------------------- */
  await seedBookings({ passengerIds, ratingRows, redFlagRows });

  console.log(`\nSummary`);
  console.log(`  cities      ${CITIES.length}`);
  console.log(`  operators   ${OPERATORS.length + 1}`);
  // stopCount is tallied in the intercity loop, which runs before the in-city
  // operator exists. Its pickup points are stops too, so counting them here
  // keeps the summary honest rather than two short.
  console.log(`  stops       ${stopCount + INCITY_OPERATOR.pickups.length}`);
  console.log(`  zones       ${INCITY_OPERATOR.zones.length}`);
  console.log(`  routes      ${routeCount}`);
  console.log(`  schedules   ${scheduleCount}`);
  console.log(`  departures  ${departureCount}`);
  console.log(`\nEvery account signs in with the password: ${PASSWORD}`);
}

/* --------------------------------------------------------------- bookings */

/**
 * Writes bookings across every status, tracking per-leg load so nothing is
 * ever oversold. `request_booking()` is not in the loop here, so this is the
 * only thing standing between the seed and a database state the app itself
 * would have refused to create.
 */
async function seedBookings({ passengerIds, ratingRows, redFlagRows }) {
  // PostgREST caps a select at 1000 rows, and there are more departures than
  // that, so this pages rather than silently seeing two thirds of them.
  const departures = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await db
      .from('departures')
      .select('id, operator_id, route_id, service_date, max_seats, status')
      .order('service_date')
      .range(page * 1000, page * 1000 + 999);
    if (error) die('Could not read departures', error);
    departures.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const { data: routeStops } = await db
    .from('route_stops')
    .select('route_id, stop_id, seq, stop:stops(is_airport)');
  const { data: routes } = await db.from('routes').select('id, pricing_mode');
  const { data: fares } = await db.from('fares').select('route_id, from_seq, to_seq, price_cents');
  const { data: operators } = await db
    .from('operators')
    .select('id, free_luggage_per_seat, extra_luggage_cents, airport_fee_cents, status');

  const stopsByRoute = new Map();
  for (const rs of routeStops) {
    const list = stopsByRoute.get(rs.route_id) ?? [];
    list.push({ ...rs, is_airport: rs.stop?.is_airport ?? false });
    stopsByRoute.set(rs.route_id, list);
  }
  for (const list of stopsByRoute.values()) list.sort((a, b) => a.seq - b.seq);

  const faresByRoute = new Map();
  for (const fare of fares) {
    const list = faresByRoute.get(fare.route_id) ?? [];
    list.push(fare);
    faresByRoute.set(fare.route_id, list);
  }

  const modeByRoute = new Map(routes.map((r) => [r.id, r.pricing_mode]));
  const operatorById = new Map(operators.map((o) => [o.id, o]));

  /** departureId -> seats taken on each leg, indexed from seq 1. */
  const load = new Map();
  const legLoad = (departureId, stopCount) => {
    if (!load.has(departureId)) load.set(departureId, new Array(stopCount + 1).fill(0));
    return load.get(departureId);
  };

  const todayIso = isoDate(0);
  const rows = [];

  const PAST_STATUSES = ['settled', 'settled', 'settled', 'completed', 'no_show', 'cancelled_by_passenger'];
  const FUTURE_STATUSES = ['approved', 'approved', 'approved', 'held', 'declined', 'expired', 'cancelled_by_passenger'];

  for (const departure of departures) {
    // Pending operators get no bookings: nobody could have booked them.
    if (operatorById.get(departure.operator_id)?.status !== 'active') continue;

    const stops = stopsByRoute.get(departure.route_id) ?? [];
    if (stops.length < 2) continue;

    const isPast = departure.service_date < todayIso;

    // Most departures on a rolling 30-day window have nothing booked yet —
    // that is what a real book looks like, and a database where every
    // departure is busy hides exactly the empty states the UI has to handle.
    // Past departures carry more, because they actually ran.
    const chance = isPast ? 0.2 : 0.08;
    if (rand() > chance) continue;
    const attempts = between(1, 3);

    for (let i = 0; i < attempts; i += 1) {
      const fromSeq = between(1, stops.length - 1);
      const toSeq = between(fromSeq + 1, stops.length);
      const seats = rand() < 0.75 ? 1 : between(2, 3);

      const mode = modeByRoute.get(departure.route_id);
      const routeFares = faresByRoute.get(departure.route_id) ?? [];
      const perSeat = segmentBaseCents(mode, routeFares, fromSeq, toSeq);
      // Unpriced segment: the operator does not sell it, so nobody booked it.
      if (perSeat === null) continue;

      const status = isPast ? pick(PAST_STATUSES) : pick(FUTURE_STATUSES);
      const occupies = ['approved', 'completed', 'settled', 'held'].includes(status);

      const legs = legLoad(departure.id, stops.length);
      if (occupies) {
        let fits = true;
        for (let leg = fromSeq; leg < toSeq; leg += 1) {
          if (legs[leg] + seats > departure.max_seats) fits = false;
        }
        if (!fits) continue;
        for (let leg = fromSeq; leg < toSeq; leg += 1) legs[leg] += seats;
      }

      const operator = operatorById.get(departure.operator_id);
      const luggage = between(0, 3);
      const extraBags = Math.max(0, luggage - operator.free_luggage_per_seat * seats);
      const luggageCents = extraBags * operator.extra_luggage_cents;
      const baseCents = perSeat * seats;
      // Either end being an airport adds the operator's flat fee per seat,
      // exactly as request_booking() computes it.
      const touchesAirport =
        stops[fromSeq - 1].is_airport === true || stops[toSeq - 1].is_airport === true;
      const airportCents = touchesAirport ? operator.airport_fee_cents * seats : 0;

      const passengerId = pick(passengerIds);

      rows.push({
        departure_id: departure.id,
        passenger_id: passengerId,
        from_stop_id: stops[fromSeq - 1].stop_id,
        to_stop_id: stops[toSeq - 1].stop_id,
        from_seq: fromSeq,
        to_seq: toSeq,
        seats,
        status,
        // A live hold is the only status still on a clock.
        hold_expires_at:
          status === 'held' ? new Date(Date.now() + between(5, 55) * 60000).toISOString() : null,
        luggage_count: luggage,
        base_cents: baseCents,
        luggage_cents: luggageCents,
        airport_cents: airportCents,
        total_cents: baseCents + luggageCents + airportCents,
        passenger_note: rand() < 0.15 ? pick(NOTES) : null,
        payment_method: status === 'settled' ? pick(['cash', 'cash', 'etransfer']) : null,
        passenger_confirmed_at: status === 'settled' ? new Date().toISOString() : null,
        driver_confirmed_at: status === 'settled' ? new Date().toISOString() : null,
        approved_at: ['approved', 'completed', 'settled', 'no_show'].includes(status)
          ? new Date().toISOString()
          : null,
        cancelled_at: status.startsWith('cancelled') ? new Date().toISOString() : null,
      });
    }
  }

  /* ---- the state most likely to expose a capacity bug ------------------ */
  // A departure full on its MIDDLE leg while both ends stay open. On this one
  // Windsor→Toronto must be refused, yet Windsor→Chatham and London→Toronto
  // are still for sale — which is the per-leg model doing the one thing
  // per-departure capacity cannot.
  //
  // Random bookings almost never produce this, and it is the single most
  // useful row in the seed, so it is built on purpose.
  const harbour = OPERATORS.find((o) => o.slug === 'harbour-line');
  const showcase = departures.find(
    (d) =>
      d.operator_id === harbour?._runtime?.operatorId &&
      d.service_date > todayIso &&
      (stopsByRoute.get(d.route_id) ?? []).length >= 5 &&
      (load.get(d.id) ?? []).every((n) => !n),
  );

  if (!showcase) {
    console.warn('  (no free Harbour departure found for the showcase scenario)');
  } else {
    const stops = stopsByRoute.get(showcase.route_id);
    const routeFares = faresByRoute.get(showcase.route_id) ?? [];
    // Chatham → London is seq 2 → 3, so it occupies leg 2 and nothing else.
    const perSeat = segmentBaseCents(modeByRoute.get(showcase.route_id), routeFares, 2, 3);

    if (perSeat === null) {
      console.warn('  (Chatham→London is unpriced, so the showcase was skipped)');
    } else {
      const legs = legLoad(showcase.id, stops.length);
      for (let i = 0; i < showcase.max_seats; i += 1) {
        rows.push({
          departure_id: showcase.id,
          passenger_id: passengerIds[i % passengerIds.length],
          from_stop_id: stops[1].stop_id,
          to_stop_id: stops[2].stop_id,
          from_seq: 2,
          to_seq: 3,
          seats: 1,
          status: 'approved',
          hold_expires_at: null,
          luggage_count: 1,
          base_cents: perSeat,
          luggage_cents: 0,
          airport_cents: 0,
          total_cents: perSeat,
          passenger_note: null,
          payment_method: null,
          passenger_confirmed_at: null,
          driver_confirmed_at: null,
          approved_at: new Date().toISOString(),
          cancelled_at: null,
        });
        legs[2] += 1;
      }
      console.log(
        `\nShowcase: ${showcase.service_date} ${stops[0].seq === 1 ? 'Windsor→Toronto' : ''} ` +
          `is full on Chatham→London (${showcase.max_seats}/${showcase.max_seats} on that leg) ` +
          `while both ends stay open.`,
      );
    }
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('bookings').insert(rows.slice(i, i + 500));
    if (error) die('Could not create bookings', error);
  }
  console.log(`${rows.length} bookings across every status.`);

  // Ratings and a couple of red flags, so the reputation surfaces are not bare.
  const { data: settled } = await db
    .from('bookings')
    .select('id, passenger_id, departure:departures(operator_id)')
    .in('status', ['settled', 'no_show'])
    .limit(120);

  for (const booking of settled ?? []) {
    const operatorId = booking.departure?.operator_id;
    if (!operatorId) continue;

    if (rand() < 0.45) {
      ratingRows.push({
        booking_id: booking.id,
        direction: 'passenger_to_operator',
        rater_id: booking.passenger_id,
        operator_id: operatorId,
        passenger_id: booking.passenger_id,
        score: rand() < 0.75 ? 5 : between(3, 4),
        comment: rand() < 0.5 ? pick(REVIEWS) : null,
      });
    }
  }

  const { data: noShows } = await db
    .from('bookings')
    .select('id, passenger_id, departure:departures(operator_id)')
    .eq('status', 'no_show')
    .limit(12);

  for (const booking of noShows ?? []) {
    if (!booking.departure?.operator_id) continue;
    redFlagRows.push({
      booking_id: booking.id,
      operator_id: booking.departure.operator_id,
      passenger_id: booking.passenger_id,
      reason: 'no_show',
      note: 'Did not turn up at the pickup point and did not answer the phone.',
    });
  }

  if (ratingRows.length) {
    const { error } = await db.from('ratings').insert(ratingRows);
    if (error) die('Could not create ratings', error);
  }
  if (redFlagRows.length) {
    const { error } = await db.from('red_flags').insert(redFlagRows);
    if (error) die('Could not create red flags', error);
  }
  console.log(`${ratingRows.length} ratings, ${redFlagRows.length} red flags.`);
}

const NOTES = [
  'Front seat if possible please',
  'Female driver preferred',
  'Travelling with a large suitcase',
  'Will be waiting by the main doors',
  'Might be five minutes late, please call',
];

const REVIEWS = [
  'Left on time and the driver was helpful with bags.',
  'Comfortable van, good communication the day before.',
  'Straightforward trip, would book again.',
  'Driver called ahead to confirm the pickup point.',
  'Ran a little late leaving but made it up on the 401.',
];

/* ------------------------------------------------------------------- main */

if (process.argv.includes('--remove')) {
  await removeAll();
} else {
  await seedAll();
}
