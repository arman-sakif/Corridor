-- Corridor — operator surcharges
--
-- The fare model was only half built: `bookings` has had luggage_cents and
-- airport_cents since the first migration, but request_booking() wrote zeros
-- into both because there was nowhere for an operator to say what they charge.
--
-- Surcharges are fixed amounts set by the operator, never a percentage and
-- never set by us:
--
--   * a per-item charge for luggage beyond a free allowance, and
--   * a flat fee when either end of the trip is an airport.
--
-- The allowance is per seat: two passengers travelling together carry two bags
-- free. Cash and e-transfer remain the same price — there is no surcharge for
-- either, and adding one would break the promise the booking flow makes.

alter table public.operators
  add column free_luggage_per_seat integer not null default 1,
  add column extra_luggage_cents   integer not null default 0,
  add column airport_fee_cents     integer not null default 0,
  add constraint operators_free_luggage_non_negative check (free_luggage_per_seat >= 0),
  add constraint operators_luggage_price_non_negative check (extra_luggage_cents >= 0),
  add constraint operators_airport_fee_non_negative check (airport_fee_cents >= 0);

-- Whether this pickup point is an airport. A flag rather than a lookup: there
-- is no geocoding anywhere in this system, and the operator is the one who
-- knows that "Pearson T1 — Column D" is an airport.
alter table public.stops
  add column is_airport boolean not null default false;

-- ---------------------------------------------------------------------------
-- request_booking, with the surcharges applied
-- ---------------------------------------------------------------------------
-- Replaces the version in 20260829000005_booking.sql. Everything about the
-- lock and the per-leg capacity scan is unchanged; the only difference is that
-- the two surcharge columns are now computed rather than written as zero.

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
  v_operator       record;
  v_from_seq       integer;
  v_to_seq         integer;
  v_pricing_mode   public.pricing_mode;
  v_base_per_seat  integer;
  v_leg            integer;
  v_taken          integer;
  v_hold_expires   timestamptz;
  v_booking_id     uuid;
  v_luggage        integer := greatest(coalesce(p_luggage_count, 0), 0);
  v_extra_bags     integer;
  v_luggage_cents  integer;
  v_airport_cents  integer;
  v_touches_airport boolean;
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

  -- ---- surcharges, from the operator's own settings --------------------
  select o.free_luggage_per_seat, o.extra_luggage_cents, o.airport_fee_cents
    into v_operator
    from public.operators o
   where o.id = v_departure.operator_id;

  -- The allowance is per seat, so a party of two carries two bags free.
  v_extra_bags := greatest(v_luggage - (v_operator.free_luggage_per_seat * p_seats), 0);
  v_luggage_cents := v_extra_bags * v_operator.extra_luggage_cents;

  select exists (
    select 1 from public.stops s
    where s.id in (p_from_stop_id, p_to_stop_id) and s.is_airport
  ) into v_touches_airport;

  v_airport_cents := case when v_touches_airport
                          then v_operator.airport_fee_cents * p_seats
                          else 0 end;

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
    v_luggage,
    v_base_per_seat * p_seats,
    v_luggage_cents,
    v_airport_cents,
    (v_base_per_seat * p_seats) + v_luggage_cents + v_airport_cents,
    nullif(btrim(coalesce(p_passenger_note, '')), '')
  )
  returning id into v_booking_id;

  return v_booking_id;
end;
$fn$;

-- `create or replace` keeps the existing grants, but state it anyway so the
-- function's reachability is never a question of what a previous migration did.
revoke all on function public.request_booking(uuid, uuid, uuid, integer, integer, text) from public;
grant execute on function public.request_booking(uuid, uuid, uuid, integer, integer, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- quote_booking — what the passenger is shown before they commit
-- ---------------------------------------------------------------------------
-- The booking page needs the same arithmetic to display a total, and it must
-- be the same arithmetic: a quote that disagrees with the charge is worse than
-- no quote. Read-only, and it takes no price from the caller.

create or replace function public.quote_booking(
  p_departure_id  uuid,
  p_from_stop_id  uuid,
  p_to_stop_id    uuid,
  p_seats         integer,
  p_luggage_count integer
)
returns table (
  base_cents    integer,
  luggage_cents integer,
  airport_cents integer,
  total_cents   integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_departure     record;
  v_operator      record;
  v_from_seq      integer;
  v_to_seq        integer;
  v_pricing_mode  public.pricing_mode;
  v_base_per_seat integer;
  v_luggage       integer := greatest(coalesce(p_luggage_count, 0), 0);
  v_extra_bags    integer;
  v_luggage_cents integer;
  v_airport_cents integer;
  v_base          integer;
begin
  select d.route_id, d.operator_id into v_departure
    from public.departures d where d.id = p_departure_id;

  if not found or not public.operator_is_active(v_departure.operator_id) then
    return;
  end if;

  select rs.seq into v_from_seq from public.route_stops rs
   where rs.route_id = v_departure.route_id and rs.stop_id = p_from_stop_id;
  select rs.seq into v_to_seq from public.route_stops rs
   where rs.route_id = v_departure.route_id and rs.stop_id = p_to_stop_id;

  if v_from_seq is null or v_to_seq is null or v_to_seq <= v_from_seq then
    return;
  end if;

  select r.pricing_mode into v_pricing_mode
    from public.routes r where r.id = v_departure.route_id;

  if v_pricing_mode = 'matrix' then
    select f.price_cents into v_base_per_seat from public.fares f
     where f.route_id = v_departure.route_id
       and f.from_seq = v_from_seq and f.to_seq = v_to_seq;
  else
    select case when count(*) = (v_to_seq - v_from_seq) then sum(f.price_cents)::integer end
      into v_base_per_seat
      from public.fares f
     where f.route_id = v_departure.route_id
       and f.from_seq >= v_from_seq and f.to_seq <= v_to_seq
       and f.to_seq = f.from_seq + 1;
  end if;

  if v_base_per_seat is null then
    return;
  end if;

  select o.free_luggage_per_seat, o.extra_luggage_cents, o.airport_fee_cents
    into v_operator from public.operators o where o.id = v_departure.operator_id;

  v_extra_bags := greatest(v_luggage - (v_operator.free_luggage_per_seat * p_seats), 0);
  v_luggage_cents := v_extra_bags * v_operator.extra_luggage_cents;

  v_airport_cents := case
    when exists (
      select 1 from public.stops s
      where s.id in (p_from_stop_id, p_to_stop_id) and s.is_airport
    ) then v_operator.airport_fee_cents * p_seats
    else 0
  end;

  v_base := v_base_per_seat * p_seats;

  return query select v_base, v_luggage_cents, v_airport_cents,
                      v_base + v_luggage_cents + v_airport_cents;
end;
$fn$;

revoke all on function public.quote_booking(uuid, uuid, uuid, integer, integer) from public;
grant execute on function public.quote_booking(uuid, uuid, uuid, integer, integer)
  to anon, authenticated;
