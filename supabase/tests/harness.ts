import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

/**
 * Runs the real migrations against a real Postgres.
 *
 * PGlite is Postgres compiled to WASM, so `request_booking()` here is the same
 * function that will run in Supabase — the row lock, the per-leg scan, and the
 * fare recomputation are all genuinely exercised rather than mocked. That
 * matters more here than anywhere else in the codebase: the capacity rule is
 * the thing most likely to break silently, and it lives entirely in SQL.
 *
 * What PGlite does not give us is Supabase's `auth` schema, so this stands in
 * a minimal one: an `auth.users` table for the profile trigger to hang off,
 * and `auth.uid()` / `auth.role()` reading a session setting we control. That
 * makes "who is calling" a thing the tests can set, which is exactly what
 * testing RLS and the SECURITY DEFINER guards needs.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

/** Supabase's auth surface, reduced to what the migrations actually touch. */
const AUTH_SHIM = `
  create schema if not exists auth;

  create table auth.users (
    id                 uuid primary key default gen_random_uuid(),
    email              text unique,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at         timestamptz not null default now()
  );

  -- The current caller. Tests set these with set_config, the way PostgREST
  -- sets the JWT claims on each request.
  create or replace function auth.uid() returns uuid
  language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  -- Falls back to the database role rather than assuming 'authenticated',
  -- so seeding as the owner is not mistaken for a signed-in passenger.
  create or replace function auth.role() returns text
  language sql stable as $fn$
    select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text);
  $fn$;

  -- PostgREST's roles. RLS policies name these, so they have to exist.
  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin bypassrls;
    end if;
  end
  $$;

  -- Supabase grants these; without them a policy calling auth.uid() fails with
  -- "permission denied for schema auth" rather than simply denying the row.
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
`;

export type TestDb = {
  db: PGlite;
  /** Run SQL as the given signed-in user, under RLS. */
  asUser<T = Record<string, unknown>>(
    userId: string | null,
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  /** Run SQL as a signed-out visitor, under RLS. */
  asAnon<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run SQL as the owner, bypassing RLS. Seeding only. */
  raw<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
};

export async function migratedDatabase(): Promise<TestDb> {
  const db = await new PGlite();

  await db.exec(AUTH_SHIM);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }

  // Deliberately NO blanket grant here.
  //
  // The project has "automatically expose new tables" turned off, so the API
  // roles get exactly the privileges 20260829000010_table_grants.sql hands
  // them and nothing else. Granting more here would make the tests pass
  // against privileges production does not have — which is how a
  // `permission denied for table` reaches a user instead of a test.

  // One transaction per call, with the role and the claims set locally inside
  // it — which is exactly what PostgREST does for every HTTP request. Anything
  // that passes here passes for the same reason it will pass in production.
  const asRole = async <T>(
    role: 'anon' | 'authenticated' | 'service_role',
    userId: string | null,
    sql: string,
    params?: unknown[],
  ): Promise<T[]> => {
    return db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
      await tx.query(`select set_config('request.jwt.claim.role', $1, true)`, [role]);
      const result = await tx.query<T>(sql, params);
      return result.rows;
    }) as Promise<T[]>;
  };

  return {
    db,
    asUser: (userId, sql, params) => asRole('authenticated', userId, sql, params),
    asAnon: (sql, params) => asRole('anon', null, sql, params),
    // Seeding runs as the owner, which bypasses RLS — but it still announces
    // itself as the service role, because that is what a script holding the
    // service-role key is. The guard triggers check `auth.role()`, so a seed
    // that lied about this would be blocked from granting admin exactly as a
    // passenger is.
    raw: async <T>(sql: string, params?: unknown[]) => {
      return db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claim.role', 'service_role', true)`);
        const result = await tx.query<T>(sql, params);
        return result.rows;
      }) as Promise<T[]>;
    },
    close: () => db.close(),
  };
}

/** A signed-up user with a completed profile. */
export async function createUser(
  test: TestDb,
  { email, name }: { email: string; name: string },
): Promise<string> {
  const [user] = await test.raw<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data)
     values ($1, jsonb_build_object('full_name', $2::text))
     returning id`,
    [email, name],
  );

  await test.raw(`update public.profiles set phone = '519-555-0100' where id = $1`, [user!.id]);

  return user!.id;
}
