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
      'public.request_booking(uuid, uuid, uuid, integer, integer, text)',
      'public.approve_booking(uuid)',
      'public.cancel_booking(uuid)',
      'public.set_fare(uuid, integer, integer, integer, text)',
      'public.save_route(uuid, uuid, text, public.pricing_mode, uuid[])',
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

    // In-city is Phase 6: its tables exist, deny everything, and that is
    // deliberate until the feature is built.
    assert.deepEqual(
      policyless.map((row) => row.relname),
      ['incity_bookings', 'incity_zones'],
    );
  });
});
