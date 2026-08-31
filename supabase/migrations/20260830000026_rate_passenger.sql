-- Corridor — let an operator rate a passenger, and tighten who may rate at all
--
-- `rating_direction` has had two values since the first migration and only one
-- of them has ever been written. `operator_to_passenger` exists in the enum,
-- in the generated types, and nowhere else — a dead value that invites the next
-- person to assume it works.
--
-- It is worth having rather than deleting. An operator deciding whether to
-- approve a stranger currently sees four counts: completed, cancelled,
-- no-shows and red flags. Three of those are bad news and the fourth is the
-- absence of bad news. Nothing says "twelve trips, never a problem". A star
-- from the last operator who carried them is the positive signal that queue is
-- missing, and it is the difference between a passenger with no history and a
-- passenger with a good one.
--
-- ---------------------------------------------------------------------------
-- Three decisions the schema left open
-- ---------------------------------------------------------------------------
-- **A rating of a passenger is not shown to that passenger.** Red flags are
-- deliberately invisible to their subject — the point is a signal between
-- operators — and a star rating of somebody is the same kind of thing. An
-- operator who knows the subject is reading becomes a less honest rater. So
-- the select policy is narrowed: a passenger sees the reviews they *wrote*,
-- not the ones written about them.
--
-- **The insert policy was far too loose.** `ratings_insert_own` checked only
-- `rater_id = auth.uid()`, so any signed-in user could write a rating in
-- either direction, about any booking, for any operator, whether or not the
-- trip had run. Everything that made it correct lived in one Server Action.
-- It is replaced below with a policy that checks the booking is theirs, the
-- operator is the one who actually carried them, and the trip happened.
--
-- **The operator side goes through a function, not a policy**, because the
-- caller may be the assigned driver — who holds no write policy anywhere, by
-- design, and reaches every other write through a SECURITY DEFINER function
-- that first proves they were on that trip.

-- ---------------------------------------------------------------------------
-- Who may read a rating
-- ---------------------------------------------------------------------------

drop policy if exists ratings_select_involved on public.ratings;

create policy ratings_select_involved on public.ratings
  for select to authenticated
  using (
    -- The reviews you wrote about operators, not the ones written about you.
    (direction = 'passenger_to_operator' and passenger_id = auth.uid())
    or public.is_operator_member(operator_id)
  );

-- `ratings_select_public` is unchanged: a passenger's rating of an operator is
-- public so the average can sit on the operator's profile. It is scoped to
-- `direction = 'passenger_to_operator'`, so it does not leak the new direction.

-- ---------------------------------------------------------------------------
-- Who may write one
-- ---------------------------------------------------------------------------

drop policy if exists ratings_insert_own on public.ratings;

create policy ratings_insert_passenger on public.ratings
  for insert to authenticated
  with check (
    direction = 'passenger_to_operator'
    and rater_id = auth.uid()
    and passenger_id = auth.uid()
    and exists (
      select 1
        from public.bookings b
        join public.departures d on d.id = b.departure_id
       where b.id = ratings.booking_id
         and b.passenger_id = auth.uid()
         and d.operator_id = ratings.operator_id
         and b.status in ('completed', 'settled')
    )
  );

-- ---------------------------------------------------------------------------
-- The operator's side
-- ---------------------------------------------------------------------------

create or replace function public.rate_passenger(
  p_booking_id uuid,
  p_score      integer,
  p_comment    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_booking record;
  v_id      uuid;
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in.';
  end if;

  if p_score is null or p_score < 1 or p_score > 5 then
    raise exception 'A rating is 1 to 5.';
  end if;

  select b.id, b.passenger_id, b.status, b.departure_id, d.operator_id
    into v_booking
    from public.bookings b
    join public.departures d on d.id = b.departure_id
   where b.id = p_booking_id;

  if not found then
    raise exception 'That booking no longer exists.';
  end if;

  -- A manager, or the driver who actually carried them. The same authorisation
  -- `mark_no_show()` and `raise_red_flag()` use.
  if not (
    public.is_operator_manager(v_booking.operator_id)
    or public.is_departure_driver(v_booking.departure_id)
  ) then
    raise exception 'Only this operator can rate that passenger.';
  end if;

  -- Nothing to judge until the trip ran. A no-show is rateable: not turning up
  -- is a fact about the passenger, and the red flag is already automatic.
  if v_booking.status not in ('completed', 'settled', 'no_show') then
    raise exception 'You can rate a passenger once the trip has run.';
  end if;

  insert into public.ratings (
    booking_id, direction, rater_id, operator_id, passenger_id, score, comment
  )
  values (
    p_booking_id, 'operator_to_passenger', auth.uid(), v_booking.operator_id,
    v_booking.passenger_id, p_score, nullif(btrim(coalesce(p_comment, '')), '')
  )
  returning id into v_id;

  return v_id;
exception
  -- `unique (booking_id, direction)` from the first migration.
  when unique_violation then
    raise exception 'You have already rated that passenger.';
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Show it where the decision is made
-- ---------------------------------------------------------------------------
-- The approval queue asks `passenger_history()` for counts. It gains the
-- average and the number of ratings, so an operator weighing up a stranger
-- sees something other than a list of ways it could go wrong.
--
-- The guard is unchanged and still the first thing the function does: an
-- operator may ask about someone who has approached them, an admin about
-- anyone, everyone else gets no row at all — not zeroes, which would be a
-- different claim.

-- Dropped rather than replaced: `create or replace` cannot widen a RETURNS
-- TABLE — "cannot change return type of existing function". Dropping takes the
-- grants with it, which is why they are restated at the foot of this file
-- rather than assumed.
drop function if exists public.passenger_history(uuid);

create function public.passenger_history(p_passenger_id uuid)
returns table (
  completed     integer,
  cancelled     integer,
  no_shows      integer,
  red_flags     integer,
  rating_avg    numeric,
  rating_count  integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not (public.shares_booking_with_operator(p_passenger_id) or public.is_platform_admin()) then
    return;
  end if;

  return query
  select
    count(*) filter (where b.status in ('completed', 'settled'))::integer,
    count(*) filter (where b.status in ('cancelled_by_passenger', 'expired'))::integer,
    count(*) filter (where b.status = 'no_show')::integer,
    (select count(*) from public.red_flags rf where rf.passenger_id = p_passenger_id)::integer,
    -- Rounded here so every caller shows the same number.
    (select round(avg(r.score), 1) from public.ratings r
      where r.passenger_id = p_passenger_id and r.direction = 'operator_to_passenger'),
    (select count(*) from public.ratings r
      where r.passenger_id = p_passenger_id and r.direction = 'operator_to_passenger')::integer
  from public.bookings b
  where b.passenger_id = p_passenger_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- 20260829000008 revoked EXECUTE from PUBLIC as a one-time sweep; every
-- function written since defaults back to it, so both of these are restated.
-- `create or replace` keeps an existing grant, but saying it out loud means
-- the reachability of a function is never a question of what an older
-- migration happened to do.

revoke all on function public.rate_passenger(uuid, integer, text) from public;
revoke all on function public.passenger_history(uuid) from public;

grant execute on function public.rate_passenger(uuid, integer, text) to authenticated;
grant execute on function public.passenger_history(uuid) to authenticated;
