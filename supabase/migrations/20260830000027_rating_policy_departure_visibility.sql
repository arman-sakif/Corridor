-- Corridor — a rating policy that does not depend on seeing the departure
--
-- `20260830000026` tightened `ratings_insert_passenger` to check that the
-- operator being rated is the one that actually carried the passenger. It did
-- so by joining `departures` inside the policy — and a policy's subquery runs
-- as the caller, with RLS applying to every table it touches.
--
-- A passenger cannot see a finished departure. `departures_select_public` is
-- `status = 'scheduled' and operator_is_active(...)`, so the row disappears
-- from their view the moment the trip is marked completed — which is precisely
-- when they are invited to rate it. The EXISTS found nothing, and every real
-- rating was refused.
--
-- The database tests missed it because they rate a departure that is still
-- `scheduled`; `scripts/e2e-loop.mjs`, which completes the trip first the way
-- the product does, caught it on the first run.
--
-- `departure_operator()` answers the same question without the join. It is
-- SECURITY DEFINER precisely so policies can ask "whose departure is this?"
-- without granting sight of the row, and the booking policies have used it for
-- exactly this since 20260829000005.
--
-- The passenger's own booking stays visible to them throughout
-- (`bookings_select_own`), so that half of the check needs no help.

drop policy if exists ratings_insert_passenger on public.ratings;

create policy ratings_insert_passenger on public.ratings
  for insert to authenticated
  with check (
    direction = 'passenger_to_operator'
    and rater_id = auth.uid()
    and passenger_id = auth.uid()
    and exists (
      select 1
        from public.bookings b
       where b.id = ratings.booking_id
         and b.passenger_id = auth.uid()
         and b.status in ('completed', 'settled')
         -- Not a join: see above.
         and public.departure_operator(b.departure_id) = ratings.operator_id
    )
  );
