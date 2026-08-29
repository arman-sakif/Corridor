-- Corridor — Phase 2: operator setup
--
-- Opens the tables an operator fills in before it can sell anything: stops,
-- routes, fares, schedules, vehicles, and the team. Departures are opened here
-- too, because search reads them and Phase 3 only adds the generator.
--
-- Two shapes recur:
--   * the public may read a row only when its operator is 'active';
--   * only an owner or staff member of that operator may write it.
-- Drivers are members but write nothing here — they read manifests, in Phase 5.

-- ---------------------------------------------------------------------------
-- Every operator has an owner, from the moment it exists
-- ---------------------------------------------------------------------------

-- Without this the first membership is impossible to create: the policy on
-- operator_members requires an owner, and the applicant is not one yet.
create or replace function public.attach_operator_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.created_by is not null then
    insert into public.operator_members (operator_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (operator_id, user_id) do nothing;
  end if;
  return new;
end;
$fn$;

create trigger operators_attach_owner
  after insert on public.operators
  for each row execute function public.attach_operator_owner();

-- The applicant can read their own application.
--
-- Not a convenience. `insert ... returning id` makes Postgres check the SELECT
-- policies against the new row, and it does that *before* the AFTER trigger
-- above has attached the owner — so `operators_select_own`, which asks whether
-- the caller is a member, is false at exactly that moment. Without this policy
-- every operator signup fails with "new row violates row-level security
-- policy", which is a confusing way to say "you are not yet a member of the
-- business you just created".
create policy operators_select_creator on public.operators
  for select to authenticated
  using (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- Policy helpers
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so a policy can look through to another table without that
-- table's own policies filtering the answer, and without recursing.

create or replace function public.operator_is_active(p_operator_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.operators o
    where o.id = p_operator_id and o.status = 'active'
  );
$fn$;

create or replace function public.route_operator(p_route_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select r.operator_id from public.routes r where r.id = p_route_id;
$fn$;

create or replace function public.departure_operator(p_departure_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select d.operator_id from public.departures d where d.id = p_departure_id;
$fn$;

grant execute on function public.operator_is_active(uuid) to anon, authenticated;
grant execute on function public.route_operator(uuid)     to anon, authenticated;
grant execute on function public.departure_operator(uuid) to anon, authenticated;

-- Owner or staff. Drivers are deliberately excluded from every write below.
create or replace function public.is_operator_manager(p_operator_id uuid)
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
      and m.role in ('owner', 'staff')
  );
$fn$;

grant execute on function public.is_operator_manager(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- stops
-- ---------------------------------------------------------------------------

-- Passengers need stop labels to pick a pickup point, and they search before
-- signing in, so this is readable by anon.
create policy stops_select_public on public.stops
  for select to anon, authenticated
  using (is_active and public.operator_is_active(operator_id));

create policy stops_select_own on public.stops
  for select to authenticated
  using (public.is_operator_member(operator_id));

create policy stops_write_own on public.stops
  for all to authenticated
  using (public.is_operator_manager(operator_id))
  with check (public.is_operator_manager(operator_id));

create policy stops_admin_all on public.stops
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- routes
-- ---------------------------------------------------------------------------

create policy routes_select_public on public.routes
  for select to anon, authenticated
  using (is_active and public.operator_is_active(operator_id));

create policy routes_select_own on public.routes
  for select to authenticated
  using (public.is_operator_member(operator_id));

create policy routes_write_own on public.routes
  for all to authenticated
  using (public.is_operator_manager(operator_id))
  with check (public.is_operator_manager(operator_id));

create policy routes_admin_all on public.routes
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- route_stops
-- ---------------------------------------------------------------------------

create policy route_stops_select_public on public.route_stops
  for select to anon, authenticated
  using (public.operator_is_active(public.route_operator(route_id)));

create policy route_stops_select_own on public.route_stops
  for select to authenticated
  using (public.is_operator_member(public.route_operator(route_id)));

create policy route_stops_write_own on public.route_stops
  for all to authenticated
  using (public.is_operator_manager(public.route_operator(route_id)))
  with check (public.is_operator_manager(public.route_operator(route_id)));

-- ---------------------------------------------------------------------------
-- fares
-- ---------------------------------------------------------------------------

-- Search shows a price beside every departure, so fares are public too. The
-- price a passenger is charged is still recomputed server-side at booking
-- time; this read is for display.
create policy fares_select_public on public.fares
  for select to anon, authenticated
  using (public.operator_is_active(public.route_operator(route_id)));

create policy fares_select_own on public.fares
  for select to authenticated
  using (public.is_operator_member(public.route_operator(route_id)));

create policy fares_write_own on public.fares
  for all to authenticated
  using (public.is_operator_manager(public.route_operator(route_id)))
  with check (public.is_operator_manager(public.route_operator(route_id)));

-- ---------------------------------------------------------------------------
-- fare_changes
-- ---------------------------------------------------------------------------
-- Recorded, never enforced. Append-only by design: there is no update or
-- delete policy, so an operator cannot rewrite its own pricing history.

create policy fare_changes_select_own on public.fare_changes
  for select to authenticated
  using (public.is_operator_member(public.route_operator(route_id)));

create policy fare_changes_insert_own on public.fare_changes
  for insert to authenticated
  with check (
    public.is_operator_manager(public.route_operator(route_id))
    and changed_by = auth.uid()
  );

create policy fare_changes_select_admin on public.fare_changes
  for select to authenticated
  using (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- schedules
-- ---------------------------------------------------------------------------
-- Not public. Passengers see concrete departures, not the recurrence rule that
-- produced them.

create policy schedules_select_own on public.schedules
  for select to authenticated
  using (public.is_operator_member(public.route_operator(route_id)));

create policy schedules_write_own on public.schedules
  for all to authenticated
  using (public.is_operator_manager(public.route_operator(route_id)))
  with check (public.is_operator_manager(public.route_operator(route_id)));

-- ---------------------------------------------------------------------------
-- vehicles
-- ---------------------------------------------------------------------------
-- Never public: a passenger sees the operator and the time, nothing else.
-- Drivers can read the fleet, because a manifest names the vehicle they are in.

create policy vehicles_select_own on public.vehicles
  for select to authenticated
  using (public.is_operator_member(operator_id));

create policy vehicles_write_own on public.vehicles
  for all to authenticated
  using (public.is_operator_manager(operator_id))
  with check (public.is_operator_manager(operator_id));

-- ---------------------------------------------------------------------------
-- departures
-- ---------------------------------------------------------------------------

create policy departures_select_public on public.departures
  for select to anon, authenticated
  using (status = 'scheduled' and public.operator_is_active(operator_id));

create policy departures_select_own on public.departures
  for select to authenticated
  using (public.is_operator_member(operator_id));

create policy departures_write_own on public.departures
  for all to authenticated
  using (public.is_operator_manager(operator_id))
  with check (public.is_operator_manager(operator_id));

create policy departures_admin_all on public.departures
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
