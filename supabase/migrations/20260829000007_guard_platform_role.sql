-- Corridor — close a privilege escalation
--
-- `20260827000002_rls_baseline.sql` said:
--
--     platform_role is intentionally NOT writable through any policy.
--     Granting admin is a service-role operation, so no one can promote
--     themselves.
--
-- That was wrong, and wrong in the worst direction. A row-level policy governs
-- WHICH ROWS a statement may touch, not which columns. `profiles_update_own`
-- lets a user update their own row, and their own row includes platform_role —
-- so any signed-in user could run
--
--     update profiles set platform_role = 'admin' where id = auth.uid()
--
-- and become a platform admin, with the power to vet operators and read every
-- profile on the platform.
--
-- Postgres has no per-column RLS. Column privileges via GRANT would work but
-- are invisible next to the policies and easy to lose on the next `grant all`.
-- A trigger states the rule where anyone reading the table will find it.

create or replace function public.guard_platform_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.platform_role is distinct from old.platform_role
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_platform_admin()
  then
    raise exception 'platform_role is granted by a platform admin only';
  end if;
  return new;
end;
$fn$;

create trigger profiles_guard_platform_role
  before update on public.profiles
  for each row execute function public.guard_platform_role();
