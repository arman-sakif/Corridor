/**
 * The whole booking loop, end to end, against the deployed app.
 *
 *   node scripts/e2e-loop.mjs
 *   node scripts/e2e-loop.mjs --url http://localhost:3000
 *
 * Every piece of this is unit-tested and the SQL is proven, but the *sequence*
 * has never run: request → approve → assign → drive → complete → settle, with
 * each step taken by the role that actually takes it, under that role's own
 * session and therefore its own RLS.
 *
 * The manifest is fetched over real HTTP from the deployed Route Handler,
 * carrying a driver's auth cookie, because a CSV that only works when
 * generated in-process is a CSV that does not work.
 *
 * It runs on a departure with nothing booked on it, and puts everything back:
 * bookings deleted, vehicle assignment removed, departure status restored,
 * test accounts deleted — including when a step fails.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

import { demoPassword, loadOperatorResearch } from './local-seed.mjs';

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
const PROJECT_REF = new global.URL(SUPABASE_URL).hostname.split('.')[0];

const admin = createClient(SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DEMO_PASSWORD = demoPassword();
const TEST_PASSWORD = 'e2e-loop-password-123';

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

/* --------------------------------------------------------------- sessions */

async function signIn(email, password) {
  const client = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${email} could not sign in: ${error.message}`);
  return { client, session: data.session };
}

/**
 * Rebuilds the cookie @supabase/ssr would have written, so a plain fetch
 * arrives at the Route Handler as a signed-in driver.
 */
function sessionCookie(session) {
  const name = `sb-${PROJECT_REF}-auth-token`;
  const base64url = Buffer.from(JSON.stringify(session), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const value = `base64-${base64url}`;

  const MAX = 3180;
  if (value.length <= MAX) return `${name}=${value}`;

  const chunks = [];
  for (let i = 0; i < value.length; i += MAX) chunks.push(value.slice(i, i + MAX));
  return chunks.map((chunk, i) => `${name}.${i}=${chunk}`).join('; ');
}

/* ------------------------------------------------------------------- main */

const cleanup = { userIds: [], departureId: null, departureVehicleId: null, extraBookingIds: [] };

async function main() {
  console.log(`Walking the booking loop against ${SITE}\n`);

  const { OPERATORS } = await loadOperatorResearch();
  const primary = OPERATORS.find((operator) => operator.showcase);
  const rival = OPERATORS.find(
    (operator) =>
      operator.type === 'intercity' &&
      operator.status === 'active' &&
      operator.slug !== primary?.slug,
  );
  const showcaseDriver = primary?.drivers?.[0];
  const showcaseVehicle = primary?.vehicles?.[0];
  if (
    !primary?.ownerEmail ||
    !showcaseDriver?.[0] ||
    !showcaseDriver?.[1] ||
    !showcaseVehicle?.[0] ||
    !rival?.ownerEmail ||
    !rival.name
  ) {
    throw new Error(
      'The local operator research needs a showcase operator with a driver and a vehicle, and a second active intercity operator.',
    );
  }

  /* ---- find a clean departure to work on ----------------------------- */
  const { data: operator } = await admin
    .from('operators')
    .select('id, name, airport_fee_cents')
    .eq('name', primary.name)
    .single();

  const { data: candidates } = await admin
    .from('departures')
    .select('id, route_id, service_date, departure_time, max_seats, status')
    .eq('operator_id', operator.id)
    .eq('status', 'scheduled')
    .gte('service_date', new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10))
    .limit(200);

  let departure = null;
  for (const candidate of candidates ?? []) {
    const { count } = await admin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('departure_id', candidate.id);
    if (count === 0) {
      departure = candidate;
      break;
    }
  }
  if (!departure) throw new Error('no empty future departure to test on');
  cleanup.departureId = departure.id;

  const { data: stops } = await admin
    .from('route_stops')
    .select('seq, stop_id, stop:stops(label, is_airport, city:cities(name))')
    .eq('route_id', departure.route_id)
    .order('seq');

  const origin = stops[0];
  const destination = stops.find((s) => !s.stop?.is_airport && s.seq === stops.length);

  console.log(
    `Departure ${departure.service_date} ${departure.departure_time.slice(0, 5)}, ` +
      `${departure.max_seats} seats per leg, nothing booked yet.\n`,
  );

  /* ---- the cast ------------------------------------------------------- */
  const passengerEmail = `e2e-passenger-${Date.now()}@corridor.test`;
  const { data: created } = await admin.auth.admin.createUser({
    email: passengerEmail,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Loop Tester' },
  });
  cleanup.userIds.push(created.user.id);
  await admin
    .from('profiles')
    .update({ full_name: 'Loop Tester', phone: '519-555-0147', gender: 'female' })
    .eq('id', created.user.id);

  const passenger = await signIn(passengerEmail, TEST_PASSWORD);
  const owner = await signIn(primary.ownerEmail, DEMO_PASSWORD);
  const driver = await signIn(primary.drivers[0][0], DEMO_PASSWORD);

  /* ---- 1. the passenger requests a seat ------------------------------- */
  const { data: bookingId, error: requestError } = await passenger.client.rpc('request_booking', {
    p_departure_id: departure.id,
    p_from_stop_id: origin.stop_id,
    p_to_stop_id: destination.stop_id,
    p_seats: 2,
    p_luggage_count: 3,
    p_passenger_note: 'Front seat if possible',
  });
  check(!requestError && Boolean(bookingId), 'passenger requests a seat', requestError?.message);
  if (!bookingId) throw new Error('cannot continue without a booking');

  const { data: held } = await admin
    .from('bookings')
    .select('status, hold_expires_at, base_cents, luggage_cents, total_cents, seats')
    .eq('id', bookingId)
    .single();

  check(held.status === 'held', 'it lands as a hold', held.status);
  check(Boolean(held.hold_expires_at), 'with a clock on it', held.hold_expires_at);
  // Seeded through-fare: $45 a seat, 1 bag free per seat, $10 a bag beyond that.
  check(
    held.base_cents === 9000 && held.luggage_cents === 1000 && held.total_cents === 10000,
    'the fare is computed server-side',
    `${money(held.base_cents)} + ${money(held.luggage_cents)} luggage = ${money(held.total_cents)}`,
  );

  /* ---- 2. what the operator sees before deciding ---------------------- */
  const { data: queue } = await owner.client
    .from('bookings')
    .select('id, seats, passenger_note, passenger:profiles(full_name, phone, gender)')
    .eq('id', bookingId);

  check(queue?.length === 1, 'the operator sees it in their queue');
  check(
    queue?.[0]?.passenger?.full_name === 'Loop Tester' && Boolean(queue?.[0]?.passenger?.phone),
    'and can read the passenger name and phone',
    queue?.[0]?.passenger?.phone ?? '',
  );

  const { data: history } = await owner.client.rpc('passenger_history', {
    p_passenger_id: created.user.id,
  });
  check(
    Array.isArray(history) && history[0]?.completed === 0,
    'and their platform history, as counts',
    `completed ${history?.[0]?.completed}, flags ${history?.[0]?.red_flags}`,
  );

  const stranger = await signIn(rival.ownerEmail, DEMO_PASSWORD);
  const { data: leaked } = await stranger.client.from('bookings').select('id').eq('id', bookingId);
  check(leaked?.length === 0, 'a rival operator sees nothing of it');

  /* ---- 3. approval ---------------------------------------------------- */
  const { error: approveError } = await owner.client.rpc('approve_booking', {
    p_booking_id: bookingId,
  });
  check(!approveError, 'the operator approves it', approveError?.message);

  const { data: approved } = await admin
    .from('bookings')
    .select('status, hold_expires_at, approved_at')
    .eq('id', bookingId)
    .single();
  check(
    approved.status === 'approved' && approved.hold_expires_at === null,
    'the hold clock is cleared',
    approved.status,
  );

  /* ---- 4. departure day: a van and a driver --------------------------- */
  const { data: vehicle } = await admin
    .from('vehicles')
    .select('id, label')
    .eq('operator_id', operator.id)
    .eq('label', showcaseVehicle[0])
    .single();

  const { data: driverMember } = await admin
    .from('profiles')
    .select('id, full_name')
    .eq('full_name', showcaseDriver[1])
    .single();

  const { data: assignment, error: assignError } = await owner.client
    .from('departure_vehicles')
    .insert({
      departure_id: departure.id,
      vehicle_id: vehicle.id,
      driver_id: driverMember.id,
    })
    .select('id')
    .single();
  check(!assignError, 'the operator puts a van and a driver on it', assignError?.message);
  cleanup.departureVehicleId = assignment?.id ?? null;

  const { error: seatError } = await owner.client.rpc('assign_booking_vehicle', {
    p_booking_id: bookingId,
    p_vehicle_id: vehicle.id,
  });
  check(!seatError, 'and puts the passenger in that van', seatError?.message);

  /* ---- 4b. two more passengers, for the endings that are not happy ---- */
  const extras = {};
  for (const who of ['unpaid', 'absent']) {
    const email = `e2e-${who}-${Date.now()}@corridor.test`;
    const { data: made } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: who === 'unpaid' ? 'Unpaid Rider' : 'Absent Rider' },
    });
    cleanup.userIds.push(made.user.id);
    await admin
      .from('profiles')
      .update({
        full_name: who === 'unpaid' ? 'Unpaid Rider' : 'Absent Rider',
        phone: '519-555-0188',
      })
      .eq('id', made.user.id);

    const session = await signIn(email, TEST_PASSWORD);
    const { data: id } = await session.client.rpc('request_booking', {
      p_departure_id: departure.id,
      p_from_stop_id: origin.stop_id,
      p_to_stop_id: destination.stop_id,
      p_seats: 1,
      p_luggage_count: 0,
      p_passenger_note: null,
    });
    await owner.client.rpc('approve_booking', { p_booking_id: id });
    extras[who] = { userId: made.user.id, bookingId: id, session };
  }
  check(
    Boolean(extras.unpaid.bookingId && extras.absent.bookingId),
    'two more passengers book and are approved',
  );

  /* ---- 5. the driver's view ------------------------------------------- */
  const { data: driverSees } = await driver.client
    .from('bookings')
    .select('id, departure_id')
    .eq('id', bookingId);
  check(driverSees?.length === 1, 'the assigned driver can see the passenger');

  /* ---- 6. the manifest, over real HTTP -------------------------------- */
  const manifestUrl = `${SITE}/api/manifest/${departure.id}?vehicle=${vehicle.id}`;
  const response = await fetch(manifestUrl, {
    headers: { cookie: sessionCookie(driver.session) },
  });
  // Read the bytes, not the text: Response.text() decodes UTF-8 and strips a
  // leading BOM per spec, which would hide whether the BOM was ever sent —
  // and the BOM is the whole reason Excel opens accented names correctly.
  const bytes = new Uint8Array(await response.arrayBuffer());
  const csv = new TextDecoder('utf-8').decode(bytes);

  check(response.ok, 'the driver downloads the manifest over HTTP', `HTTP ${response.status}`);
  check(
    response.headers.get('content-type')?.includes('text/csv'),
    'served as CSV',
    response.headers.get('content-type') ?? '',
  );
  check(
    (response.headers.get('content-disposition') ?? '').includes('attachment'),
    'as a download, named for the trip',
    (response.headers.get('content-disposition') ?? '').slice(0, 72),
  );
  check(
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    'BOM-prefixed so Excel reads UTF-8 properly',
    // Array.from first, and not by accident. `bytes` is a Uint8Array, and a
    // typed array's map() returns another typed array — it coerces whatever
    // the callback returns back to a number, so 'ef' becomes NaN becomes 0 and
    // the line reads "first bytes 0 0 0" while the assertion beside it passes.
    // A diagnostic that lies only when you need it is worse than none.
    `first bytes ${Array.from(bytes.slice(0, 3), (b) => b.toString(16)).join(' ')}`,
  );
  check(
    csv.includes('Loop Tester') && csv.includes('519-555-0147'),
    'listing the passenger and their phone',
  );
  check(
    csv.includes(origin.stop.label) && csv.includes(destination.stop.label),
    'with the right pickup and drop-off',
  );
  check(!csv.includes('platform_role') && !csv.includes('red_flag'), 'and nothing the driver should not have');

  const outsider = await fetch(manifestUrl);
  check(outsider.status === 404, 'a signed-out request gets nothing', `HTTP ${outsider.status}`);

  const rivalManifest = await fetch(manifestUrl, {
    headers: { cookie: sessionCookie(stranger.session) },
  });
  const rivalBody = await rivalManifest.text();
  check(
    rivalManifest.status === 404 || !rivalBody.includes('Loop Tester'),
    'and so does a rival operator',
    `HTTP ${rivalManifest.status}`,
  );

  /* ---- 7. the trip runs ----------------------------------------------- */
  const { error: completeError } = await driver.client.rpc('complete_departure', {
    p_departure_id: departure.id,
  });
  check(!completeError, 'the driver closes the trip off', completeError?.message);

  const { data: completed } = await admin
    .from('bookings')
    .select('status')
    .eq('id', bookingId)
    .single();
  check(completed.status === 'completed', 'the booking moves to completed', completed.status);

  /* ---- 8. settling up -------------------------------------------------- */
  const { error: payError } = await passenger.client.rpc('confirm_payment_as_passenger', {
    p_booking_id: bookingId,
    p_payment_method: 'cash',
  });
  check(!payError, 'the passenger says they paid cash', payError?.message);

  const { data: onlyOneSide } = await admin
    .from('bookings')
    .select('status, payment_method')
    .eq('id', bookingId)
    .single();
  check(
    onlyOneSide.status === 'completed',
    'one side alone is not agreement',
    `still ${onlyOneSide.status}`,
  );

  const { error: driverPayError } = await driver.client.rpc('confirm_payment_as_driver', {
    p_booking_id: bookingId,
    p_received: true,
  });
  check(!driverPayError, 'the driver confirms it arrived', driverPayError?.message);

  const { data: settled } = await admin
    .from('bookings')
    .select('status, payment_method')
    .eq('id', bookingId)
    .single();
  check(
    settled.status === 'settled' && settled.payment_method === 'cash',
    'and only then does it settle',
    `${settled.status}, ${settled.payment_method}`,
  );

  /* ---- 8b. the one who did not turn up -------------------------------- */
  const { error: noShowError } = await driver.client.rpc('mark_no_show', {
    p_booking_id: extras.absent.bookingId,
  });
  check(!noShowError, 'the driver marks a no-show', noShowError?.message);

  const { data: absent } = await admin
    .from('bookings')
    .select('status')
    .eq('id', extras.absent.bookingId)
    .single();
  check(absent.status === 'no_show', 'the booking records it', absent.status);

  const { data: autoFlag } = await admin
    .from('red_flags')
    .select('reason')
    .eq('booking_id', extras.absent.bookingId);
  check(
    autoFlag?.[0]?.reason === 'no_show',
    'and a red flag is raised without anyone remembering to',
    autoFlag?.[0]?.reason ?? 'none',
  );

  /* ---- 8c. the one who did not pay ------------------------------------ */
  const { error: unpaidError } = await driver.client.rpc('confirm_payment_as_driver', {
    p_booking_id: extras.unpaid.bookingId,
    p_received: false,
  });
  check(!unpaidError, 'the driver reports a fare that never arrived', unpaidError?.message);

  const { data: unpaid } = await admin
    .from('bookings')
    .select('status')
    .eq('id', extras.unpaid.bookingId)
    .single();
  check(unpaid.status !== 'settled', 'the booking does not settle', unpaid.status);

  const { data: unpaidFlag } = await admin
    .from('red_flags')
    .select('reason')
    .eq('booking_id', extras.unpaid.bookingId);
  check(
    unpaidFlag?.[0]?.reason === 'did_not_pay',
    'and it is recorded against the passenger',
    unpaidFlag?.[0]?.reason ?? 'none',
  );

  /* ---- 8d. does the flag actually reach the next operator? ------------ */
  // Red flags are deliberately platform-wide: the point of recording a
  // no-show is that the NEXT operator sees it. But only for a passenger who
  // has actually approached them — not as a public register.
  const jons = await signIn(rival.ownerEmail, DEMO_PASSWORD);

  const { data: beforeApproaching } = await jons.client.rpc('passenger_history', {
    p_passenger_id: extras.unpaid.userId,
  });
  check(
    !beforeApproaching?.length || beforeApproaching[0].red_flags === 0,
    'a rival operator sees nothing about a passenger who never approached them',
    `flags ${beforeApproaching?.[0]?.red_flags ?? 0}`,
  );

  const { data: jonsOperator } = await admin
    .from('operators')
    .select('id')
    .eq('name', rival.name)
    .single();
  const { data: jonsDeparture } = await admin
    .from('departures')
    .select('id, route_id')
    .eq('operator_id', jonsOperator.id)
    .eq('status', 'scheduled')
    .gte('service_date', new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10))
    .limit(1)
    .single();
  const { data: jonsStops } = await admin
    .from('route_stops')
    .select('seq, stop_id')
    .eq('route_id', jonsDeparture.route_id)
    .order('seq');

  const { data: jonsBooking } = await extras.unpaid.session.client.rpc('request_booking', {
    p_departure_id: jonsDeparture.id,
    p_from_stop_id: jonsStops[0].stop_id,
    p_to_stop_id: jonsStops.at(-1).stop_id,
    p_seats: 1,
    p_luggage_count: 0,
    p_passenger_note: null,
  });
  cleanup.extraBookingIds.push(jonsBooking);

  const { data: afterApproaching } = await jons.client.rpc('passenger_history', {
    p_passenger_id: extras.unpaid.userId,
  });
  check(
    afterApproaching?.[0]?.red_flags >= 1,
    'but once they request a seat, the flag from the other operator is visible',
    `flags ${afterApproaching?.[0]?.red_flags}`,
  );

  /* ---- 9. the passenger rates the trip -------------------------------- */
  const { error: rateError } = await passenger.client.from('ratings').insert({
    booking_id: bookingId,
    direction: 'passenger_to_operator',
    rater_id: created.user.id,
    operator_id: operator.id,
    passenger_id: created.user.id,
    score: 5,
    comment: 'Left on time, driver was helpful with bags.',
  });
  check(!rateError, 'the passenger rates the operator', rateError?.message);

  const { data: publicRating } = await createClient(SUPABASE_URL, PUBLISHABLE)
    .from('ratings')
    .select('score')
    .eq('booking_id', bookingId);
  check(publicRating?.length === 1, 'and the rating is public on their profile');

  /* ---- 10. history has moved ------------------------------------------ */
  const { data: after } = await owner.client.rpc('passenger_history', {
    p_passenger_id: created.user.id,
  });
  check(
    after?.[0]?.completed === 1,
    'the operator now sees one completed trip for them',
    `completed ${after?.[0]?.completed}`,
  );
}

/* ---------------------------------------------------------------- teardown */

try {
  await main();
} catch (error) {
  failures += 1;
  console.error('\nERROR:', error.message);
} finally {
  for (const id of cleanup.extraBookingIds) {
    if (id) await admin.from('bookings').delete().eq('id', id);
  }
  if (cleanup.departureId) {
    await admin.from('bookings').delete().eq('departure_id', cleanup.departureId);
    await admin.from('departure_vehicles').delete().eq('departure_id', cleanup.departureId);
    await admin
      .from('departures')
      .update({ status: 'scheduled' })
      .eq('id', cleanup.departureId);
  }
  for (const id of cleanup.userIds) await admin.auth.admin.deleteUser(id);
  console.log('\nCleaned up: bookings, vehicle assignment, departure status, test account.');
}

console.log(failures === 0 ? '\nThe whole loop works.' : `\n${failures} step(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
