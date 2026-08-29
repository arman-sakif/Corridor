-- Corridor — Phase 2/3: transactional operator logic
--
-- Three functions, each here because doing the same work as two round trips
-- from TypeScript would leave the database in a half-written state if the
-- second one failed.

-- ---------------------------------------------------------------------------
-- save_route — upsert a route and its ordered stops together
-- ---------------------------------------------------------------------------
-- A route is one direction: seq 1 is where it starts. Replacing the stop list
-- renumbers the sequence, which can leave fares pointing at positions that no
-- longer exist, so any fare outside the new range is dropped in the same
-- transaction rather than left dangling.
--
-- SECURITY INVOKER: the caller's own RLS decides whether they may touch this
-- route at all.

create or replace function public.save_route(
  p_operator_id  uuid,
  p_route_id     uuid,
  p_name         text,
  p_pricing_mode public.pricing_mode,
  p_stop_ids     uuid[]
)
returns uuid
language plpgsql
as $fn$
declare
  v_route_id uuid;
  v_stop_id  uuid;
  v_seq      integer := 0;
  v_count    integer := coalesce(array_length(p_stop_ids, 1), 0);
begin
  if v_count < 2 then
    raise exception 'A route needs at least two stops.';
  end if;

  if exists (
    select 1 from unnest(p_stop_ids) s(id)
    group by s.id having count(*) > 1
  ) then
    raise exception 'Each stop can appear only once on a route.';
  end if;

  -- Every stop must belong to this operator. Without this check an operator
  -- could build a route out of a competitor's pickup points.
  if exists (
    select 1
    from unnest(p_stop_ids) s(id)
    left join public.stops st on st.id = s.id
    where st.id is null or st.operator_id <> p_operator_id
  ) then
    raise exception 'Every stop on a route must be one of your own stops.';
  end if;

  if p_route_id is null then
    insert into public.routes (operator_id, name, pricing_mode)
    values (p_operator_id, p_name, p_pricing_mode)
    returning id into v_route_id;
  else
    update public.routes
       set name = p_name, pricing_mode = p_pricing_mode
     where id = p_route_id and operator_id = p_operator_id
    returning id into v_route_id;

    if v_route_id is null then
      raise exception 'That route does not belong to this operator.';
    end if;
  end if;

  delete from public.route_stops where route_id = v_route_id;

  foreach v_stop_id in array p_stop_ids loop
    v_seq := v_seq + 1;
    insert into public.route_stops (route_id, stop_id, seq)
    values (v_route_id, v_stop_id, v_seq);
  end loop;

  -- Fares are keyed by sequence, so a shorter route leaves some pointing past
  -- the end. Drop those rather than let them price a segment that is gone.
  delete from public.fares
   where route_id = v_route_id
     and (from_seq > v_count or to_seq > v_count);

  return v_route_id;
end;
$fn$;

grant execute on function public.save_route(uuid, uuid, text, public.pricing_mode, uuid[])
  to authenticated;

-- ---------------------------------------------------------------------------
-- set_fare — price a segment and record why, atomically
-- ---------------------------------------------------------------------------
-- Operators may change fares freely and without approval, but every change is
-- recorded with a reason. The audit row and the price move together: a fare
-- that changed without a reason attached is exactly what this table exists to
-- prevent.

create or replace function public.set_fare(
  p_route_id    uuid,
  p_from_seq    integer,
  p_to_seq      integer,
  p_price_cents integer,
  p_reason      text
)
returns void
language plpgsql
as $fn$
declare
  v_old_price integer;
  v_stops     integer;
begin
  if p_to_seq <= p_from_seq then
    raise exception 'A fare runs forward along the route.';
  end if;

  if p_price_cents < 0 then
    raise exception 'A fare cannot be negative.';
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Every price change needs a reason.';
  end if;

  select count(*) into v_stops from public.route_stops where route_id = p_route_id;

  if p_to_seq > v_stops then
    raise exception 'That stop position is not on this route.';
  end if;

  select price_cents into v_old_price
    from public.fares
   where route_id = p_route_id and from_seq = p_from_seq and to_seq = p_to_seq;

  -- No change is not worth an audit row.
  if v_old_price is not distinct from p_price_cents then
    return;
  end if;

  insert into public.fares (route_id, from_seq, to_seq, price_cents)
  values (p_route_id, p_from_seq, p_to_seq, p_price_cents)
  on conflict (route_id, from_seq, to_seq)
  do update set price_cents = excluded.price_cents;

  insert into public.fare_changes
    (route_id, from_seq, to_seq, old_price_cents, new_price_cents, reason, changed_by)
  values
    (p_route_id, p_from_seq, p_to_seq, v_old_price, p_price_cents, btrim(p_reason), auth.uid());
end;
$fn$;

grant execute on function public.set_fare(uuid, integer, integer, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- generate_departures — roll the window forward
-- ---------------------------------------------------------------------------
-- Idempotent: the unique index on (schedule_id, service_date) means running it
-- twice, or running it after an operator has already sold seats, changes
-- nothing.
--
-- max_seats is SNAPSHOTTED onto each departure. Editing a schedule must never
-- change the capacity of a departure that has already been sold — that is the
-- whole reason the column is duplicated.
--
-- days_of_week uses 0 = Sunday, matching extract(dow) and JavaScript getDay().

create or replace function public.generate_departures(
  p_operator_id uuid default null,
  p_days        integer default 30
)
returns integer
language plpgsql
as $fn$
declare
  v_today   date := (now() at time zone 'America/Toronto')::date;
  v_horizon date := v_today + make_interval(days => greatest(p_days, 0));
  v_created integer;
begin
  with candidate as (
    select
      r.operator_id,
      s.route_id,
      s.id           as schedule_id,
      d::date        as service_date,
      s.departure_time,
      s.max_seats
    from public.schedules s
    join public.routes r on r.id = s.route_id
    join public.operators o on o.id = r.operator_id
    cross join lateral generate_series(v_today, v_horizon, interval '1 day') as d
    where s.is_active
      and r.is_active
      and o.status = 'active'
      and (p_operator_id is null or r.operator_id = p_operator_id)
      and d::date >= s.active_from
      and (s.active_to is null or d::date <= s.active_to)
      and extract(dow from d)::smallint = any (s.days_of_week)
  )
  insert into public.departures
    (operator_id, route_id, schedule_id, service_date, departure_time, max_seats)
  select operator_id, route_id, schedule_id, service_date, departure_time, max_seats
  from candidate
  on conflict (schedule_id, service_date) where schedule_id is not null
  do nothing;

  get diagnostics v_created = row_count;
  return v_created;
end;
$fn$;

grant execute on function public.generate_departures(uuid, integer) to authenticated;
