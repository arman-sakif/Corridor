-- Corridor — ask the database whether a phone number is already spoken for
--
-- `profiles.phone` is free text on purpose: these are small Ontario operators
-- dialling the number by hand, and rejecting `(519) 555-0134` over its
-- brackets helps nobody. The cost is that two rows can hold the same line in
-- two different shapes, so a duplicate check has to compare digits, not text.
--
-- That comparison belongs here rather than in TypeScript. Doing it in the
-- application would mean selecting every profile and comparing in a loop —
-- and PostgREST caps a select at 1000 rows, so the thousand-and-first account
-- would silently stop being checked and the answer would read as a real "no".
-- A silent truncation that looks like an answer is exactly the failure this
-- codebase keeps writing itself notes about.
--
-- SECURITY DEFINER because the caller must not be able to read the row it
-- matched: "is this number taken" is a fair question, "whose is it" is not.
-- Only a boolean leaves.
--
-- The rule this supports is switched off by default — see
-- `enforceUniqueContact()`. This function is the machinery, not the decision.

create or replace function public.normalise_phone(p_phone text)
returns text
language sql
immutable
parallel safe
as $fn$
  -- Digits only, and a North American country code dropped so that
  -- +1 519 555 0134 and 519-555-0134 are recognised as one line.
  select regexp_replace(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'),
                        '^1(?=[0-9]{10}$)', '');
$fn$;

create or replace function public.phone_in_use(p_phone text, p_exclude uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
      from public.profiles
     where phone is not null
       and public.normalise_phone(phone) = public.normalise_phone(p_phone)
       and public.normalise_phone(p_phone) <> ''
       and (p_exclude is null or id <> p_exclude)
  );
$fn$;

-- 20260829000008 revoked EXECUTE from PUBLIC and grants deliberately from
-- there on. Both of these stay closed to anon and authenticated: the check
-- runs inside a Server Action that already holds the secret key, and an open
-- endpoint answering "does this number have an account" is an enumeration
-- oracle pointed at a list of phone numbers.
revoke all on function public.normalise_phone(text) from public;
revoke all on function public.phone_in_use(text, uuid) from public;

grant execute on function public.normalise_phone(text)      to service_role;
grant execute on function public.phone_in_use(text, uuid)   to service_role;

-- When the rule is switched on for real, this is the index that makes it true
-- for every writer rather than only for the ones that remember to ask:
--
--   create unique index profiles_phone_unique_idx
--     on public.profiles (public.normalise_phone(phone))
--     where phone is not null;
--
-- It is deliberately not created yet. Test accounts share a number today, and
-- a unique index would reject them at the point of insert with no way to opt
-- out per environment. It needs its own migration once they are gone.
