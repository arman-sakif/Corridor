-- Corridor — Phase 5: departure day
--
-- Assignment, the driver's view, completion, and settling up. Payment happens
-- off-platform after the trip, so "settled" here means both sides said the
-- same thing about money that never touched us.

-- ---------------------------------------------------------------------------
-- Who is driving what
-- ---------------------------------------------------------------------------
-- A departure can have MANY vehicles: that is how a 12-passenger departure
-- splits across two vans. Assignment is late-bound and entirely the operator's
-- call, and it is never exposed to passengers — there is no public policy on
-- this table and there must never be one.

create policy departure_vehicles_select_member on public.departure_vehicles
  for select to authenticated
  using (public.is_operator_member(public.departure_operator(departure_id)));

create policy departure_vehicles_write_manager on public.departure_vehicles
  for all to authenticated
  using (public.is_operator_manager(public.departure_operator(departure_id)))
  with check (public.is_operator_manager(public.departure_operator(departure_id)));

-- is_departure_driver() lives in 20260829000005_booking.sql, because the
-- bookings select policy there already needs it.

-- ---------------------------------------------------------------------------
-- assign_booking_vehicle — put a passenger in a van
-- ---------------------------------------------------------------------------
-- Deliberately does not enforce the vehicle's seat count. An operator moving
-- people between two vans on a cold morning knows more about what fits than we
-- do, and a hard stop here would mean editing the manifest on paper instead.

create or replace function public.assign_booking_vehicle(
  p_booking_id uuid,
  p_vehicle_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_operator uuid;
  v_departure uuid;
begin
  select d.operator_id, d.id into v_operator, v_departure
    from public.bookings b
    join public.departures d on d.id = b.departure_id
   where b.id = p_booking_id;

  if v_operator is null then
    raise exception 'That booking no longer exists.';
  end if;

  if not public.is_operator_manager(v_operator) then
    raise exception 'Only this operator can assign a vehicle.';
  end if;

  if p_vehicle_id is not null then
    if not exists (
      select 1 from public.vehicles v
      where v.id = p_vehicle_id and v.operator_id = v_operator
    ) then
      raise exception 'That vehicle is not one of yours.';
    end if;

    -- The vehicle has to actually be running this departure.
    if not exists (
      select 1 from public.departure_vehicles dv
      where dv.departure_id = v_departure and dv.vehicle_id = p_vehicle_id
    ) then
      raise exception 'Put that vehicle on this departure first.';
    end if;
  end if;

  update public.bookings
     set assigned_vehicle_id = p_vehicle_id
   where id = p_booking_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- complete_departure — the trip ran
-- ---------------------------------------------------------------------------
-- Moves every confirmed booking to 'completed', which is what opens the
-- payment question on both sides. Bookings already marked no_show are left
-- alone: the driver marked those for a reason.

create or replace function public.complete_departure(p_departure_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_operator uuid;
  v_count    integer;
begin
  select operator_id into v_operator from public.departures where id = p_departure_id;

  if v_operator is null then
    raise exception 'That departure no longer exists.';
  end if;

  if not public.is_operator_manager(v_operator)
     and not public.is_departure_driver(p_departure_id) then
    raise exception 'Only this operator can close off that departure.';
  end if;

  update public.bookings
     set status = 'completed'
   where departure_id = p_departure_id
     and status = 'approved';

  get diagnostics v_count = row_count;

  update public.departures set status = 'completed' where id = p_departure_id;

  return v_count;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- mark_no_show — they did not turn up
-- ---------------------------------------------------------------------------

create or replace function public.mark_no_show(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_operator uuid;
  v_departure uuid;
  v_passenger uuid;
  v_status public.booking_status;
begin
  select d.operator_id, d.id, b.passenger_id, b.status
    into v_operator, v_departure, v_passenger, v_status
    from public.bookings b
    join public.departures d on d.id = b.departure_id
   where b.id = p_booking_id;

  if v_operator is null then
    raise exception 'That booking no longer exists.';
  end if;

  if not public.is_operator_manager(v_operator)
     and not public.is_departure_driver(v_departure) then
    raise exception 'Only this operator can mark a no-show.';
  end if;

  if v_status not in ('approved', 'completed') then
    raise exception 'Only a confirmed booking can be marked as a no-show.';
  end if;

  update public.bookings set status = 'no_show' where id = p_booking_id;

  -- A no-show is a red flag by definition. Recording it here means the next
  -- operator sees it without anyone having to remember to write it down.
  insert into public.red_flags (booking_id, operator_id, passenger_id, reason, note, created_by)
  values (p_booking_id, v_operator, v_passenger, 'no_show',
          'Recorded automatically when the driver marked the seat empty.', auth.uid());
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Settling up
-- ---------------------------------------------------------------------------
-- No money moves through Corridor. Both sides say what happened, and the
-- booking settles only when they agree.
--
--   1. Trip completes.
--   2. Passenger: "cash or e-transfer?"  -> payment_method, passenger_confirmed_at
--   3. Driver:    "did you get paid?"    -> driver_confirmed_at
--   4. Both present -> settled. Driver says no -> a did_not_pay red flag.

create or replace function public.confirm_payment_as_passenger(
  p_booking_id     uuid,
  p_payment_method public.payment_method
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_booking record;
begin
  select * into v_booking from public.bookings where id = p_booking_id;

  if not found or v_booking.passenger_id <> auth.uid() then
    raise exception 'That booking is not yours.';
  end if;

  if v_booking.status not in ('completed', 'settled') then
    raise exception 'You can confirm payment once the trip has run.';
  end if;

  update public.bookings
     set payment_method = p_payment_method,
         passenger_confirmed_at = coalesce(passenger_confirmed_at, now()),
         status = case when driver_confirmed_at is not null then 'settled' else status end
   where id = p_booking_id;
end;
$fn$;

create or replace function public.confirm_payment_as_driver(
  p_booking_id uuid,
  p_received   boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_booking   record;
  v_operator  uuid;
  v_departure uuid;
begin
  -- b.* already carries departure_id, so the operator is aliased rather than
  -- selecting d.id again: a record with two fields of the same name is
  -- ambiguous the moment you read it.
  select b.*, d.operator_id as owning_operator
    into v_booking
    from public.bookings b
    join public.departures d on d.id = b.departure_id
   where b.id = p_booking_id;

  if not found then
    raise exception 'That booking no longer exists.';
  end if;

  v_operator := v_booking.owning_operator;
  v_departure := v_booking.departure_id;

  if not public.is_operator_manager(v_operator)
     and not public.is_departure_driver(v_departure) then
    raise exception 'Only this operator can confirm payment.';
  end if;

  if v_booking.status not in ('completed', 'settled') then
    raise exception 'Payment can be confirmed once the trip has run.';
  end if;

  if p_received then
    update public.bookings
       set driver_confirmed_at = coalesce(driver_confirmed_at, now()),
           status = case when passenger_confirmed_at is not null then 'settled' else status end
     where id = p_booking_id;
  else
    -- Not settled, and recorded against the passenger. The money is still
    -- owed; Corridor simply notes that it was not paid.
    insert into public.red_flags (booking_id, operator_id, passenger_id, reason, note, created_by)
    values (p_booking_id, v_operator, v_booking.passenger_id, 'did_not_pay',
            'Driver reported the fare was not paid.', auth.uid())
    on conflict do nothing;
  end if;
end;
$fn$;

grant execute on function public.assign_booking_vehicle(uuid, uuid)                      to authenticated;
grant execute on function public.complete_departure(uuid)                                to authenticated;
grant execute on function public.mark_no_show(uuid)                                      to authenticated;
grant execute on function public.confirm_payment_as_passenger(uuid, public.payment_method) to authenticated;
grant execute on function public.confirm_payment_as_driver(uuid, boolean)                to authenticated;

-- ---------------------------------------------------------------------------
-- What a driver can see
-- ---------------------------------------------------------------------------
-- A driver is an operator member, so the existing select policies on bookings,
-- departures, and vehicles already cover the manifest. They are given no write
-- policy anywhere: every change they make goes through a function above, which
-- checks that they are actually assigned to that departure.

create policy departures_select_driver on public.departures
  for select to authenticated
  using (public.is_departure_driver(id));
