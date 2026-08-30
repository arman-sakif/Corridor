-- Corridor — let server-side tooling read leg loads
--
-- `departure_leg_loads()` is granted to anon and authenticated, because search
-- shows "3 seats left" to a signed-out visitor. The service role was left out.
--
-- That is not a boundary. The service role bypasses RLS and can already read
-- `bookings` directly, so it can compute the same numbers the long way round;
-- withholding the function does not protect anything. What it does do is make
-- server-side tooling silently wrong: PostgREST returns `null` data with an
-- error rather than throwing, so a script that reads `data ?? []` sees an
-- empty result and concludes a departure is empty when it is full.
--
-- That is exactly what happened while verifying the seed — a diagnostic
-- reported "no full departure found" against a departure that was provably
-- full. A permission that turns a wrong answer into a plausible one is worse
-- than no permission at all.

grant execute on function public.departure_leg_loads(uuid[]) to service_role;
