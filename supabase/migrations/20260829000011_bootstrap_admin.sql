-- Corridor — let the first platform admin actually be created
--
-- `guard_platform_role` refuses a change to platform_role unless the caller is
-- the service role or is already a platform admin. Correct for API traffic —
-- and it also refused the one path the README documents for bootstrapping:
--
--     update public.profiles set platform_role = 'admin' where id = …
--
-- run from the SQL editor. In a direct database session there is no request
-- context at all: `auth.uid()` and `auth.role()` are both NULL. So the
-- service-role test failed, `is_platform_admin()` failed, and the trigger
-- raised. With no admin able to exist, no operator could ever be vetted, and
-- the platform could not be opened for business.
--
-- The same flaw sat in `guard_operator_status`, where it would have blocked a
-- support fix applied by hand.
--
-- The fix distinguishes an API caller from a database session. PostgREST sets
-- the role claim on every request — anon, authenticated, or service_role — so
-- a NULL `auth.role()` means nobody came in through the API. Someone holding a
-- direct connection already has whatever the database grants them and could
-- disable this trigger outright; refusing them here protects nothing and only
-- makes the product impossible to set up.
--
-- A caller cannot forge this. The claim comes from a JWT Supabase signs, and
-- PostgREST substitutes `anon` when there is no token, so the NULL case is not
-- reachable from the outside.

create or replace function public.guard_platform_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.platform_role is distinct from old.platform_role
     and auth.role() is not null            -- came in through the API
     and auth.role() <> 'service_role'
     and not public.is_platform_admin()
  then
    raise exception 'platform_role is granted by a platform admin only';
  end if;
  return new;
end;
$fn$;

create or replace function public.guard_operator_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.status is distinct from old.status
     and auth.role() is not null
     and auth.role() <> 'service_role'
     and not public.is_platform_admin()
  then
    raise exception 'operator status is changed by a platform admin only';
  end if;
  return new;
end;
$fn$;
