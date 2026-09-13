-- Corridor — a passenger can see the departures they have booked
--
-- `departures_select_public` is `status = 'scheduled' and
-- operator_is_active(...)`. That is right for search and wrong for a
-- passenger's own rides: the moment a trip is marked completed, or its
-- operator is suspended, the departure disappears from the passenger's view.
-- Every embed of it then comes back null, so My rides and the ride page showed
-- a finished trip with no date and no operator — and a history of past rides,
-- filtered and ordered by departure date, could not see those rides at all.
--
-- `20260830000027` worked around the same blindness for ratings. This fixes it
-- at the source, for the one person with a claim on the row: someone holding a
-- booking on it, in any status, since they saw it when they booked. What they
-- gain is the departure itself — a date, a time, a route, a seat count. Never
-- the driver or the vehicle: those live in `departure_vehicles`, which this
-- does not touch.
--
-- A SECURITY DEFINER helper rather than an EXISTS inside the policy, for the
-- same reason as `is_departure_driver()`: a policy's subquery runs as the
-- caller with RLS on every table it reads, and departures and bookings already
-- consult each other through their policies.

create or replace function public.is_departure_passenger(p_departure_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
    from public.bookings b
    where b.departure_id = p_departure_id
      and b.passenger_id = auth.uid()
  );
$fn$;

revoke all on function public.is_departure_passenger(uuid) from public;
grant execute on function public.is_departure_passenger(uuid) to authenticated;

create policy departures_select_passenger on public.departures
  for select to authenticated
  using (public.is_departure_passenger(id));
