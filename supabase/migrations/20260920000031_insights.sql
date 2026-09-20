-- Corridor — operator insights
--
-- The question an owner actually asks is "which days are worth running?" They
-- know Friday feels busy. They do not know that their Tuesday 9am has run at
-- a third full for two months, or that Sunday turns people away.
--
-- ---------------------------------------------------------------------------
-- How full is "full"
-- ---------------------------------------------------------------------------
-- Capacity is per leg (§5.1), so a departure's fullness is the load on its
-- BUSIEST leg, not the number of bookings on it and not the seats summed
-- across legs. A 4-seat van carrying Windsor→London and London→Yorkdale
-- back to back has sold two seats and was never more than a quarter full;
-- counting it as half full would tell the operator to buy a second van.
--
-- So `seats_taken` here is the sum of each departure's peak leg load, against
-- `seats_offered`, the sum of each departure's own `max_seats` — snapshotted
-- on the departure, never read from the live schedule (§10 #6).
--
-- ---------------------------------------------------------------------------
-- Why a function rather than a query
-- ---------------------------------------------------------------------------
-- PostgREST caps a select at 1000 rows, and a quarter of departures with their
-- bookings is well past that. Aggregating in TypeScript would mean paging
-- thousands of rows to compute seven numbers, and would compute them with a
-- different definition of "full" than the one above. One function, one answer.
--
-- SECURITY DEFINER, so it states its own authorisation: a member of this
-- operator, or a platform admin. Nobody else gets a competitor's numbers.

create or replace function public.operator_insights(
  p_operator_id uuid,
  p_from        date,
  p_to          date
)
returns table (
  dow             smallint,
  departures      integer,
  seats_offered   integer,
  seats_taken     integer,
  full_departures integer,
  bookings        integer,
  passengers      integer,
  fares_cents     bigint,
  discount_cents  bigint,
  turned_away     integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not (public.is_operator_member(p_operator_id) or public.is_platform_admin()) then
    raise exception 'Those are not your numbers.';
  end if;

  return query
  with dep as (
    select d.id, d.service_date, d.max_seats
      from public.departures d
     where d.operator_id = p_operator_id
       and d.service_date between p_from and p_to
       -- A cancelled departure ran no seats and offered none. Leaving it in
       -- would read as a day that never sells.
       and d.status <> 'cancelled'
  ),
  -- Every leg of every booking that counts, so the peak can be found. Holds
  -- are left out entirely: this looks backwards at what happened, and an hour
  -- of indecision is not a sale.
  leg_loads as (
    select b.departure_id, g.seq as leg, sum(b.seats)::integer as seats
      from public.bookings b
      join dep on dep.id = b.departure_id
      cross join lateral generate_series(b.from_seq, b.to_seq - 1) as g(seq)
     where b.status in ('approved', 'completed', 'settled', 'no_show')
     group by b.departure_id, g.seq
  ),
  peak as (
    select departure_id, max(seats)::integer as peak_seats
      from leg_loads group by departure_id
  ),
  sold as (
    select b.departure_id,
           count(*)::integer as bookings,
           sum(b.seats)::integer as passengers,
           sum(b.total_cents)::bigint as fares_cents,
           sum(b.discount_cents)::bigint as discount_cents
      from public.bookings b
      join dep on dep.id = b.departure_id
     where b.status in ('approved', 'completed', 'settled', 'no_show')
     group by b.departure_id
  ),
  -- Demand that did not convert. A declined request is a decision; a lapsed
  -- hold is usually a passenger who went elsewhere while waiting. Both are
  -- worth seeing next to the day they happened on.
  lost as (
    select b.departure_id, count(*)::integer as turned_away
      from public.bookings b
      join dep on dep.id = b.departure_id
     where b.status in ('declined', 'expired')
     group by b.departure_id
  )
  select extract(dow from dep.service_date)::smallint,
         count(*)::integer,
         coalesce(sum(dep.max_seats), 0)::integer,
         coalesce(sum(peak.peak_seats), 0)::integer,
         count(*) filter (where coalesce(peak.peak_seats, 0) >= dep.max_seats)::integer,
         coalesce(sum(sold.bookings), 0)::integer,
         coalesce(sum(sold.passengers), 0)::integer,
         coalesce(sum(sold.fares_cents), 0)::bigint,
         coalesce(sum(sold.discount_cents), 0)::bigint,
         coalesce(sum(lost.turned_away), 0)::integer
    from dep
    left join peak on peak.departure_id = dep.id
    left join sold on sold.departure_id = dep.id
    left join lost on lost.departure_id = dep.id
   group by 1
   order by 1;
end;
$fn$;

revoke all on function public.operator_insights(uuid, date, date) from public;
grant execute on function public.operator_insights(uuid, date, date) to authenticated;
