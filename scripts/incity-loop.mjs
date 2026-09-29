/**
 * The in-city local ride, end to end, against the live database.
 *
 *   node scripts/incity-loop.mjs
 *
 * The local ride is the only whole phase nothing exercised. It is also the
 * one feature that crosses two businesses — a passenger arrives on one
 * operator's van and is driven the last few kilometres by another — and every
 * rule holding that together lives in `request_incity_ride()`, because
 * nothing in the schema ties the selling operator to the zone or the pickup
 * point it is sold with. A function is the only thing that can check them, so
 * a function is the only thing worth testing here.
 *
 * The rules, each of which gets a step below:
 *
 *   - It is an add-on to a *confirmed* seat. A hold can still lapse.
 *   - The booking has to be yours.
 *   - The pickup point has to belong to the operator selling the ride, and be
 *     in the city the passenger is actually being dropped in — otherwise a
 *     Toronto shuttle can be booked off a Windsor arrival.
 *   - The zone has to be that operator's, and active. Its price is read from
 *     the row, never taken from the caller.
 *   - One ride per booking.
 *   - Only the selling operator decides, and only while it is waiting.
 *   - Cancelling the intercity seat cancels the local ride with it. Nobody
 *     should be driven from a bus they are no longer on.
 *
 * It borrows the seeded operators rather than building its own, because the
 * in-city side needs a city where an intercity route already arrives. It
 * creates one passenger and up to two bookings, and puts all of it back.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

import { demoPassword } from './local-seed.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const admin = createClient(SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DEMO_PASSWORD = demoPassword();
const TEST_PASSWORD = 'incity-loop-password-123';

let failures = 0;
let step = 0;
const check = (pass, name, detail = '') => {
  step += 1;
  if (!pass) failures += 1;
  console.log(
    `${pass ? ' ok ' : 'FAIL'}  ${String(step).padStart(2)}. ${name}${detail ? ` — ${detail}` : ''}`,
  );
};

const money = (c) => '$' + (c / 100).toFixed(2);

const cleanup = { bookingIds: [], userIds: [] };

async function signIn(email, password) {
  const client = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${email} could not sign in: ${error.message}`);
  return { client, userId: data.user.id };
}

/** The owner of an operator, whoever the seed made that. */
async function ownerOf(operatorId) {
  const { data: member } = await admin
    .from('operator_members')
    .select('user_id')
    .eq('operator_id', operatorId)
    .eq('role', 'owner')
    .limit(1)
    .single();
  const { data: user } = await admin.auth.admin.getUserById(member.user_id);
  return signIn(user.user.email, DEMO_PASSWORD);
}

/**
 * A confirmed seat arriving at `arrivalStopId`, made the way a passenger makes
 * one: request under their own session, approve under the operator's.
 */
async function confirmedSeatTo(passenger, arrivalStopId) {
  const { data: arrivals } = await admin
    .from('route_stops')
    .select('route_id, seq')
    .eq('stop_id', arrivalStopId);

  for (const arrival of arrivals) {
    if (arrival.seq < 2) continue;

    const { data: origin } = await admin
      .from('route_stops')
      .select('stop_id')
      .eq('route_id', arrival.route_id)
      .eq('seq', arrival.seq - 1)
      .maybeSingle();
    if (!origin) continue;

    const { data: departures } = await admin
      .from('departures')
      .select('id, operator_id, service_date')
      .eq('route_id', arrival.route_id)
      .eq('status', 'scheduled')
      .gte('service_date', new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10))
      .limit(5);

    for (const departure of departures ?? []) {
      const { data: bookingId, error } = await passenger.client.rpc('request_booking', {
        p_departure_id: departure.id,
        p_from_stop_id: origin.stop_id,
        p_to_stop_id: arrivalStopId,
        p_seats: 1,
        p_luggage_count: 0,
        p_passenger_note: null,
      });
      if (error) continue;

      cleanup.bookingIds.push(bookingId);
      return { bookingId, operatorId: departure.operator_id };
    }
  }

  throw new Error('could not find a bookable seat arriving at that stop');
}

/* ------------------------------------------------------------------- main */

async function main() {
  console.log('Walking the local ride, against the live database\n');

  /* ---- who is selling what --------------------------------------------- */
  const { data: seller } = await admin
    .from('operators')
    .select(
      'id, name, stops(id, label, is_active, city_id), incity_zones(id, name, flat_price_cents, is_active)',
    )
    .eq('type', 'incity')
    .eq('status', 'active')
    .limit(1)
    .single();

  const pickup = seller.stops.find((s) => s.is_active);
  const zone = seller.incity_zones.find((z) => z.is_active);
  if (!pickup || !zone) throw new Error(`${seller.name} has no active pickup point or zone`);

  console.log(
    `${seller.name} picks up at ${pickup.label} and drives to ${zone.name} for ` +
      `${money(zone.flat_price_cents)}.\n`,
  );

  /* ---- an intercity stop in the same city, belonging to somebody else --- */
  const { data: arrivalStops } = await admin
    .from('stops')
    .select('id, label, operator_id, operator:operators(type, status)')
    .eq('city_id', pickup.city_id)
    .eq('is_active', true)
    .neq('operator_id', seller.id);

  const arrival = arrivalStops.find(
    (s) => s.operator?.type === 'intercity' && s.operator?.status === 'active',
  );
  if (!arrival) throw new Error('no intercity arrival in the city this operator serves');

  /* ---- the passenger --------------------------------------------------- */
  const stamp = Date.now();
  const email = `incity-loop-${stamp}@corridor.test`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Onward Traveller', phone: '416-555-0173' },
  });
  if (createError) throw new Error(`could not create the passenger: ${createError.message}`);
  cleanup.userIds.push(created.user.id);

  const passenger = await signIn(email, TEST_PASSWORD);
  const seat = await confirmedSeatTo(passenger, arrival.id);

  /* ---- 1. a held seat is not enough ------------------------------------ */
  const { error: tooEarly } = await passenger.client.rpc('request_incity_ride', {
    p_booking_id: seat.bookingId,
    p_operator_id: seller.id,
    p_pickup_stop_id: pickup.id,
    p_zone_id: zone.id,
    p_destination_address: '12 Elm Street, buzzer 4',
  });
  check(
    /confirmed/i.test(tooEarly?.message ?? ''),
    'a local ride cannot be added to a seat that is only held',
    tooEarly?.message ?? 'it was allowed',
  );

  /* ---- 2. the operator confirms the seat ------------------------------- */
  const intercityOwner = await ownerOf(seat.operatorId);
  const { error: approveError } = await intercityOwner.client.rpc('approve_booking', {
    p_booking_id: seat.bookingId,
  });
  check(!approveError, 'the intercity operator confirms the seat', approveError?.message);

  /* ---- 3. the wrong operator's pickup point is refused ----------------- */
  // Same city, wrong owner: this isolates the operator check from the city
  // check that follows.
  const { error: wrongOperator } = await passenger.client.rpc('request_incity_ride', {
    p_booking_id: seat.bookingId,
    p_operator_id: seller.id,
    p_pickup_stop_id: arrival.id,
    p_zone_id: zone.id,
    p_destination_address: '12 Elm Street, buzzer 4',
  });
  check(
    /pickup point is not one this operator uses/i.test(wrongOperator?.message ?? ''),
    'a pickup point belonging to another business is refused',
    wrongOperator?.message ?? 'it was allowed',
  );

  /* ---- 4. an empty destination is refused ------------------------------ */
  const { error: noAddress } = await passenger.client.rpc('request_incity_ride', {
    p_booking_id: seat.bookingId,
    p_operator_id: seller.id,
    p_pickup_stop_id: pickup.id,
    p_zone_id: zone.id,
    p_destination_address: '   ',
  });
  check(
    /where you are going/i.test(noAddress?.message ?? ''),
    'and so is a ride with nowhere to go',
    noAddress?.message ?? 'it was allowed',
  );

  /* ---- 5. the ride is booked ------------------------------------------- */
  const { data: rideId, error: rideError } = await passenger.client.rpc('request_incity_ride', {
    p_booking_id: seat.bookingId,
    p_operator_id: seller.id,
    p_pickup_stop_id: pickup.id,
    p_zone_id: zone.id,
    p_destination_address: '12 Elm Street, buzzer 4',
  });
  check(!rideError && Boolean(rideId), 'the passenger adds a local ride onward', rideError?.message);
  if (!rideId) throw new Error('cannot continue without a ride');

  const { data: ride } = await admin
    .from('incity_bookings')
    .select('status, price_cents, destination_address, operator_id')
    .eq('id', rideId)
    .single();
  check(ride?.status === 'held', 'it lands as a request, not a confirmation', ride?.status);
  check(
    ride?.price_cents === zone.flat_price_cents,
    `priced from the zone, at ${money(zone.flat_price_cents)}`,
    money(ride?.price_cents ?? 0),
  );
  check(
    ride?.destination_address === '12 Elm Street, buzzer 4',
    'with the address the passenger typed, trimmed',
    ride?.destination_address,
  );

  /* ---- 6. one to a booking --------------------------------------------- */
  const { error: secondRide } = await passenger.client.rpc('request_incity_ride', {
    p_booking_id: seat.bookingId,
    p_operator_id: seller.id,
    p_pickup_stop_id: pickup.id,
    p_zone_id: zone.id,
    p_destination_address: 'Somewhere else entirely',
  });
  check(
    /already have a local ride/i.test(secondRide?.message ?? ''),
    'a second ride on the same seat is refused',
    secondRide?.message ?? 'it was allowed',
  );

  /* ---- 7. nobody writes the table directly ----------------------------- */
  const { error: directInsert } = await passenger.client.from('incity_bookings').insert({
    booking_id: seat.bookingId,
    operator_id: seller.id,
    pickup_stop_id: pickup.id,
    zone_id: zone.id,
    destination_address: 'Straight past the function',
    price_cents: 1,
    status: 'approved',
  });
  check(
    Boolean(directInsert),
    'and the table itself takes no writes, so nobody can price their own ride',
    directInsert?.message ?? 'the insert went through',
  );

  /* ---- 8. who can see it ----------------------------------------------- */
  const seller_ = await ownerOf(seller.id);
  const { data: sellerView } = await seller_.client
    .from('incity_bookings')
    .select('id, status')
    .eq('id', rideId);
  check(sellerView?.length === 1, 'the in-city operator sees the request');

  const { data: strangerView } = await intercityOwner.client
    .from('incity_bookings')
    .select('id')
    .eq('id', rideId);
  check(
    (strangerView?.length ?? 0) === 0,
    'the operator that carried them there does not',
    `${strangerView?.length ?? 0} rows`,
  );

  /* ---- 9. who can decide ----------------------------------------------- */
  const { error: strangerApprove } = await intercityOwner.client.rpc('approve_incity_ride', {
    p_id: rideId,
  });
  check(
    /only this operator/i.test(strangerApprove?.message ?? ''),
    'and cannot confirm it either',
    strangerApprove?.message ?? 'it was allowed',
  );

  const { error: sellerApprove } = await seller_.client.rpc('approve_incity_ride', { p_id: rideId });
  check(!sellerApprove, 'the in-city operator confirms the ride', sellerApprove?.message);

  const { data: confirmed } = await admin
    .from('incity_bookings')
    .select('status')
    .eq('id', rideId)
    .single();
  check(confirmed?.status === 'approved', 'and it reads as confirmed', confirmed?.status);

  const { error: twice } = await seller_.client.rpc('approve_incity_ride', { p_id: rideId });
  check(
    /no longer waiting/i.test(twice?.message ?? ''),
    'confirming it twice is refused',
    twice?.message ?? 'it was allowed',
  );

  /* ---- 10. a pickup in the wrong city ---------------------------------- */
  // The hazard the function names outright: a Toronto shuttle booked off an
  // arrival somewhere else entirely.
  const { data: elsewhere } = await admin
    .from('stops')
    .select('id, label, city_id, operator:operators!inner(type, status)')
    .neq('city_id', pickup.city_id)
    .eq('is_active', true)
    .eq('operator.type', 'intercity')
    .eq('operator.status', 'active')
    .limit(20);

  let wrongCityMessage = null;
  for (const stop of elsewhere ?? []) {
    let otherSeat;
    try {
      otherSeat = await confirmedSeatTo(passenger, stop.id);
    } catch {
      continue;
    }
    const otherOwner = await ownerOf(otherSeat.operatorId);
    await otherOwner.client.rpc('approve_booking', { p_booking_id: otherSeat.bookingId });

    const { error } = await passenger.client.rpc('request_incity_ride', {
      p_booking_id: otherSeat.bookingId,
      p_operator_id: seller.id,
      p_pickup_stop_id: pickup.id,
      p_zone_id: zone.id,
      p_destination_address: '12 Elm Street, buzzer 4',
    });
    wrongCityMessage = error?.message ?? 'it was allowed';
    break;
  }
  check(
    wrongCityMessage !== null && /city you are arriving in/i.test(wrongCityMessage),
    'a pickup point in a city the passenger is not arriving in is refused',
    wrongCityMessage ?? 'no arrival elsewhere to test with',
  );

  /* ---- 11. cancelling the seat cancels the ride ------------------------ */
  const { error: cancelError } = await passenger.client.rpc('cancel_booking', {
    p_booking_id: seat.bookingId,
  });
  check(!cancelError, 'the passenger cancels the intercity seat', cancelError?.message);

  const { data: afterCancel } = await admin
    .from('incity_bookings')
    .select('status')
    .eq('id', rideId)
    .single();
  check(
    afterCancel?.status === 'cancelled',
    'and the local ride is cancelled with it, without anyone remembering to',
    afterCancel?.status,
  );
}

/* ---------------------------------------------------------------- teardown */

try {
  await main();
} catch (error) {
  failures += 1;
  console.error('\nERROR:', error.message);
} finally {
  // `incity_bookings.booking_id` cascades, so the rides go with the bookings.
  // The bookings go before the account, because `bookings.passenger_id` is
  // `on delete restrict`. Errors are reported: a teardown that does not check
  // is a teardown that leaves test data on production.
  for (const id of cleanup.bookingIds) {
    const { error } = await admin.from('bookings').delete().eq('id', id);
    if (error) console.error(`  could not remove a booking: ${error.message}`);
  }
  for (const id of cleanup.userIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error(`  could not remove the account: ${error.message}`);
  }
  console.log('\nCleaned up: the bookings, their local rides, and the test account.');
}

console.log(failures === 0 ? '\nThe local ride holds together.' : `\n${failures} step(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
