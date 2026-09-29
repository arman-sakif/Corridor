/**
 * Getting a brand-new operator on sale, end to end, against the deployed app.
 *
 *   node scripts/operator-loop.mjs
 *   node scripts/operator-loop.mjs --url http://localhost:3000
 *
 * `e2e-loop.mjs` starts from an operator that is already trading: seeded
 * stops, a priced route, a timetable, departures. Everything *before* that —
 * the path the first real customer walks on their first afternoon — had never
 * been run in sequence. This walks it: apply, be vetted, name three stops,
 * build a route, price it, put it on a timetable, and end where it matters,
 * with a stranger finding the departure in search at the price the owner
 * typed and being charged exactly that.
 *
 * The route has three stops rather than two on purpose, because that is the
 * smallest shape that can tell the two silent rules apart:
 *
 *   - **Capacity is per leg.** Four seats sold from the first stop to the
 *     second and four more from the second to the third is eight seats on a
 *     four-seat van, and correct. A two-stop route cannot distinguish that
 *     from per-departure capacity.
 *   - **A matrix fare is not the sum of its legs.** The through price here is
 *     deliberately *cheaper* than the two legs added up, which is the everyday
 *     case these businesses price for, and the shape that catches anything
 *     deriving a segment price by addition. The route is then switched to
 *     `additive`, where the same trip must cost the legs — and the stale
 *     through-fare row must be ignored rather than preferred.
 *
 * Each act is taken by the role that really takes it, under that role's own
 * session and therefore its own RLS. The platform admin has no password here,
 * so their session is minted the way the notes describe: a magic link for an
 * address that already exists, redeemed for a session.
 *
 * Everything it creates, it removes — the operator, which cascades to its
 * stops, routes, schedules, departures and bookings, and the two accounts —
 * including when a step fails.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

import { adminEmail } from './local-seed.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const URL_ARG = process.argv.indexOf('--url');
const SITE = URL_ARG !== -1 ? process.argv[URL_ARG + 1] : 'https://corridor-cyan.vercel.app';
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const admin = createClient(SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ADMIN_EMAIL = adminEmail();
const TEST_PASSWORD = 'operator-loop-password-123';

/** $52.50 end to end — a price no seed data uses, so finding it proves it came from here. */
const FARE_CENTS = 5250;

/** $37.50 a leg, so the two legs add up to $75 and the through fare does not. */
const LEG_CENTS = 3750;

/** Small enough that two bookings can fill different legs of the same van. */
const MAX_SEATS = 4;

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

const cleanup = { operatorId: null, userIds: [] };

/* --------------------------------------------------------------- sessions */

async function signIn(email, password) {
  const client = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${email} could not sign in: ${error.message}`);
  return { client, userId: data.user.id };
}

/**
 * A session for somebody whose password this script has no business knowing.
 * `generateLink` would CREATE an unknown address, so this is only ever
 * pointed at the admin account, which exists.
 */
async function signInAsAdmin(email) {
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkError) throw new Error(`could not mint an admin link: ${linkError.message}`);

  const client = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  });
  if (error) throw new Error(`the admin link would not redeem: ${error.message}`);
  return { client, userId: data.user.id };
}

/** A new person, made the way signup makes one. */
async function newAccount(email, fullName, phone) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone },
  });
  if (error) throw new Error(`could not create ${email}: ${error.message}`);
  cleanup.userIds.push(data.user.id);
  return data.user.id;
}

/* ------------------------------------------------------------------- main */

async function main() {
  console.log(`Putting a new operator on sale, against ${SITE}\n`);

  const stamp = Date.now();
  const anon = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /* ---- three cities to run between ------------------------------------- */
  // Three, not two, because a two-stop route cannot tell the two rules that
  // matter apart: on one leg, per-leg capacity is indistinguishable from
  // per-departure capacity, and a through fare has no legs to be summed by
  // mistake.
  const { data: cities } = await admin
    .from('cities')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
    .limit(3);
  if ((cities?.length ?? 0) < 3) throw new Error('need three active cities to build a route');
  const [from, middle, to] = cities;

  /* ---- 1. somebody applies --------------------------------------------- */
  const ownerEmail = `operator-loop-owner-${stamp}@corridor.test`;
  await newAccount(ownerEmail, 'Ada Nwosu', '519-555-0166');
  const owner = await signIn(ownerEmail, TEST_PASSWORD);

  const businessName = `Loop Coach Lines ${stamp}`;
  const { data: applied, error: applyError } = await owner.client
    .from('operators')
    .insert({
      name: businessName,
      type: 'intercity',
      public_phone: '519-555-0166',
      bio: 'A test business that no passenger should ever see.',
      status: 'pending',
      created_by: owner.userId,
    })
    .select('id, status')
    .single();

  check(!applyError && Boolean(applied), 'somebody applies to run a business', applyError?.message);
  if (!applied) throw new Error('cannot continue without an operator');
  cleanup.operatorId = applied.id;

  check(applied.status === 'pending', 'it lands as pending, not live', applied.status);

  const { data: membership } = await admin
    .from('operator_members')
    .select('role')
    .eq('operator_id', applied.id)
    .eq('user_id', owner.userId)
    .maybeSingle();
  check(
    membership?.role === 'owner',
    'and the trigger makes the applicant its owner',
    membership?.role,
  );

  /* ---- 2. and stays invisible until vetted ----------------------------- */
  const { data: publicView } = await anon.from('operators').select('id').eq('id', applied.id);
  check((publicView?.length ?? 0) === 0, 'a passenger cannot see it yet');

  await owner.client.from('operators').update({ status: 'active' }).eq('id', applied.id);
  const { data: stillPending } = await admin
    .from('operators')
    .select('status')
    .eq('id', applied.id)
    .single();
  // A denied UPDATE does not raise. It changes nothing and reports success,
  // so the assertion is on the value, not on a rejection.
  check(
    stillPending.status === 'pending',
    'and the owner cannot wave themselves through',
    stillPending.status,
  );

  /* ---- 3. an admin vets it --------------------------------------------- */
  const platformAdmin = await signInAsAdmin(ADMIN_EMAIL);
  const { error: vetError } = await platformAdmin.client
    .from('operators')
    .update({ status: 'active' })
    .eq('id', applied.id);
  const { data: vetted } = await admin
    .from('operators')
    .select('status')
    .eq('id', applied.id)
    .single();
  check(
    vetted.status === 'active',
    'a platform admin activates it',
    vetError?.message ?? vetted.status,
  );

  /* ---- 4. the owner names three pickup points -------------------------- */
  const { data: stops, error: stopError } = await owner.client
    .from('stops')
    .insert([
      {
        operator_id: applied.id,
        city_id: from.id,
        label: 'Loop Test Depot',
        description: 'By the ticket machine',
      },
      { operator_id: applied.id, city_id: middle.id, label: 'Loop Test Midway' },
      { operator_id: applied.id, city_id: to.id, label: 'Loop Test Arrivals' },
    ])
    .select('id, city_id, label');

  check(
    !stopError && stops?.length === 3,
    'the owner names three pickup points',
    stopError?.message,
  );
  if (stops?.length !== 3) throw new Error('cannot build a route without stops');

  const origin = stops.find((s) => s.city_id === from.id);
  const midway = stops.find((s) => s.city_id === middle.id);
  const destination = stops.find((s) => s.city_id === to.id);

  /* ---- 5. and builds a route out of them ------------------------------- */
  const { data: routeId, error: routeError } = await owner.client.rpc('save_route', {
    p_operator_id: applied.id,
    p_route_id: null,
    p_name: `${from.name} to ${to.name}`,
    p_pricing_mode: 'matrix',
    p_stop_ids: [origin.id, midway.id, destination.id],
  });
  check(!routeError && Boolean(routeId), 'and builds a route out of them', routeError?.message);
  if (!routeId) throw new Error('cannot continue without a route');

  const { data: routeStops } = await admin
    .from('route_stops')
    .select('seq, stop_id')
    .eq('route_id', routeId)
    .order('seq');
  check(
    routeStops?.length === 3 && routeStops[0].stop_id === origin.id && routeStops[2].stop_id === destination.id,
    'in the order the van drives them',
    routeStops?.map((s) => s.seq).join(', '),
  );

  /* ---- 6. prices it, the way these businesses really price ------------- */
  // The through fare is deliberately less than its two legs added up. That is
  // the everyday case under `matrix` — Windsor to Toronto costs less than
  // Windsor→London plus London→Toronto — and it is the one shape that catches
  // anything that derives a segment price by summing legs.
  for (const [fromSeq, toSeq, cents, reason] of [
    [1, 2, LEG_CENTS, 'opening price'],
    [2, 3, LEG_CENTS, 'opening price'],
    [1, 3, FARE_CENTS, 'through fare, cheaper than the two legs'],
  ]) {
    const { error } = await owner.client.rpc('set_fare', {
      p_route_id: routeId,
      p_from_seq: fromSeq,
      p_to_seq: toSeq,
      p_price_cents: cents,
      p_reason: reason,
    });
    if (error) throw new Error(`could not price ${fromSeq}→${toSeq}: ${error.message}`);
  }
  check(
    true,
    `prices each leg at ${money(LEG_CENTS)} and the whole run at ${money(FARE_CENTS)}`,
    `not ${money(LEG_CENTS * 2)}`,
  );

  const { data: audit } = await admin
    .from('fare_changes')
    .select('new_price_cents, reason')
    .eq('route_id', routeId);
  check(
    audit?.length === 3 && audit.every((row) => Boolean(row.reason)),
    'and every change goes on the record, with the reason given',
    `${audit?.length} recorded`,
  );

  /* ---- 7. puts it on a timetable --------------------------------------- */
  const activeFrom = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }),
  )
    .toISOString()
    .slice(0, 10);

  const { error: scheduleError } = await owner.client.from('schedules').insert({
    route_id: routeId,
    departure_time: '06:30',
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    max_seats: MAX_SEATS,
    active_from: activeFrom,
  });
  check(!scheduleError, 'puts it on a timetable, every day at 6:30am', scheduleError?.message);

  /* ---- 8. and departures appear ---------------------------------------- */
  const { data: generated, error: generateError } = await owner.client.rpc('generate_departures', {
    p_operator_id: applied.id,
    p_days: 30,
  });
  check(
    !generateError && generated > 0,
    'departures go on sale for the next 30 days',
    `${generated} created`,
  );

  const { data: again } = await owner.client.rpc('generate_departures', {
    p_operator_id: applied.id,
    p_days: 30,
  });
  check(
    again === 0,
    'and running it again creates nothing, so a missed night costs nothing',
    `${again} created`,
  );

  const { data: departures } = await admin
    .from('departures')
    .select('id, service_date, departure_time, max_seats, status')
    .eq('operator_id', applied.id)
    .order('service_date');
  check(
    departures?.length > 0 && departures.every((d) => d.max_seats === MAX_SEATS),
    'each one carrying the seat count it was published with',
    `${departures?.length} departures`,
  );

  /* ---- 9. a stranger can find it --------------------------------------- */
  // Tomorrow onwards. Today's 06:30 has usually already left, and
  // `request_booking` rightly refuses a departure in the past — which would
  // fail the capacity steps below for a reason that has nothing to do with
  // capacity.
  const bookable = departures.filter((d) => d.service_date > activeFrom);
  if (bookable.length < 3) throw new Error('need three future departures to test pricing and capacity');
  const [target, other] = bookable;
  const searchUrl = `${SITE}/search?from=${from.id}&to=${to.id}&date=${target.service_date}`;
  const searchPage = await fetch(searchUrl);
  const html = await searchPage.text();

  check(
    searchPage.status === 200,
    'search answers for that city pair and date',
    String(searchPage.status),
  );
  check(html.includes(businessName), 'and the new business is on it', businessName);
  check(
    html.includes(money(FARE_CENTS)),
    `at the price its owner typed, ${money(FARE_CENTS)}`,
    html.includes(money(FARE_CENTS)) ? '' : 'the price is not on the page',
  );

  /* ---- 10. and book the whole run at the through price ----------------- */
  const passengerEmail = `operator-loop-rider-${stamp}@corridor.test`;
  const passengerId = await newAccount(passengerEmail, 'Loop Rider', '519-555-0188');
  const passenger = await signIn(passengerEmail, TEST_PASSWORD);

  const { data: bookingId, error: bookingError } = await passenger.client.rpc('request_booking', {
    p_departure_id: target.id,
    p_from_stop_id: origin.id,
    p_to_stop_id: destination.id,
    p_seats: 2,
    p_luggage_count: 0,
    p_passenger_note: null,
  });
  check(
    !bookingError && Boolean(bookingId),
    'a stranger requests two seats end to end',
    bookingError?.message,
  );

  const { data: booking } = await admin
    .from('bookings')
    .select('status, base_cents, total_cents, seats, from_seq, to_seq')
    .eq('id', bookingId)
    .single();
  check(
    booking?.total_cents === FARE_CENTS * 2,
    `and is charged the through fare, ${money(FARE_CENTS * 2)}, not the legs added up`,
    `${money(booking?.total_cents ?? 0)} against ${money(LEG_CENTS * 2 * 2)}`,
  );
  check(
    booking?.from_seq === 1 && booking?.to_seq === 3,
    'with the stop positions written onto the booking',
    `${booking?.from_seq} → ${booking?.to_seq}`,
  );

  /* ---- 11. capacity is per leg, not per departure ---------------------- */
  // A different departure, so the through booking above is not in the way.
  // Four seats from the first stop to the second, then four more from the
  // second to the third: eight seats sold on a four-seat van, and correct,
  // because no single stretch of road carries more than four.
  const { error: firstLegError } = await passenger.client.rpc('request_booking', {
    p_departure_id: other.id,
    p_from_stop_id: origin.id,
    p_to_stop_id: midway.id,
    p_seats: MAX_SEATS,
    p_luggage_count: 0,
    p_passenger_note: null,
  });
  check(!firstLegError, 'somebody takes every seat on the first leg', firstLegError?.message);

  const { error: secondLegError } = await passenger.client.rpc('request_booking', {
    p_departure_id: other.id,
    p_from_stop_id: midway.id,
    p_to_stop_id: destination.id,
    p_seats: MAX_SEATS,
    p_luggage_count: 0,
    p_passenger_note: null,
  });
  check(
    !secondLegError,
    'and somebody else takes every seat on the second, on the same van',
    secondLegError?.message ?? `${MAX_SEATS * 2} seats sold on a ${MAX_SEATS}-seat run`,
  );

  const { error: throughError } = await passenger.client.rpc('request_booking', {
    p_departure_id: other.id,
    p_from_stop_id: origin.id,
    p_to_stop_id: destination.id,
    p_seats: 1,
    p_luggage_count: 0,
    p_passenger_note: null,
  });
  // On the reason, not merely on a refusal. A departure that had already left
  // refused this too, and read as a pass until the message was looked at.
  check(
    /seats/i.test(throughError?.message ?? ''),
    'but nobody can ride it end to end, because both legs are full',
    throughError?.message ?? 'it was allowed',
  );

  /* ---- 12. and the owner sees the requests ----------------------------- */
  const { data: queue } = await owner.client
    .from('bookings')
    .select('id, status, seats, departures!inner(operator_id)')
    .eq('departures.operator_id', applied.id);
  check(
    queue?.length === 3 && queue.every((row) => row.status === 'held'),
    'the owner sees all three seat requests waiting',
    `${queue?.length ?? 0} waiting`,
  );

  const { data: history } = await owner.client.rpc('passenger_history', {
    p_passenger_id: passengerId,
  });
  check(
    history?.[0]?.completed === 0 && history?.[0]?.red_flags === 0,
    'with a clean history on the person asking',
  );

  /* ---- 13. the other way of pricing ------------------------------------ */
  // `additive` is the mode where a through trip costs the legs it spans, added
  // up. The route already has a 1→3 row from when it was `matrix`, and that
  // row must now be ignored rather than preferred — a stale price is exactly
  // what an operator switching modes leaves behind.
  const { error: switchError } = await owner.client.rpc('save_route', {
    p_operator_id: applied.id,
    p_route_id: routeId,
    p_name: `${from.name} to ${to.name}`,
    p_pricing_mode: 'additive',
    p_stop_ids: [origin.id, midway.id, destination.id],
  });
  check(!switchError, 'the owner switches the route to pricing by the leg', switchError?.message);

  const third = bookable[2];
  const { data: additiveBooking, error: additiveError } = await passenger.client.rpc(
    'request_booking',
    {
      p_departure_id: third.id,
      p_from_stop_id: origin.id,
      p_to_stop_id: destination.id,
      p_seats: 1,
      p_luggage_count: 0,
      p_passenger_note: null,
    },
  );
  check(!additiveError, 'somebody books the whole run again', additiveError?.message);

  const { data: summed } = await admin
    .from('bookings')
    .select('total_cents')
    .eq('id', additiveBooking)
    .single();
  check(
    summed?.total_cents === LEG_CENTS * 2,
    `and is charged the two legs added up, ${money(LEG_CENTS * 2)}`,
    `${money(summed?.total_cents ?? 0)}, with the old through fare at ${money(FARE_CENTS)}`,
  );

  const additiveSearch = await fetch(
    `${SITE}/search?from=${from.id}&to=${to.id}&date=${third.service_date}`,
  );
  const additiveHtml = await additiveSearch.text();
  check(
    additiveHtml.includes(money(LEG_CENTS * 2)),
    'and search quotes the same number it will charge',
    additiveHtml.includes(money(LEG_CENTS * 2)) ? '' : 'the page does not show it',
  );
}

/* ---------------------------------------------------------------- teardown */

/**
 * Taking an operator apart, in the order the foreign keys allow.
 *
 * Deleting the operator alone does not work, and fails in a way worth
 * remembering: the cascade reaches `stops` before the cascade through
 * `routes` has cleared `route_stops`, and `route_stops.stop_id` is `on delete
 * restrict`, so Postgres refuses the whole thing. The first version of this
 * script discarded that error and reported a clean-up it had not done, which
 * left five test businesses on the production database.
 *
 * Departures hold `route_id` with `on delete restrict` for the same reason, so
 * they go before the routes do.
 */
async function removeOperator(operatorId) {
  const { data: routes } = await admin.from('routes').select('id').eq('operator_id', operatorId);
  const routeIds = (routes ?? []).map((r) => r.id);

  const steps = [
    ['departures', admin.from('departures').delete().eq('operator_id', operatorId)],
    routeIds.length > 0
      ? ['schedules', admin.from('schedules').delete().in('route_id', routeIds)]
      : null,
    ['routes', admin.from('routes').delete().eq('operator_id', operatorId)],
    ['stops', admin.from('stops').delete().eq('operator_id', operatorId)],
    ['operator', admin.from('operators').delete().eq('id', operatorId)],
  ].filter(Boolean);

  for (const [what, query] of steps) {
    const { error } = await query;
    if (error) console.error(`  could not remove the ${what}: ${error.message}`);
  }
}

try {
  await main();
} catch (error) {
  failures += 1;
  console.error('\nERROR:', error.message);
} finally {
  // The operator and its bookings go before the accounts, because
  // `bookings.passenger_id` is `on delete restrict`.
  if (cleanup.operatorId) await removeOperator(cleanup.operatorId);
  for (const id of cleanup.userIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error(`  could not remove an account: ${error.message}`);
  }
  console.log('\nCleaned up: the operator and everything under it, and both test accounts.');
}

console.log(failures === 0 ? '\nA new operator can get on sale.' : `\n${failures} step(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
