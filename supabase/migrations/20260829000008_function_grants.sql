-- Corridor — close the default function grants
--
-- Postgres grants EXECUTE on a new function to PUBLIC. Supabase exposes every
-- function in `public` as an RPC endpoint. Together that means each function
-- written so far was callable, unauthenticated, from the internet.
--
-- Nothing was exploitable: every one of them authorises internally, checking
-- `is_operator_manager`, `shares_booking_with_operator`, or `auth.uid()`
-- before it does anything. The exception is `expire_stale_holds()`, which
-- authorises nothing — it only flips holds whose clock has genuinely run out,
-- so an anonymous caller achieved exactly what the scheduled job achieves, but
-- an open write endpoint is not something to leave lying around.
--
-- The real problem is the default itself. Relying on "every function happens
-- to check" means the next one that forgets is public. So: revoke from PUBLIC,
-- then grant deliberately, the same way policies are added deliberately.
--
-- Trigger functions get no grant at all. A trigger runs as part of the
-- statement that fired it, not as something a caller invokes.

do $mig$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public', fn.signature);
  end loop;
end;
$mig$;

-- ---------------------------------------------------------------------------
-- Anonymous — search, before anyone signs in
-- ---------------------------------------------------------------------------

grant execute on function public.toronto_instant(date, time)        to anon, authenticated;
grant execute on function public.operator_is_active(uuid)           to anon, authenticated;
grant execute on function public.route_operator(uuid)               to anon, authenticated;
grant execute on function public.departure_operator(uuid)           to anon, authenticated;
-- Seats left is public. Who is on board is not, and this returns only counts.
grant execute on function public.departure_leg_loads(uuid[])        to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Signed in
-- ---------------------------------------------------------------------------

grant execute on function public.is_platform_admin()                to authenticated;
grant execute on function public.is_operator_member(uuid)           to authenticated;
grant execute on function public.is_operator_manager(uuid)          to authenticated;
grant execute on function public.is_departure_driver(uuid)          to authenticated;
grant execute on function public.has_operator_role(uuid, public.operator_member_role[])
                                                                    to authenticated;
grant execute on function public.shares_booking_with_operator(uuid) to authenticated;

grant execute on function public.save_route(uuid, uuid, text, public.pricing_mode, uuid[])
                                                                    to authenticated;
grant execute on function public.set_fare(uuid, integer, integer, integer, text)
                                                                    to authenticated;
grant execute on function public.generate_departures(uuid, integer) to authenticated;

grant execute on function public.request_booking(uuid, uuid, uuid, integer, integer, text)
                                                                    to authenticated;
grant execute on function public.approve_booking(uuid)              to authenticated;
grant execute on function public.decline_booking(uuid)              to authenticated;
grant execute on function public.cancel_booking(uuid)               to authenticated;
grant execute on function public.passenger_history(uuid)            to authenticated;

grant execute on function public.assign_booking_vehicle(uuid, uuid) to authenticated;
grant execute on function public.complete_departure(uuid)           to authenticated;
grant execute on function public.mark_no_show(uuid)                 to authenticated;
grant execute on function public.confirm_payment_as_passenger(uuid, public.payment_method)
                                                                    to authenticated;
grant execute on function public.confirm_payment_as_driver(uuid, boolean)
                                                                    to authenticated;

-- ---------------------------------------------------------------------------
-- Service role only
-- ---------------------------------------------------------------------------
-- The hold sweep is housekeeping run by a scheduled job. Capacity does not
-- depend on it, so nobody else needs to be able to trigger it.

grant execute on function public.expire_stale_holds()               to service_role;

-- New functions inherit the same stance: nothing, until granted.
alter default privileges in schema public revoke execute on functions from public;
