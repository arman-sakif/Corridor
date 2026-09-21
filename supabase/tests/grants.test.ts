import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { migratedDatabase, type TestDb } from './harness.ts';

/**
 * Supabase exposes every function in `public` as an RPC endpoint, and Postgres
 * grants EXECUTE to PUBLIC by default. That combination means a function is
 * reachable from the internet the moment it exists, unless something says
 * otherwise.
 *
 * These tests are that something. They will fail the next time a function is
 * added without a deliberate grant, which is the point.
 */

describe('function grants', () => {
  let test: TestDb;

  before(async () => {
    test = await migratedDatabase();
  });

  after(async () => test.close());

  it('lets a signed-out visitor call only what search needs', async () => {
    const callable = await test.raw<{ proname: string }>(
      `select p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and has_function_privilege('anon', p.oid, 'execute')
        order by 1`,
    );

    assert.deepEqual(
      callable.map((row) => row.proname),
      [
        'departure_leg_loads',
        'departure_operator',
        'operator_is_active',
        // Quoting a fare is public: a passenger sees the price before they
        // sign in. It reads no price from the caller and writes nothing.
        'quote_booking',
        'route_operator',
        'toronto_instant',
      ],
    );
  });

  it('does not expose the hold sweep to anyone but the scheduled job', async () => {
    const [row] = await test.raw<{ anon: boolean; authenticated: boolean; service: boolean }>(
      `select has_function_privilege('anon', 'public.expire_stale_holds()', 'execute') as anon,
              has_function_privilege('authenticated', 'public.expire_stale_holds()', 'execute') as authenticated,
              has_function_privilege('service_role', 'public.expire_stale_holds()', 'execute') as service`,
    );

    assert.equal(row!.anon, false);
    assert.equal(row!.authenticated, false);
    assert.equal(row!.service, true);
  });

  it('keeps the shared voucher rules out of reach of the API', async () => {
    // `resolve_voucher` is what `check_voucher` and `request_booking` both
    // ask. Exposed directly it would be an oracle over every live code on the
    // platform, one guess at a time. Both callers are SECURITY DEFINER and
    // reach it as the owner, so nobody else needs to.
    const [row] = await test.raw<{ anon: boolean; authenticated: boolean }>(
      `select has_function_privilege('anon', 'public.resolve_voucher(uuid, text, uuid, boolean)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.resolve_voucher(uuid, text, uuid, boolean)', 'execute') as authenticated`,
    );

    assert.equal(row!.anon, false);
    assert.equal(row!.authenticated, false);
  });

  it('gives trigger functions no execute grant at all', async () => {
    const triggers = [
      'public.handle_new_user()',
      'public.guard_operator_status()',
      'public.guard_platform_role()',
      'public.attach_operator_owner()',
      'public.set_updated_at()',
    ];

    for (const signature of triggers) {
      const [row] = await test.raw<{ anon: boolean; authenticated: boolean }>(
        `select has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as authenticated`,
        [signature],
      );
      assert.equal(row!.anon, false, `${signature} must not be callable by anon`);
      assert.equal(row!.authenticated, false, `${signature} must not be callable directly`);
    }
  });

  it('still lets a signed-in user do the things the app needs', async () => {
    for (const signature of [
      'public.request_booking(uuid, uuid, uuid, integer, integer, text, text)',
      'public.approve_booking(uuid)',
      'public.cancel_booking(uuid)',
      'public.set_fare(uuid, integer, integer, integer, text)',
      'public.save_route(uuid, uuid, text, public.pricing_mode, uuid[])',
      'public.create_voucher(uuid, public.voucher_kind, integer, public.voucher_window, integer)',
      'public.set_voucher_active(uuid, boolean)',
      'public.check_voucher(uuid, text)',
      'public.voucher_uses(uuid)',
      'public.operator_insights(uuid, date, date)',
    ]) {
      const [row] = await test.raw<{ ok: boolean }>(
        `select has_function_privilege('authenticated', $1, 'execute') as ok`,
        [signature],
      );
      assert.equal(row!.ok, true, `${signature} should be callable by a signed-in user`);
    }
  });

  it('keeps RLS enabled on every table', async () => {
    const unprotected = await test.raw<{ relname: string }>(
      `select c.relname
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );

    assert.deepEqual(
      unprotected.map((row) => row.relname),
      [],
      'a table without RLS is readable by anyone with the anon key',
    );
  });

  it('has no table with RLS on and no policy that the app then tries to use', async () => {
    // A table with RLS and no policy denies everything, which is the right
    // default — but by now every table the MVP touches should have one.
    const policyless = await test.raw<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
          and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
        order by 1`,
    );

    // Three deliberate exceptions, and all three are rate-limit counters.
    // Each is reached only by something holding the secret key or running as
    // the owner, and there is no row on any of them a signed-in user should
    // see — least of all `voucher_attempts`, where a delete would be somebody
    // resetting their own throttle. The in-city tables left this list when
    // Phase 6 was built.
    assert.deepEqual(
      policyless.map((row) => row.relname),
      ['auth_recovery_requests', 'auth_sign_in_attempts', 'voucher_attempts'],
    );
  });
});

describe('table grants', () => {
  let test: TestDb;

  before(async () => {
    test = await migratedDatabase();
  });

  after(async () => test.close());

  it('gives a signed-out visitor read access to exactly what search needs', async () => {
    const readable = await test.raw<{ relname: string }>(
      `select c.relname
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and has_table_privilege('anon', c.oid, 'select')
        order by 1`,
    );

    assert.deepEqual(
      readable.map((row) => row.relname),
      // incity_zones joined the list with Phase 6: a passenger compares local
      // drop-off prices before signing in, exactly as they compare fares.
      [
        'cities',
        'departures',
        'fares',
        'incity_zones',
        'operators',
        'ratings',
        'route_stops',
        'routes',
        'stops',
      ],
    );
  });

  it('gives a signed-out visitor no write access anywhere', async () => {
    const writable = await test.raw<{ relname: string }>(
      `select c.relname
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and (has_table_privilege('anon', c.oid, 'insert')
            or has_table_privilege('anon', c.oid, 'update')
            or has_table_privilege('anon', c.oid, 'delete'))`,
    );

    assert.deepEqual(writable.map((row) => row.relname), []);
  });

  it('makes bookings read-only to the API', async () => {
    // Every write goes through a SECURITY DEFINER function that checks
    // per-leg capacity first. A booking that could be INSERTed directly is a
    // booking whose capacity was never checked.
    const [row] = await test.raw<{
      sel: boolean;
      ins: boolean;
      upd: boolean;
      del: boolean;
    }>(
      `select has_table_privilege('authenticated', 'public.bookings', 'select') as sel,
              has_table_privilege('authenticated', 'public.bookings', 'insert') as ins,
              has_table_privilege('authenticated', 'public.bookings', 'update') as upd,
              has_table_privilege('authenticated', 'public.bookings', 'delete') as del`,
    );

    assert.equal(row!.sel, true);
    assert.equal(row!.ins, false, 'inserting a booking must go through request_booking()');
    assert.equal(row!.upd, false, 'status transitions are guarded functions, not updates');
    assert.equal(row!.del, false);
  });

  it('keeps the fare audit log append-only', async () => {
    const [row] = await test.raw<{ ins: boolean; upd: boolean; del: boolean }>(
      `select has_table_privilege('authenticated', 'public.fare_changes', 'insert') as ins,
              has_table_privilege('authenticated', 'public.fare_changes', 'update') as upd,
              has_table_privilege('authenticated', 'public.fare_changes', 'delete') as del`,
    );

    assert.equal(row!.ins, true);
    assert.equal(row!.upd, false, 'an operator must not rewrite its own pricing history');
    assert.equal(row!.del, false);
  });

  it('makes an in-city ride read-only to the API, like a booking', async () => {
    // Every write is one of the request/approve/decline/cancel functions. A
    // row that could be UPDATEd directly is a price the passenger could
    // rewrite, or an address the operator could.
    const [ride] = await test.raw<{ sel: boolean; ins: boolean; upd: boolean; del: boolean }>(
      `select has_table_privilege('authenticated', 'public.incity_bookings', 'select') as sel,
              has_table_privilege('authenticated', 'public.incity_bookings', 'insert') as ins,
              has_table_privilege('authenticated', 'public.incity_bookings', 'update') as upd,
              has_table_privilege('authenticated', 'public.incity_bookings', 'delete') as del`,
    );

    assert.equal(ride!.sel, true);
    assert.equal(ride!.ins, false, 'a ride must go through request_incity_ride()');
    assert.equal(ride!.upd, false, 'status changes are guarded functions, not updates');
    assert.equal(ride!.del, false);

    // And a signed-out visitor holds nothing on it at all.
    const [anon] = await test.raw<{ any_priv: boolean }>(
      `select has_table_privilege('anon', 'public.incity_bookings', 'select')
           or has_table_privilege('anon', 'public.incity_bookings', 'insert') as any_priv`,
    );
    assert.equal(anon!.any_priv, false);
  });

  it('lets an operator manage its own zones, the way it manages its stops', async () => {
    const [row] = await test.raw<{ sel: boolean; ins: boolean; upd: boolean; del: boolean }>(
      `select has_table_privilege('authenticated', 'public.incity_zones', 'select') as sel,
              has_table_privilege('authenticated', 'public.incity_zones', 'insert') as ins,
              has_table_privilege('authenticated', 'public.incity_zones', 'update') as upd,
              has_table_privilege('authenticated', 'public.incity_zones', 'delete') as del`,
    );

    assert.equal(row!.sel, true);
    assert.equal(row!.ins, true);
    assert.equal(row!.upd, true);
    assert.equal(row!.del, true);
  });

  it('makes a voucher read-only to the API, and invisible to a visitor', async () => {
    // An operator reads its own codes on the promotions page. It does not
    // write them: RLS governs rows and not columns, so an update policy
    // scoped to "your own voucher" is also an update policy on `expires_at`.
    const [row] = await test.raw<{ sel: boolean; ins: boolean; upd: boolean; del: boolean }>(
      `select has_table_privilege('authenticated', 'public.vouchers', 'select') as sel,
              has_table_privilege('authenticated', 'public.vouchers', 'insert') as ins,
              has_table_privilege('authenticated', 'public.vouchers', 'update') as upd,
              has_table_privilege('authenticated', 'public.vouchers', 'delete') as del`,
    );

    assert.equal(row!.sel, true);
    assert.equal(row!.ins, false, 'a code is generated by create_voucher(), not chosen');
    assert.equal(row!.upd, false, 'withdrawing one is set_voucher_active()');
    assert.equal(row!.del, false);

    const [anon] = await test.raw<{ any_priv: boolean }>(
      `select has_table_privilege('anon', 'public.vouchers', 'select') as any_priv`,
    );
    assert.equal(anon!.any_priv, false, 'every live promotion, one select away');
  });

  it('lets the service role through, because it is the one that bypasses RLS', async () => {
    const [row] = await test.raw<{ n: number }>(
      `select count(*)::int as n
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and not has_table_privilege('service_role', c.oid, 'select')`,
    );
    assert.equal(row!.n, 0);
  });
});

describe('what the server itself calls', () => {
  let test: TestDb;

  before(async () => {
    test = await migratedDatabase();
  });

  after(async () => test.close());

  /**
   * Every function invoked through `createAdminClient()` — the service-role
   * client — has to be callable by `service_role`. Getting this wrong does not
   * fail at build, at typecheck, or in any test that runs as a user: it fails
   * at 08:00 on some future morning, and the symptom is departures quietly
   * ceasing to appear.
   *
   * Keep this list in step with the call sites in `app/api/cron/route.ts` and
   * anything else reaching for the admin client.
   */
  it('lets the service role call everything the scheduled job uses', async () => {
    const calledByCron = [
      'public.generate_departures(uuid, integer)',
      'public.expire_stale_holds()',
      // Not called by the cron, but by seeding and diagnostics. It returns
      // aggregate counts the service role can already compute from bookings,
      // and withholding it only makes tooling read an empty result as an
      // answer.
      'public.departure_leg_loads(uuid[])',
    ];

    for (const signature of calledByCron) {
      const [row] = await test.raw<{ ok: boolean }>(
        `select has_function_privilege('service_role', $1, 'execute') as ok`,
        [signature],
      );
      assert.equal(row!.ok, true, `${signature} is called by /api/cron as the service role`);
    }
  });

  it('does not hand the service role the passenger-facing functions', async () => {
    // Not a security boundary — service_role bypasses RLS and holds table
    // privileges regardless. It is a statement of intent: these take their
    // caller from auth.uid(), which is null for the service role, so calling
    // them from a script would fail confusingly rather than usefully.
    for (const signature of [
      'public.request_booking(uuid, uuid, uuid, integer, integer, text, text)',
      'public.approve_booking(uuid)',
    ]) {
      const [row] = await test.raw<{ ok: boolean }>(
        `select has_function_privilege('service_role', $1, 'execute') as ok`,
        [signature],
      );
      assert.equal(row!.ok, false, `${signature} is a user action, not a server one`);
    }
  });
});
