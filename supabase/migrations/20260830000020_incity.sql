-- Corridor — Phase 6: the local ride from your drop-off
--
-- `incity_zones` and `incity_bookings` have existed since the first migration
-- with RLS on, no policies and no grants — switched off on purpose until the
-- feature was built. This turns them on.
--
-- The product: a passenger books Windsor to Toronto and is dropped at
-- Yorkdale. The last few kilometres home are currently their problem. An
-- in-city operator — a different business, `operators.type = 'incity'` — sells
-- that leg at a flat price per named zone.
--
-- ---------------------------------------------------------------------------
-- The shape, and why it is this shape
-- ---------------------------------------------------------------------------
-- `incity_bookings.booking_id` is NOT NULL and references bookings, so this is
-- an add-on to an intercity seat and never a standalone product. It is offered
-- only once that seat is approved: selling somebody a connection to a trip
-- they might not be on means unwinding it when the hold lapses.
--
-- Zones carry no geography — a name and a flat price. There are no coordinates
-- anywhere in this system, so the passenger picks a zone by name and types
-- their address as free text. Nobody checks the address against the zone; the
-- operator reads both and decides.
--
-- Which operators are offered is decided by city: an in-city operator declares
-- its own stops, and a booking dropping in that city is offered onward travel
-- from operators with an active stop there. That reuses stops and cities
-- rather than inventing a join table.
--
-- ---------------------------------------------------------------------------
-- What is deliberately absent: hold expiry
-- ---------------------------------------------------------------------------
-- An intercity hold expires because a held seat is inventory nobody else can
-- buy — expiry is what puts the seat back on sale, which is why capacity
-- queries exclude lapsed holds inline rather than trusting a job to run.
--
-- In-city has no inventory. A flat-priced zone ride blocks nothing, so a hold
-- that sits there costs no one a sale and expiring it would be cosmetic.
-- `incity_booking_status` has no `expired` value and this migration does not
-- add one.
--
-- What does matter is the parent. A booking that is cancelled, declined or
-- expires must not leave the passenger holding a connection to a trip that is
-- not happening — hence the trigger at the foot of this file.

-- One live add-on per booking. Nothing stopped two, and two rides from the
-- same drop-off is never what anyone meant.
create unique index incity_bookings_one_live_idx
  on public.incity_bookings (booking_id)
  where status in ('held', 'approved');

-- The passenger's view of their own add-ons, and the operator's queue.
create index incity_bookings_status_idx
  on public.incity_bookings (operator_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Zones
-- ---------------------------------------------------------------------------
-- Structurally the same thing as `stops`: an operator-owned list that
-- passengers read and only managers write. The policies are the stops policies
-- with the names changed, deliberately — a zone is no more sensitive than a
-- pickup point, and inventing a different shape here would only be a second
-- thing to reason about.

create policy incity_zones_select_public on public.incity_zones
  for select to anon, authenticated
  using (is_active and public.operator_is_active(operator_id));

create policy incity_zones_select_own on public.incity_zones
  for select to authenticated
  using (public.is_operator_member(operator_id));

create policy incity_zones_write_own on public.incity_zones
  for all to authenticated
  using (public.is_operator_manager(operator_id))
  with check (public.is_operator_manager(operator_id));

create policy incity_zones_admin_all on public.incity_zones
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- In-city bookings — read-only to the API, like bookings and notifications
-- ---------------------------------------------------------------------------
-- Two select policies and nothing else. RLS governs rows, not columns, so an
-- update policy scoped to "your own row" would let a passenger rewrite the
-- price they were quoted, and let an operator rewrite the address they were
-- given. Every status change goes through a function below.

create policy incity_bookings_select_passenger on public.incity_bookings
  for select to authenticated
  using (
    exists (
      select 1 from public.bookings b
       where b.id = incity_bookings.booking_id
         and b.passenger_id = auth.uid()
    )
  );

create policy incity_bookings_select_operator on public.incity_bookings
  for select to authenticated
  using (public.is_operator_member(operator_id));

-- ---------------------------------------------------------------------------
-- Requesting one
-- ---------------------------------------------------------------------------

create or replace function public.request_incity_ride(
  p_booking_id          uuid,
  p_operator_id         uuid,
  p_pickup_stop_id      uuid,
  p_zone_id             uuid,
  p_destination_address text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_passenger  uuid := auth.uid();
  v_booking    record;
  v_drop_city  uuid;
  v_stop_city  uuid;
  v_price      integer;
  v_id         uuid;
begin
  if v_passenger is null then
    raise exception 'You need to be signed in to book a local ride.';
  end if;

  if btrim(coalesce(p_destination_address, '')) = '' then
    raise exception 'Tell the driver where you are going.';
  end if;

  select b.id, b.passenger_id, b.status, b.to_stop_id
    into v_booking
    from public.bookings b
   where b.id = p_booking_id;

  if not found then
    raise exception 'That booking no longer exists.';
  end if;

  if v_booking.passenger_id <> v_passenger then
    raise exception 'That booking is not yours.';
  end if;

  -- Offered only on a confirmed seat. A hold can still lapse or be declined.
  if v_booking.status <> 'approved' then
    raise exception 'Your seat has to be confirmed before you can add a local ride.';
  end if;

  -- The selling operator has to be an active in-city business. Nothing in the
  -- schema ties `operator_id` to the zone or the stop below, so all three are
  -- checked here — this function is the only thing that can.
  if not exists (
    select 1 from public.operators o
     where o.id = p_operator_id
       and o.type = 'incity'
       and o.status = 'active'
  ) then
    raise exception 'That operator is not taking local rides.';
  end if;

  select z.flat_price_cents into v_price
    from public.incity_zones z
   where z.id = p_zone_id
     and z.operator_id = p_operator_id
     and z.is_active;

  if v_price is null then
    raise exception 'That drop-off area is not one this operator covers.';
  end if;

  -- The pickup point belongs to the in-city operator, and has to be in the
  -- city the passenger is actually being dropped in. Without this a Toronto
  -- shuttle could be booked off a Windsor arrival.
  select s.city_id into v_stop_city
    from public.stops s
   where s.id = p_pickup_stop_id
     and s.operator_id = p_operator_id
     and s.is_active;

  if v_stop_city is null then
    raise exception 'That pickup point is not one this operator uses.';
  end if;

  select s.city_id into v_drop_city
    from public.stops s
   where s.id = v_booking.to_stop_id;

  if v_stop_city <> v_drop_city then
    raise exception 'That pickup point is not in the city you are arriving in.';
  end if;

  -- The price is read from the zone, never taken from the caller — the same
  -- rule request_booking() follows, and for the same reason: a price that
  -- arrives from a browser is a price the passenger chose.
  insert into public.incity_bookings (
    booking_id, operator_id, pickup_stop_id, zone_id, destination_address,
    price_cents, status
  )
  values (
    p_booking_id, p_operator_id, p_pickup_stop_id, p_zone_id,
    btrim(p_destination_address), v_price, 'held'
  )
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'You already have a local ride on this booking.';
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Deciding on one
-- ---------------------------------------------------------------------------

create or replace function public.approve_incity_ride(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_operator uuid;
  v_status   public.incity_booking_status;
begin
  select operator_id, status into v_operator, v_status
    from public.incity_bookings
   where id = p_id;

  if v_operator is null then
    raise exception 'That request no longer exists.';
  end if;

  if not public.is_operator_manager(v_operator) then
    raise exception 'Only this operator can confirm that ride.';
  end if;

  if v_status <> 'held' then
    raise exception 'That request is no longer waiting for a decision.';
  end if;

  update public.incity_bookings set status = 'approved' where id = p_id;
end;
$fn$;

create or replace function public.decline_incity_ride(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_operator uuid;
  v_status   public.incity_booking_status;
begin
  select operator_id, status into v_operator, v_status
    from public.incity_bookings
   where id = p_id;

  if v_operator is null then
    raise exception 'That request no longer exists.';
  end if;

  if not public.is_operator_manager(v_operator) then
    raise exception 'Only this operator can decline that ride.';
  end if;

  if v_status <> 'held' then
    raise exception 'That request is no longer waiting for a decision.';
  end if;

  update public.incity_bookings set status = 'declined' where id = p_id;
end;
$fn$;

-- Either side may cancel, as with an intercity booking: nothing is prepaid.
create or replace function public.cancel_incity_ride(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_ride       record;
  v_passenger  uuid;
begin
  select r.*, b.passenger_id
    into v_ride
    from public.incity_bookings r
    join public.bookings b on b.id = r.booking_id
   where r.id = p_id;

  if not found then
    raise exception 'That ride no longer exists.';
  end if;

  v_passenger := v_ride.passenger_id;

  if v_passenger <> auth.uid() and not public.is_operator_manager(v_ride.operator_id) then
    raise exception 'That ride is not yours to cancel.';
  end if;

  if v_ride.status not in ('held', 'approved') then
    raise exception 'That ride cannot be cancelled now.';
  end if;

  update public.incity_bookings set status = 'cancelled' where id = p_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Following the parent booking
-- ---------------------------------------------------------------------------
-- A seat that is cancelled, declined or lapsed takes its local ride with it.
-- Without this the passenger keeps a confirmed connection to a trip they are
-- not on, and the in-city operator sends a car for nobody.
--
-- It lives here rather than in the booking functions on purpose: in-city is an
-- add-on that has to be removable without touching the core flow, and a
-- trigger declared in this migration means nothing in the booking path knows
-- this feature exists.

create or replace function public.cancel_incity_on_parent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.status is distinct from old.status
     and new.status not in ('held', 'approved', 'completed', 'settled')
  then
    update public.incity_bookings
       set status = 'cancelled'
     where booking_id = new.id
       and status in ('held', 'approved');
  end if;

  return new;
end;
$fn$;

create trigger bookings_cancel_incity
  after update of status on public.bookings
  for each row execute function public.cancel_incity_on_parent();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- 20260829000010 revoked default privileges on new tables for anon and
-- authenticated, and 20260829000008 revoked EXECUTE from PUBLIC as a one-time
-- sweep over the functions existing then — every function created since
-- defaults to PUBLIC EXECUTE again. Both have to be stated, every time.

-- Zones are read like stops: a passenger compares prices before committing,
-- and search happens before anyone signs in.
grant select on table public.incity_zones to anon, authenticated;
grant insert, update, delete on table public.incity_zones to authenticated;
grant select, insert, update, delete on table public.incity_zones to service_role;

-- Read-only to the API. Every write is one of the functions above.
grant select on table public.incity_bookings to authenticated;
grant select, insert, update, delete on table public.incity_bookings to service_role;

revoke all on function public.request_incity_ride(uuid, uuid, uuid, uuid, text) from public;
revoke all on function public.approve_incity_ride(uuid) from public;
revoke all on function public.decline_incity_ride(uuid) from public;
revoke all on function public.cancel_incity_ride(uuid) from public;
revoke all on function public.cancel_incity_on_parent() from public;

grant execute on function public.request_incity_ride(uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.approve_incity_ride(uuid) to authenticated;
grant execute on function public.decline_incity_ride(uuid) to authenticated;
grant execute on function public.cancel_incity_ride(uuid) to authenticated;
