/**
 * Does the seat lock actually hold under real contention?
 *
 *   node scripts/race-test.mjs
 *
 * Every other test in this repo runs against PGlite, which is a single
 * connection — so the row lock in `request_booking()` has been reasoned about
 * but never genuinely raced. This fires simultaneous HTTP requests at the live
 * database, each arriving on its own PostgREST connection, which is the only
 * way the `SELECT … FOR UPDATE` is put under the pressure it exists for.
 *
 * Two things are checked, and the second matters as much as the first:
 *
 *   1. Contention is refused. N passengers going for one seat produce exactly
 *      one booking, not N.
 *   2. Non-contention is NOT refused. Passengers on disjoint legs all succeed,
 *      because their journeys never share a leg. A lock that serialises
 *      everything would pass the first check and quietly destroy the per-leg
 *      capacity model, which is the entire product.
 *
 * Everything it creates is removed afterwards, including on failure.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSWORD = 'race-test-password-123';
const RACERS = 8;

const created = { userIds: [], departureId: null, originalMaxSeats: null };
let failures = 0;

const report = (pass, name, detail = '') => {
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** A signed-in passenger, complete enough for request_booking to accept them. */
async function makePassenger(index) {
  const email = `race-${Date.now()}-${index}@corridor.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Racer ${index}` },
  });
  if (error) throw new Error(`could not create racer ${index}: ${error.message}`);

  created.userIds.push(data.user.id);
  await admin
    .from('profiles')
    .update({ full_name: `Racer ${index}`, phone: '519-555-0000' })
    .eq('id', data.user.id);

  // Each racer gets their own client, so each carries its own session and
  // opens its own connection rather than queueing behind a shared one.
  const client = createClient(URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw new Error(`racer ${index} could not sign in: ${signInError.message}`);

  return client;
}

async function clearBookings(departureId) {
  await admin.from('bookings').delete().eq('departure_id', departureId);
}

async function main() {
  // A departure far enough out that nothing else touches it.
  const { data: departure, error: depError } = await admin
    .from('departures')
    .select('id, max_seats, route_id, service_date')
    .gte('service_date', new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10))
    .order('service_date')
    .limit(1)
    .single();
  if (depError) throw new Error(`no departure to test against: ${depError.message}`);

  created.departureId = departure.id;
  created.originalMaxSeats = departure.max_seats;

  const { data: stops } = await admin
    .from('route_stops')
    .select('seq, stop_id')
    .eq('route_id', departure.route_id)
    .order('seq');

  const stopId = (seq) => stops.find((s) => s.seq === seq).stop_id;

  console.log(`Racing on the ${departure.service_date} departure, ${stops.length} stops.\n`);

  const racers = await Promise.all(
    Array.from({ length: RACERS }, (_, i) => makePassenger(i)),
  );

  /* ---- 1. One seat, eight passengers, all at once ---------------------- */
  await clearBookings(departure.id);
  await admin.from('departures').update({ max_seats: 1 }).eq('id', departure.id);

  const contended = await Promise.all(
    racers.map((client) =>
      client.rpc('request_booking', {
        p_departure_id: departure.id,
        p_from_stop_id: stopId(1),
        p_to_stop_id: stopId(stops.length),
        p_seats: 1,
        p_luggage_count: 0,
        p_passenger_note: null,
      }),
    ),
  );

  const won = contended.filter((r) => !r.error).length;
  const refused = contended.filter((r) => r.error?.message?.match(/not enough seats/i)).length;
  const other = contended.filter((r) => r.error && !r.error.message.match(/not enough seats/i));

  report(won === 1, `${RACERS} passengers race for 1 seat → exactly one wins`, `${won} won`);
  report(
    refused === RACERS - 1,
    'the rest are told the seats are gone',
    `${refused} refused cleanly`,
  );
  if (other.length) {
    report(false, 'no unexpected errors', other.map((r) => r.error.message).join(' | '));
  }

  const { count: actualRows } = await admin
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('departure_id', departure.id);
  report(actualRows === 1, 'exactly one booking row exists', `${actualRows} rows`);

  /* ---- 2. Disjoint legs must NOT be serialised ------------------------- */
  // The lock must refuse contention without refusing everything. Four
  // passengers on four consecutive legs share no leg between them, so on a
  // one-seat departure all four are legal — this is the per-leg capacity model
  // in its purest form, and a lock that is too coarse fails here.
  await clearBookings(departure.id);

  const legCount = Math.min(stops.length - 1, racers.length);
  const disjoint = await Promise.all(
    Array.from({ length: legCount }, (_, i) =>
      racers[i].rpc('request_booking', {
        p_departure_id: departure.id,
        p_from_stop_id: stopId(i + 1),
        p_to_stop_id: stopId(i + 2),
        p_seats: 1,
        p_luggage_count: 0,
        p_passenger_note: null,
      }),
    ),
  );

  const disjointWon = disjoint.filter((r) => !r.error).length;
  report(
    disjointWon === legCount,
    `${legCount} passengers on disjoint legs all get a seat on a 1-seat departure`,
    `${disjointWon} of ${legCount}` +
      (disjointWon < legCount
        ? ` — ${disjoint.find((r) => r.error)?.error?.message ?? ''}`
        : ''),
  );

  /* ---- 3. Overlapping legs on the same departure are still refused ----- */
  await clearBookings(departure.id);

  const overlapping = await Promise.all([
    racers[0].rpc('request_booking', {
      p_departure_id: departure.id,
      p_from_stop_id: stopId(1),
      p_to_stop_id: stopId(3),
      p_seats: 1,
      p_luggage_count: 0,
      p_passenger_note: null,
    }),
    racers[1].rpc('request_booking', {
      p_departure_id: departure.id,
      p_from_stop_id: stopId(2),
      p_to_stop_id: stopId(4),
      p_seats: 1,
      p_luggage_count: 0,
      p_passenger_note: null,
    }),
  ]);

  const overlapWon = overlapping.filter((r) => !r.error).length;
  report(
    overlapWon === 1,
    'two journeys sharing one leg → only one wins',
    `${overlapWon} won`,
  );
}

try {
  await main();
} catch (error) {
  failures += 1;
  console.error('\nERROR:', error.message);
} finally {
  if (created.departureId) {
    await clearBookings(created.departureId);
    if (created.originalMaxSeats !== null) {
      await admin
        .from('departures')
        .update({ max_seats: created.originalMaxSeats })
        .eq('id', created.departureId);
    }
  }
  for (const id of created.userIds) await admin.auth.admin.deleteUser(id);
  console.log(`\nCleaned up ${created.userIds.length} test accounts and their bookings.`);
}

process.exit(failures === 0 ? 0 : 1);
