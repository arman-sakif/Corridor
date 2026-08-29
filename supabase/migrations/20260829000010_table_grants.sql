-- Corridor — table grants, stated in the repo
--
-- The project was created with "automatically expose new tables" turned off,
-- so Supabase grants nothing to the API roles by default. Without this
-- migration every query returns `permission denied for table …` — including
-- from the secret key, which bypasses RLS but is still subject to privileges.
--
-- That is the posture we want. It means table exposure is a property of this
-- file, reviewable in a diff, rather than of a checkbox someone ticked once
-- during project creation. Two gates, not one:
--
--   GRANT decides whether a role may touch the table at all.
--   RLS   decides which rows, once it may.
--
-- Grants below are the narrowest set the policies actually need. Where a table
-- has no write policy, no write privilege is granted either — `bookings` is
-- the clearest case: every write goes through a SECURITY DEFINER function that
-- runs as the owner, so `authenticated` needs SELECT and nothing more.

-- ---------------------------------------------------------------------------
-- The service role
-- ---------------------------------------------------------------------------
-- Bypasses RLS, so it is only ever used where the calling code has already
-- done its own authorisation: departure generation, the hold sweep, and
-- looking up an email address that no policy should expose.

grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Search, before anyone signs in
-- ---------------------------------------------------------------------------
-- A passenger arriving from a Kijiji link picks a city pair, sees departures
-- and fares, and reads an operator's reviews — all without an account. Those
-- tables and no others.

grant select on table
  public.cities,
  public.operators,
  public.stops,
  public.routes,
  public.route_stops,
  public.fares,
  public.departures,
  public.ratings
to anon;

-- ---------------------------------------------------------------------------
-- Signed in
-- ---------------------------------------------------------------------------

-- Everything a passenger reads to search, plus their own records.
grant select on table
  public.cities,
  public.operators,
  public.stops,
  public.routes,
  public.route_stops,
  public.fares,
  public.departures,
  public.ratings
to authenticated;

-- Identity. No delete: closing an account is a service-role operation, and a
-- deleted profile would orphan a booking's passenger reference.
grant select, insert, update on table public.profiles to authenticated;

-- Applying to list a business, and an owner editing it. Delete is here because
-- operators_admin_all is FOR ALL and a platform admin may remove a listing.
grant select, insert, update, delete on table public.operators to authenticated;
grant select, insert, update, delete on table public.operator_members to authenticated;
grant select, insert, update, delete on table public.subscriptions to authenticated;
grant select, insert, update, delete on table public.cities to authenticated;

-- Operator setup. RLS narrows all of these to the caller's own operator.
grant select, insert, update, delete on table public.stops to authenticated;
grant select, insert, update, delete on table public.routes to authenticated;
grant select, insert, update, delete on table public.route_stops to authenticated;
grant select, insert, update, delete on table public.fares to authenticated;
grant select, insert, update, delete on table public.schedules to authenticated;
grant select, insert, update, delete on table public.vehicles to authenticated;
grant select, insert, update, delete on table public.departures to authenticated;
grant select, insert, update, delete on table public.departure_vehicles to authenticated;

-- Append-only by design: an operator may record a price change and read its
-- own history, and may never rewrite it. There is no update or delete policy,
-- and now no privilege either.
grant select, insert on table public.fare_changes to authenticated;

-- Bookings are READ-ONLY to the API. Every write — the hold, the approval, the
-- cancellation, the settlement — goes through a SECURITY DEFINER function that
-- checks capacity or authorisation first. A booking that could be INSERTed
-- directly is a booking whose per-leg capacity was never checked, so the
-- privilege to do so is withheld rather than merely unpoliced.
grant select on table public.bookings to authenticated;

-- Reputation. Both are written once and never edited.
grant select, insert on table public.ratings to authenticated;
grant select, insert on table public.red_flags to authenticated;

-- In-city (Phase 6) is granted nothing at all. The tables exist, RLS denies
-- everything, and now privileges do too. Both come down together when the
-- feature is built.

-- ---------------------------------------------------------------------------
-- New tables stay shut
-- ---------------------------------------------------------------------------
-- Matches the stance taken for functions in 20260829000008: nothing is
-- reachable until a migration says so.

alter default privileges in schema public revoke all on tables from anon, authenticated;
