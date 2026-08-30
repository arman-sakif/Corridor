/**
 * Seeds a realistic Windsor → Toronto corridor so the app has something to
 * show. Idempotent: re-running updates rather than duplicating.
 *
 *   node scripts/seed-demo.mjs           # create or update
 *   node scripts/seed-demo.mjs --remove  # take it all back out
 *
 * Uses the secret key, so it bypasses RLS. That is the point — it is standing
 * in for work an operator would otherwise do by hand through the dashboard.
 *
 * The fares are deliberately the shape these businesses actually price at:
 * Windsor→Toronto is $45, while the three legs it spans add up to $65. If a
 * booking ever quotes $65 for that trip, the matrix rule has been broken
 * somewhere.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const OPERATOR_NAME = "Harbour Line";
const OWNER_EMAIL = 'owner@harbour-line.test';
const OWNER_PASSWORD = 'local-demo-password';

const CITIES = ['Windsor', 'Chatham', 'London', 'Mississauga', 'Toronto'];

const STOPS = [
  { city: 'Windsor', label: 'Devonshire Mall', description: 'By the Shoppers Drug Mart entrance' },
  { city: 'Chatham', label: 'Park Avenue Tim Hortons', description: 'In the car park, by the drive-through' },
  { city: 'London', label: 'White Oaks Mall', description: 'Bus loop on the south side' },
  { city: 'Mississauga', label: 'Square One Bus Terminal', description: 'Platform 3' },
  { city: 'Toronto', label: 'Yorkdale Mall', description: 'Outside the Shoppers Drug Mart entrance' },
];

/** from_seq, to_seq, dollars. The through fare is NOT the sum of its legs. */
const FARES = [
  [1, 2, 15],
  [2, 3, 20],
  [3, 4, 25],
  [4, 5, 15],
  [1, 3, 30],
  [1, 4, 40],
  [1, 5, 45], // Windsor → Toronto: $45, not the $75 the legs add up to
  [2, 4, 35],
  [2, 5, 40],
  [3, 5, 35],
];

const die = (message, error) => {
  console.error(`\n${message}`, error?.message ?? error ?? '');
  process.exit(1);
};

async function remove() {
  const { data: operator } = await db
    .from('operators')
    .select('id')
    .eq('name', OPERATOR_NAME)
    .maybeSingle();

  if (operator) {
    // Cascades through stops, routes, fares, schedules, departures, bookings.
    await db.from('operators').delete().eq('id', operator.id);
    console.log(`Removed ${OPERATOR_NAME} and everything under it.`);
  }

  const { data: users } = await db.auth.admin.listUsers();
  const owner = users?.users.find((u) => u.email === OWNER_EMAIL);
  if (owner) {
    await db.auth.admin.deleteUser(owner.id);
    console.log('Removed the demo owner account.');
  }

  await db.from('cities').delete().in('name', CITIES);
  console.log('Removed the demo cities.');
}

async function seed() {
  // 1. Cities — global and admin-managed.
  const cityIds = {};
  for (const name of CITIES) {
    const { data, error } = await db
      .from('cities')
      .upsert({ name, province: 'ON' }, { onConflict: 'name' })
      .select('id, name')
      .single();
    if (error) die(`Could not create ${name}.`, error);
    cityIds[data.name] = data.id;
  }
  console.log(`${CITIES.length} cities.`);

  // 2. The owner's account.
  const { data: existingUsers } = await db.auth.admin.listUsers();
  let owner = existingUsers?.users.find((u) => u.email === OWNER_EMAIL);
  if (!owner) {
    const { data, error } = await db.auth.admin.createUser({
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'Test Owner' },
    });
    if (error) die('Could not create the owner account.', error);
    owner = data.user;
  }
  await db
    .from('profiles')
    .update({ full_name: 'Test Owner', phone: '519-555-0111' })
    .eq('id', owner.id);
  console.log(`Owner: ${OWNER_EMAIL}`);

  // 3. The operator, vetted and active.
  const { data: existingOperator } = await db
    .from('operators')
    .select('id')
    .eq('name', OPERATOR_NAME)
    .maybeSingle();

  let operatorId = existingOperator?.id;
  if (!operatorId) {
    const { data, error } = await db
      .from('operators')
      .insert({
        name: OPERATOR_NAME,
        type: 'intercity',
        public_phone: '519-555-0111',
        bio: 'Daily runs between Windsor and Toronto since 2019. Clean vans, on time, cash or e-transfer.',
        status: 'active',
        created_by: owner.id,
        free_luggage_per_seat: 1,
        extra_luggage_cents: 500,
        airport_fee_cents: 1000,
      })
      .select('id')
      .single();
    if (error) die('Could not create the operator.', error);
    operatorId = data.id;
  } else {
    await db.from('operators').update({ status: 'active' }).eq('id', operatorId);
  }

  // The insert trigger attaches the owner, but be explicit for a re-run.
  await db
    .from('operator_members')
    .upsert(
      { operator_id: operatorId, user_id: owner.id, role: 'owner' },
      { onConflict: 'operator_id,user_id' },
    );
  console.log(`Operator: ${OPERATOR_NAME} (active)`);

  // 4. Stops.
  const stopIds = [];
  for (const stop of STOPS) {
    const { data, error } = await db
      .from('stops')
      .upsert(
        {
          operator_id: operatorId,
          city_id: cityIds[stop.city],
          label: stop.label,
          description: stop.description,
          is_active: true,
        },
        { onConflict: 'operator_id,city_id,label' },
      )
      .select('id')
      .single();
    if (error) die(`Could not create the stop ${stop.label}.`, error);
    stopIds.push(data.id);
  }
  console.log(`${STOPS.length} stops.`);

  // 5. Route and its ordered stops. save_route() is granted to authenticated
  //    rather than service_role, so the two writes are done directly here.
  const { data: existingRoute } = await db
    .from('routes')
    .select('id')
    .eq('operator_id', operatorId)
    .eq('name', 'Windsor to Toronto')
    .maybeSingle();

  let routeId = existingRoute?.id;
  if (!routeId) {
    const { data, error } = await db
      .from('routes')
      .insert({
        operator_id: operatorId,
        name: 'Windsor to Toronto',
        pricing_mode: 'matrix',
        is_active: true,
      })
      .select('id')
      .single();
    if (error) die('Could not create the route.', error);
    routeId = data.id;
  }

  await db.from('route_stops').delete().eq('route_id', routeId);
  const { error: stopsError } = await db
    .from('route_stops')
    .insert(stopIds.map((stopId, index) => ({ route_id: routeId, stop_id: stopId, seq: index + 1 })));
  if (stopsError) die('Could not order the route stops.', stopsError);
  console.log('Route: Windsor → Chatham → London → Mississauga → Toronto');

  // 6. Fares, with an audit row each — the same pair of writes set_fare() does.
  for (const [fromSeq, toSeq, dollars] of FARES) {
    const priceCents = dollars * 100;
    const { error } = await db
      .from('fares')
      .upsert(
        { route_id: routeId, from_seq: fromSeq, to_seq: toSeq, price_cents: priceCents },
        { onConflict: 'route_id,from_seq,to_seq' },
      );
    if (error) die(`Could not price ${fromSeq}→${toSeq}.`, error);

    await db.from('fare_changes').insert({
      route_id: routeId,
      from_seq: fromSeq,
      to_seq: toSeq,
      old_price_cents: null,
      new_price_cents: priceCents,
      reason: 'initial pricing',
      changed_by: owner.id,
    });
  }
  console.log(`${FARES.length} segment fares (Windsor→Toronto $45, not the $75 its legs total).`);

  // 7. Timetable: two departures a day, every day.
  for (const [time, seats] of [
    ['06:30', 14],
    ['14:00', 14],
  ]) {
    const { data: existing } = await db
      .from('schedules')
      .select('id')
      .eq('route_id', routeId)
      .eq('departure_time', `${time}:00`)
      .maybeSingle();

    const values = {
      route_id: routeId,
      departure_time: time,
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      max_seats: seats,
      active_from: new Date().toISOString().slice(0, 10),
    };

    const { error } = existing
      ? await db.from('schedules').update(values).eq('id', existing.id)
      : await db.from('schedules').insert(values);
    if (error) die(`Could not schedule the ${time} departure.`, error);
  }
  console.log('Timetable: 06:30 and 14:00, every day, 14 seats each.');

  // 8. Roll the window forward.
  const { data: created, error: genError } = await db.rpc('generate_departures', {
    p_operator_id: operatorId,
    p_days: 30,
  });
  if (genError) die('Could not generate departures.', genError);

  const { count } = await db
    .from('departures')
    .select('id', { count: 'exact', head: true })
    .eq('operator_id', operatorId);

  console.log(`Departures: ${created} created, ${count} on sale.`);

  // 9. A vehicle, for departure day.
  await db
    .from('vehicles')
    .upsert(
      { operator_id: operatorId, label: 'Grey Sienna', seat_count: 7, is_active: true },
      { onConflict: 'operator_id,label', ignoreDuplicates: true },
    );

  console.log(`\nDone. Sign in as ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
}

if (process.argv.includes('--remove')) {
  await remove();
} else {
  await seed();
}
