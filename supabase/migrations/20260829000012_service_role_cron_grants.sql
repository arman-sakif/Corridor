-- Corridor — let the scheduled job do its job
--
-- 20260829000008 revoked EXECUTE from PUBLIC and granted each function to the
-- roles that need it. `generate_departures` was granted to `authenticated`,
-- because an operator calls it when saving a timetable entry — and that is
-- true, but it is not the only caller.
--
-- `/api/cron` calls it through the service-role client, nightly, to roll the
-- 30-day window forward. Without this grant that half of the job returns
-- `permission denied for function generate_departures` while the hold sweep
-- beside it succeeds, so the route 500s and the window silently stops moving.
--
-- The symptom would have been slow and confusing: departures continue to exist
-- for weeks, then thin out from the far end as the horizon stops advancing,
-- with nothing in the app pointing at the cause.
--
-- Nothing else needs adding. The service role already bypasses RLS and holds
-- table privileges, so withholding EXECUTE from it is not a security boundary
-- — it is just a tripwire. These two are what the server actually calls.

grant execute on function public.generate_departures(uuid, integer) to service_role;

-- Already granted in 20260829000008, restated so the cron's full surface is
-- visible in one place rather than split across two migrations.
grant execute on function public.expire_stale_holds() to service_role;
