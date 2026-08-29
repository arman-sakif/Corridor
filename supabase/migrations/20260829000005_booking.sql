-- Corridor — Phase 4: booking
--
-- The single most important file in this schema. Everything here exists
-- because per-leg capacity cannot be enforced correctly from application code:
-- a read-then-write in TypeScript is a race, and two passengers taking the
-- last seat at the same instant would both succeed.

-- ---------------------------------------------------------------------------
-- departure_leg_loads — how full each leg is
-- ---------------------------------------------------------------------------
-- Passengers must be able to see "3 seats left" without being able to read
-- anyone else's booking. This returns counts and nothing else, so it is safe
-- to expose to anon.
--
-- A booking occupies leg `i` for every i where from_seq <= i and to_seq >= i+1,
-- and `leg_start` is that i — the sequence number the leg departs from.
--
-- Expired holds are excluded INLINE. That is what makes capacity self-healing:
-- a seat frees itself the instant its hold lapses, whether or not any
-- background job has run.

create or replace function public.departure_leg_loads(p_departure_ids uuid[])
returns table (departure_id uuid, leg_start integer, seats_taken integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select b.departure_id, g.seq::integer, sum(b.seats)::integer
  from public.bookings b
  cross join lateral generate_series(b.from_seq, b.to_seq - 1) as g(seq)
  where b.departure_id = any (p_departure_ids)
    and (
      b.status in ('approved', 'completed', 'settled')
      or (b.status = 'held' and b.hold_expires_at > now())
    )
  group by b.departure_id, g.seq;
$fn$;

grant execute on function public.departure_leg_loads(uuid[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- request_booking — the capacity function
-- ---------------------------------------------------------------------------
-- Locks the departure row, computes per-leg usage, rejects if any leg the
-- booking spans would exceed max_seats, and inserts the hold. One statement
-- from the caller's point of view, so there is no window between the check and
-- the write.
--
-- The fare is recomputed here from the operator's own rows and snapshotted
-- onto the booking. A price sent by the client is not a parameter — it cannot
-- be, or it would be trusted.
--
-- max_seats comes from the DEPARTURE, never from the schedule: editing a
-- schedule must not change the capacity of a departure already sold.

create or replace function public.request_booking(
  p_departure_id   uuid,
  p_from_stop_id   uuid,
  p_to_stop_id     uuid,
  p_seats          integer,
  p_luggage_count  integer,
  p_passenger_note text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_passenger      uuid := auth.uid();
  v_departure      record;
  v_from_seq       integer;
  v_to_seq         integer;
  v_pricing_mode   public.pricing_mode;
  v_base_per_seat  integer;
  v_leg            integer;
  v_taken          integer;
  v_hold_expires   timestamptz;
  v_booking_id     uuid;
begin
  if v_passenger is null then
    raise exception 'You need to be signed in to request a seat.';
  end if;

  if p_seats < 1 then
    raise exception 'A booking needs at least one seat.';
  end if;

  if coalesce(p_luggage_count, 0) < 0 then
    raise exception 'Luggage cannot be negative.';
  end if;

  -- Lock the departure. Every concurrent request for the same departure
  -- queues here, which is precisely the point: the count below is then taken
  -- against a state nobody else can be changing.
  select d.id, d.route_id, d.operator_id, d.max_seats, d.status,
         d.service_date, d.departure_time
    into v_departure
    from public.departures d
   where d.id = p_departure_id
     for update;

  if not found then
    raise exception 'That departure no longer exists.';
  end if;

  if v_departure.status <> 'scheduled' then
    raise exception 'That departure is no longer running.';
  end if;

  if public.toronto_instant(v_departure.service_date, v_departure.departure_time) <= now() then
    raise exception 'That departure has already left.';
  end if;

  if not public.operator_is_active(v_departure.operator_id) then
    raise exception 'That operator is not taking bookings.';
  end if;

  select rs.seq into v_from_seq
    from public.route_stops rs
   where rs.route_id = v_departure.route_id and rs.stop_id = p_from_stop_id;

  select rs.seq into v_to_seq
    from public.route_stops rs
   where rs.route_id = v_departure.route_id and rs.stop_id = p_to_stop_id;

  if v_from_seq is null or v_to_seq is null then
    raise exception 'Those stops are not both on this route.';
  end if;

  if v_to_seq <= v_from_seq then
    raise exception 'This departure travels the other way along those stops.';
  end if;

  -- ---- capacity, leg by leg -------------------------------------------
  -- Not per departure. A 16-seat van can carry far more than 16 bookings, so
  -- long as no single stretch between two stops exceeds 16.
  for v_leg in v_from_seq .. (v_to_seq - 1) loop
    select coalesce(sum(b.seats), 0) into v_taken
      from public.bookings b
     where b.departure_id = p_departure_id
       and b.from_seq <= v_leg
       and b.to_seq   >= v_leg + 1
       and (
         b.status in ('approved', 'completed', 'settled')
         or (b.status = 'held' and b.hold_expires_at > now())
       );

    if v_taken + p_seats > v_departure.max_seats then
      raise exception 'There are not enough seats left on this departure for that trip.'
        using errcode = 'check_violation';
    end if;
  end loop;

  -- ---- fare, recomputed from the operator's rows -----------------------
  select r.pricing_mode into v_pricing_mode
    from public.routes r where r.id = v_departure.route_id;

  if v_pricing_mode = 'matrix' then
    select f.price_cents into v_base_per_seat
      from public.fares f
     where f.route_id = v_departure.route_id
       and f.from_seq = v_from_seq
       and f.to_seq = v_to_seq;
  else
    -- additive: sum the consecutive legs the segment spans. A single missing
    -- leg leaves this null, which means the segment is not for sale.
    select case
             when count(*) = (v_to_seq - v_from_seq) then sum(f.price_cents)::integer
             else null
           end
      into v_base_per_seat
      from public.fares f
     where f.route_id = v_departure.route_id
       and f.from_seq >= v_from_seq
       and f.to_seq <= v_to_seq
       and f.to_seq = f.from_seq + 1;
  end if;

  if v_base_per_seat is null then
    raise exception 'This operator does not sell that pair of stops.';
  end if;

  -- ---- the hold --------------------------------------------------------
  -- An hour to decide, but never past the departure itself.
  v_hold_expires := least(
    now() + interval '1 hour',
    public.toronto_instant(v_departure.service_date, v_departure.departure_time)
  );

  insert into public.bookings (
    departure_id, passenger_id,
    from_stop_id, to_stop_id, from_seq, to_seq, seats,
    status, hold_expires_at,
    luggage_count, base_cents, luggage_cents, airport_cents, total_cents,
    passenger_note
  ) values (
    p_departure_id, v_passenger,
    p_from_stop_id, p_to_stop_id, v_from_seq, v_to_seq, p_seats,
    'held', v_hold_expires,
    coalesce(p_luggage_count, 0),
    v_base_per_seat * p_seats,
    0,  -- luggage and airport surcharges are operator-configurable in a later
    0,  -- phase; the columns exist so the snapshot shape never changes.
    v_base_per_seat * p_seats,
    nullif(btrim(coalesce(p_passenger_note, '')), '')
  )
  returning id into v_booking_id;

  return v_booking_id;
end;
$fn$;

grant execute on function public.request_booking(uuid, uuid, uuid, integer, integer, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Status transitions
-- ---------------------------------------------------------------------------
-- Guarded in the database rather than by an RLS with-check, because each one
-- is a rule about which state may follow which — something a policy cannot
-- express without reading the row it is protecting.

create or replace function public.approve_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_booking   record;
  v_leg       integer;
  v_taken     integer;
  v_max_seats integer;
begin
  select b.*, d.max_seats, d.operator_id
    into v_booking
    from public.bookings b
    join public.departures d on d.id = b.departure_id
   where b.id = p_booking_id
     for update of b;

  if not found then
    raise exception 'That request no longer exists.';
  end if;

  if not public.is_operator_manager(v_booking.operator_id) then
    raise exception 'Only this operator can approve that request.';
  end if;

  if v_booking.status <> 'held' then
    raise exception 'That request is no longer waiting for a decision.';
  end if;

  v_max_seats := v_booking.max_seats;

  -- The hold may have lapsed while the operator was deciding, and the seat may
  -- have gone to someone else in the meantime. Re-check before approving.
  for v_leg in v_booking.from_seq .. (v_booking.to_seq - 1) loop
    select coalesce(sum(b.seats), 0) into v_taken
      from public.bookings b
     where b.departure_id = v_booking.departure_id
       and b.id <> p_booking_id
       and b.from_seq <= v_leg
       and b.to_seq   >= v_leg + 1
       and (
         b.status in ('approved', 'completed', 'settled')
         or (b.status = 'held' and b.hold_expires_at > now())
       );

    if v_taken + v_booking.seats > v_max_seats then
      raise exception 'Those seats were taken while this request was waiting.'
        using errcode = 'check_violation';
    end if;
  end loop;

  update public.bookings
     set status = 'approved',
         approved_at = now(),
         hold_expires_at = null
   where id = p_booking_id;
end;
$fn$;

create or replace function public.decline_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_operator uuid;
  v_status   public.booking_status;
begin
  select d.operator_id, b.status into v_operator, v_status
    from public.bookings b
    join public.departures d on d.id = b.departure_id
   where b.id = p_booking_id;

  if v_operator is null then
    raise exception 'That request no longer exists.';
  end if;

  if not public.is_operator_manager(v_operator) then
    raise exception 'Only this operator can decline that request.';
  end if;

  if v_status <> 'held' then
    raise exception 'That request is no longer waiting for a decision.';
  end if;

  update public.bookings
     set status = 'declined', hold_expires_at = null
   where id = p_booking_id;
end;
$fn$;

-- Cancellation is free and unlimited, because nothing is prepaid. It is
-- recorded, and operators can see a passenger's history when they decide
-- whether to approve the next request.
create or replace function public.cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_booking  record;
  v_operator uuid;
  v_by_owner boolean;
begin
  select b.*, d.operator_id
    into v_booking
    from public.bookings b
    join public.departures d on d.id = b.departure_id
   where b.id = p_booking_id;

  if not found then
    raise exception 'That booking no longer exists.';
  end if;

  v_operator := v_booking.operator_id;
  v_by_owner := (v_booking.passenger_id = auth.uid());

  if not v_by_owner and not public.is_operator_manager(v_operator) then
    raise exception 'That booking is not yours to cancel.';
  end if;

  if v_booking.status not in ('held', 'approved') then
    raise exception 'That booking cannot be cancelled now.';
  end if;

  -- The cast is required: a CASE over bare string literals is text, and
  -- Postgres will not silently coerce text into an enum column.
  update public.bookings
     set status = (case when v_by_owner then 'cancelled_by_passenger'
                        else 'cancelled_by_operator' end)::public.booking_status,
         cancelled_at = now(),
         hold_expires_at = null
   where id = p_booking_id;
end;
$fn$;

grant execute on function public.approve_booking(uuid) to authenticated;
grant execute on function public.decline_booking(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid)  to authenticated;

-- ---------------------------------------------------------------------------
-- expire_stale_holds — cosmetic only
-- ---------------------------------------------------------------------------
-- Flips lapsed holds to 'expired' so a passenger's list reads honestly.
-- Capacity does NOT depend on this: the queries above already exclude expired
-- holds inline. If this never runs, seats are still freed correctly.

create or replace function public.expire_stale_holds()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_count integer;
begin
  update public.bookings
     set status = 'expired'
   where status = 'held'
     and hold_expires_at is not null
     and hold_expires_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- bookings RLS
-- ---------------------------------------------------------------------------
-- Writes go exclusively through the functions above, which are SECURITY
-- DEFINER. There is deliberately no insert or update policy: a booking that
-- could be written directly is a booking whose capacity was never checked.

-- True when the caller is a driver assigned to this departure. Defined here
-- rather than with the rest of departure day, because the bookings policy
-- below needs it and policies are validated when they are created.
create or replace function public.is_departure_driver(p_departure_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
    from public.departure_vehicles dv
    where dv.departure_id = p_departure_id
      and dv.driver_id = auth.uid()
  );
$fn$;

grant execute on function public.is_departure_driver(uuid) to authenticated;

create policy bookings_select_own on public.bookings
  for select to authenticated
  using (passenger_id = auth.uid());

-- Managers see their operator's whole book. A driver is a member too, but
-- `is_operator_member` would hand them every booking the business has ever
-- taken — and a driver's job needs one departure's worth of passengers, on the
-- departures they are actually driving.
create policy bookings_select_operator on public.bookings
  for select to authenticated
  using (
    public.is_operator_manager(public.departure_operator(departure_id))
    or public.is_departure_driver(departure_id)
  );

create policy bookings_select_admin on public.bookings
  for select to authenticated
  using (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- profiles, seen through a booking
-- ---------------------------------------------------------------------------
-- An operator deciding on a request needs the passenger's name, phone, gender
-- if given, photo if given, and accommodation notes. This is the narrowest way
-- to grant that: readable only while that passenger has a booking on one of
-- this operator's departures.

create or replace function public.shares_booking_with_operator(p_passenger_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
    from public.bookings b
    join public.departures d on d.id = b.departure_id
    join public.operator_members m on m.operator_id = d.operator_id
    where b.passenger_id = p_passenger_id
      and m.user_id = auth.uid()
  );
$fn$;

grant execute on function public.shares_booking_with_operator(uuid) to authenticated;

create policy profiles_select_for_operator on public.profiles
  for select to authenticated
  using (public.shares_booking_with_operator(id));

-- ---------------------------------------------------------------------------
-- ratings and red flags
-- ---------------------------------------------------------------------------

create policy ratings_select_involved on public.ratings
  for select to authenticated
  using (
    passenger_id = auth.uid()
    or public.is_operator_member(operator_id)
  );

-- A passenger's rating of an operator is public, so a rating average can be
-- shown on the operator's profile.
create policy ratings_select_public on public.ratings
  for select to anon, authenticated
  using (direction = 'passenger_to_operator');

create policy ratings_insert_own on public.ratings
  for insert to authenticated
  with check (rater_id = auth.uid());

-- A red flag is one operator's mark on a passenger, but it is deliberately
-- platform-wide: the point of recording a no-show is that the next operator
-- sees it before approving. So an operator reads flags raised by anyone,
-- about a passenger who has actually requested a seat with them — and reads
-- nothing about a passenger they have never dealt with.
--
-- The passenger does not see their own flags. Nothing here grants that.
create policy red_flags_select_operator on public.red_flags
  for select to authenticated
  using (
    public.is_operator_member(operator_id)
    or public.shares_booking_with_operator(passenger_id)
  );

create policy red_flags_insert_operator on public.red_flags
  for insert to authenticated
  with check (public.is_operator_manager(operator_id) and created_by = auth.uid());

create policy red_flags_select_admin on public.red_flags
  for select to authenticated
  using (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- passenger_history — what an operator sees when deciding
-- ---------------------------------------------------------------------------
-- Completed rides, cancellations, and no-shows across the whole platform, as
-- counts. An operator judging a request needs the shape of someone's history,
-- not the detail of where they have been — and certainly not a competitor's
-- passenger list.
--
-- Callable only about a passenger who has requested a seat with the caller's
-- operator. Anything else returns nothing.

create or replace function public.passenger_history(p_passenger_id uuid)
returns table (
  completed     integer,
  cancelled     integer,
  no_shows      integer,
  red_flags     integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select
    count(*) filter (where b.status in ('completed', 'settled'))::integer,
    count(*) filter (where b.status in ('cancelled_by_passenger', 'expired'))::integer,
    count(*) filter (where b.status = 'no_show')::integer,
    (select count(*) from public.red_flags rf where rf.passenger_id = p_passenger_id)::integer
  from public.bookings b
  where b.passenger_id = p_passenger_id
    and (
      public.shares_booking_with_operator(p_passenger_id)
      or public.is_platform_admin()
    );
$fn$;

grant execute on function public.passenger_history(uuid) to authenticated;
