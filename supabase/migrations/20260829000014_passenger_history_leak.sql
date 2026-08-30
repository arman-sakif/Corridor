-- Corridor — close a leak in passenger_history()
--
-- The function gated its counts with a WHERE clause:
--
--     select count(*) filter (where b.status in ('completed','settled')),
--            ...
--            (select count(*) from public.red_flags rf
--              where rf.passenger_id = p_passenger_id)
--     from public.bookings b
--     where b.passenger_id = p_passenger_id
--       and (public.shares_booking_with_operator(p_passenger_id) or ...)
--
-- Three of those four counts are aggregates over `bookings`, so the WHERE
-- correctly reduces them to zero for a caller with no claim on that passenger.
-- The fourth is a scalar subquery. It is evaluated independently of the WHERE,
-- and an aggregate query over zero rows still returns one row — so the red
-- flag count came back accurate to any authenticated caller, about anyone.
--
-- Not catastrophic: it is a count, not the reasons, and it needs a user id
-- that is not otherwise discoverable. But red flags are the most sensitive
-- thing the platform records about a person — "how many operators have marked
-- this passenger" is exactly the fact that should require a reason to ask —
-- and the function's own documentation claimed it was gated.
--
-- Rewritten so the guard is a single early return rather than a condition
-- repeated per column. Zero rows when the caller has no claim; a full row,
-- including honest zeroes for a first-time passenger, when they do.

create or replace function public.passenger_history(p_passenger_id uuid)
returns table (
  completed     integer,
  cancelled     integer,
  no_shows      integer,
  red_flags     integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  -- An operator may ask about someone who has requested a seat with them, and
  -- a platform admin may ask about anyone. Everyone else gets nothing back —
  -- not zeroes, which would be a different claim, but no row at all.
  if not (public.shares_booking_with_operator(p_passenger_id) or public.is_platform_admin()) then
    return;
  end if;

  return query
  select
    count(*) filter (where b.status in ('completed', 'settled'))::integer,
    count(*) filter (where b.status in ('cancelled_by_passenger', 'expired'))::integer,
    count(*) filter (where b.status = 'no_show')::integer,
    (select count(*) from public.red_flags rf where rf.passenger_id = p_passenger_id)::integer
  from public.bookings b
  where b.passenger_id = p_passenger_id;
end;
$fn$;

revoke all on function public.passenger_history(uuid) from public;
grant execute on function public.passenger_history(uuid) to authenticated;
