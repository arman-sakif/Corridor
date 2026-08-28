-- Corridor — RLS baseline (Phase 0 / Phase 1)
--
-- Deliberately narrow. Every table already has RLS enabled and denies
-- everything; this migration opens only what identity, admin vetting, and the
-- public operator profile need. Booking, fare, schedule, and manifest policies
-- arrive with their own phases.
--
-- Membership and admin checks are SECURITY DEFINER functions. They read tables
-- that are themselves under RLS, so calling them from inside a policy would
-- otherwise recurse. search_path is pinned so a caller cannot shadow `public`.

-- ---------------------------------------------------------------------------
-- Policy helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.platform_role = 'admin'
  );
$fn$;

-- True when the caller belongs to this operator in any role.
create or replace function public.is_operator_member(p_operator_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
    from public.operator_members m
    where m.operator_id = p_operator_id
      and m.user_id = auth.uid()
  );
$fn$;

-- True when the caller belongs to this operator in one of the given roles.
-- Use this for anything a driver must not do: has_operator_role(id,
-- array['owner','staff']::operator_member_role[]).
create or replace function public.has_operator_role(
  p_operator_id uuid,
  p_roles public.operator_member_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
    from public.operator_members m
    where m.operator_id = p_operator_id
      and m.user_id = auth.uid()
      and m.role = any (p_roles)
  );
$fn$;

grant execute on function public.is_platform_admin()                                    to authenticated;
grant execute on function public.is_operator_member(uuid)                               to authenticated;
grant execute on function public.has_operator_role(uuid, public.operator_member_role[]) to authenticated;
grant execute on function public.toronto_instant(date, time)                            to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Profile creation
-- ---------------------------------------------------------------------------

-- Signup asks for nothing, so every new auth user gets an empty profile row and
-- completes it afterwards. full_name is seeded from the Google OAuth payload
-- when it is there.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name',
                          new.raw_user_meta_data ->> 'name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

-- A passenger reads and edits only their own profile. Operators need to see a
-- requesting passenger's name, phone, gender, photo, and accommodation notes at
-- approval time, but that read is scoped to a booking they own and belongs with
-- the booking policies in Phase 4 — not to a blanket policy here.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- The trigger above normally creates the row; this covers a client-side upsert
-- for an account that predates the trigger.
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (public.is_platform_admin());

-- platform_role is intentionally NOT writable through any policy. Granting
-- admin is a service-role operation, so no one can promote themselves.

-- ---------------------------------------------------------------------------
-- cities
-- ---------------------------------------------------------------------------

-- Search is anonymous: a passenger arriving from a Kijiji link picks a city
-- pair before signing in.
create policy cities_select_public on public.cities
  for select to anon, authenticated
  using (is_active);

create policy cities_admin_all on public.cities
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- operators
-- ---------------------------------------------------------------------------

-- Only active operators are visible publicly. A pending operator is invisible
-- to passengers until an admin vets it.
create policy operators_select_public on public.operators
  for select to anon, authenticated
  using (status = 'active');

create policy operators_select_own on public.operators
  for select to authenticated
  using (public.is_operator_member(id));

-- Anyone signed in may apply. status defaults to 'pending' and is not
-- updatable by the operator: the owner policy below withholds it.
create policy operators_insert_self on public.operators
  for insert to authenticated
  with check (created_by = auth.uid() and status = 'pending');

-- Owners edit their own business details. Status is guarded by the trigger
-- below rather than by a with-check: a policy on operators cannot read
-- operators to compare the old value without recursing.
create policy operators_update_own on public.operators
  for update to authenticated
  using (public.has_operator_role(id, array['owner']::public.operator_member_role[]))
  with check (public.has_operator_role(id, array['owner']::public.operator_member_role[]));

create policy operators_admin_all on public.operators
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- Activation and suspension are the platform's call, never the operator's.
create or replace function public.guard_operator_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.status is distinct from old.status
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_platform_admin()
  then
    raise exception 'operator status is changed by a platform admin only';
  end if;
  return new;
end;
$fn$;

create trigger operators_guard_status
  before update on public.operators
  for each row execute function public.guard_operator_status();

-- ---------------------------------------------------------------------------
-- operator_members
-- ---------------------------------------------------------------------------

-- Needed for role routing at sign-in: which dashboard does this user land on?
create policy operator_members_select_own on public.operator_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_operator_member(operator_id));

create policy operator_members_manage_by_owner on public.operator_members
  for all to authenticated
  using (public.has_operator_role(operator_id, array['owner']::public.operator_member_role[]))
  with check (public.has_operator_role(operator_id, array['owner']::public.operator_member_role[]));

create policy operator_members_admin_all on public.operator_members
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------

-- Operators read their own state; only an admin writes it, because payment is
-- collected off-platform and recorded by hand.
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated
  using (public.is_operator_member(operator_id));

create policy subscriptions_admin_all on public.subscriptions
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
