-- Corridor — carry the name and phone from signup into the profile
--
-- Signup used to ask for an email and a password and nothing else, then send
-- every new account to /profile to fill in a name and a phone number before it
-- could do anything. Two screens where one would do, and a drop-off point
-- sitting between a passenger and their first booking.
--
-- The form now asks for all four at once. This teaches the trigger to read the
-- extra two out of the user metadata that `auth.signUp` writes.
--
-- Why here and not in the Server Action afterwards: with email confirmation
-- turned on there is no session at the end of signUp, so an `update
-- public.profiles` from the action would run as `anon` and be refused by RLS.
-- The metadata rides along with the auth.users row either way, and this
-- trigger is SECURITY DEFINER, so it works in both configurations.
--
-- `full_name` still falls back to `name`, which is the key Google returns.
-- Google never returns a phone number, so an OAuth signup gets NULL there and
-- is still sent through /profile once — the detour that has now gone from the
-- password path stays where it is genuinely needed.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name',
                          new.raw_user_meta_data ->> 'name', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$fn$;

-- The trigger itself is unchanged and still points at this function; replacing
-- the body is enough. No grant is added: a trigger function is called by the
-- system, never over the API, and 20260829000008 revoked EXECUTE from PUBLIC.
