-- Corridor — a rate limit for guessing at voucher codes
--
-- Six characters from a 32-letter alphabet is a billion, but a guesser does
-- not need a *particular* code — any live one for an operator will do. With a
-- handful in circulation that is one in a few hundred million per try, and
-- measured against the live database `check_voucher()` answered about twenty
-- guesses a second with nothing in the way at all.
--
-- The loss is bounded either way: a code is worth a few dollars off one
-- booking, spendable once per passenger, on a trip they then have to take. So
-- this is not the thing that saves the business. What it shuts is the oracle.
-- `resolve_voucher()` says something different for "not issued", "withdrawn",
-- "expired" and "used up" — which is the right thing to tell a passenger and
-- exactly the wrong thing to tell somebody enumerating. Answering that
-- question twenty times a second, forever, is what stops here.
--
-- ---------------------------------------------------------------------------
-- Why this lives in the database, and why it is shaped so oddly
-- ---------------------------------------------------------------------------
-- A throttle in the Server Action would guard the booking form and nothing
-- else: `check_voucher()` is a PostgREST endpoint any signed-in caller can hit
-- directly, which is exactly what a guesser would do. So the count sits here.
--
-- The awkward part is that **a failure cannot record itself**. PostgREST runs
-- each request in a transaction and rolls it back when the function raises, so
-- an `insert` on the way out of a `raise` is undone with everything else — the
-- counter would sit at zero forever and the throttle would look like it worked
-- while doing nothing. That is worse than no throttle, because it is a throttle
-- you would trust.
--
-- So the writing side is inverted:
--
--   * `resolve_voucher()` still raises, and still carries every rule. What is
--     new is that it *reads* the counter at the top and refuses when it is
--     spent, and clears the counter when a code resolves.
--   * `check_voucher()` no longer raises. It catches, records the failed
--     attempt, and returns the reason in an `error` column — returning
--     normally is what lets the insert commit.
--
-- `request_booking()` keeps raising, so a failure there is not recorded. That
-- asymmetry is deliberate rather than overlooked: it is still *gated* by the
-- counter, and it is a far worse oracle to begin with — it needs a real
-- departure and stops, takes the row lock, runs the per-leg capacity scan, and
-- on a hit creates a real booking that consumes a use and holds a seat. The
-- cheap, quiet oracle is the one worth closing.

create table public.voucher_attempts (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  attempted_at  timestamptz not null default now()
);

create index voucher_attempts_lookup_idx
  on public.voucher_attempts (user_id, attempted_at desc);

alter table public.voucher_attempts enable row level security;

-- No policies, and nothing granted to anon or authenticated. The only writer
-- is a SECURITY DEFINER function reaching the table as the owner. A passenger
-- who could read this could count their own failures, which is harmless; one
-- who could delete from it could reset their own throttle, which is not.
grant select, insert, delete on table public.voucher_attempts to service_role;

-- The window and the ceiling, named once so the function, the recorder below
-- and the tests all read the same numbers.
create or replace function public.voucher_attempt_window()
returns interval language sql immutable as $fn$ select interval '1 hour' $fn$;

create or replace function public.voucher_attempt_limit()
returns integer language sql immutable as $fn$ select 10 $fn$;

-- ---------------------------------------------------------------------------
-- resolve_voucher — gated, and self-clearing
-- ---------------------------------------------------------------------------
-- Replaces the version in 20260920000032_alphanumeric_vouchers.sql. Every
-- existing rule is unchanged and in the same order. What is new is the read at
-- the top and the clear at the bottom; it writes nothing on a failing path,
-- because it cannot.

create or replace function public.resolve_voucher(
  p_operator_id uuid,
  p_code        text,
  p_passenger   uuid,
  p_lock        boolean
)
returns public.vouchers
language plpgsql
-- Volatile: the locking branch takes a FOR UPDATE, and the success path writes.
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_voucher  public.vouchers;
  v_code     text := public.normalise_voucher_code(p_code);
  v_failures integer;
  v_used     integer;
  v_mine     integer;
begin
  select count(*) into v_failures
    from public.voucher_attempts
   where user_id = p_passenger
     and attempted_at >= now() - public.voucher_attempt_window();

  if v_failures >= public.voucher_attempt_limit() then
    raise exception 'Too many codes tried. Wait an hour, or ask the operator to read it to you again.';
  end if;

  if v_code !~ '^[0-9A-Z]{6}$' then
    raise exception 'A voucher code is six letters or numbers.';
  end if;

  if p_lock then
    -- Two passengers spending the last use of the same code at the same
    -- instant queue here, which is the only reason max_uses can be trusted.
    select * into v_voucher from public.vouchers
     where operator_id = p_operator_id and code = v_code
     for update;
  else
    select * into v_voucher from public.vouchers
     where operator_id = p_operator_id and code = v_code;
  end if;

  if not found then
    raise exception 'That code is not one this operator has issued.';
  end if;

  if not v_voucher.is_active then
    raise exception 'That code has been withdrawn.';
  end if;

  if v_voucher.expires_at <= now() then
    raise exception 'That code expired on %.',
      to_char(v_voucher.expires_at at time zone 'America/Toronto', 'FMMon FMDD');
  end if;

  -- Expired holds excluded inline, exactly as capacity excludes them. A use
  -- comes back the instant the hold behind it lapses.
  select count(*) into v_used
    from public.bookings b
   where b.voucher_id = v_voucher.id
     and (
       b.status in ('approved', 'completed', 'settled', 'no_show')
       or (b.status = 'held' and b.hold_expires_at > now())
     );

  if v_used >= v_voucher.max_uses then
    raise exception 'That code has been used up.';
  end if;

  select count(*) into v_mine
    from public.bookings b
   where b.voucher_id = v_voucher.id
     and b.passenger_id = p_passenger
     and (
       b.status in ('approved', 'completed', 'settled', 'no_show')
       or (b.status = 'held' and b.hold_expires_at > now())
     );

  if v_mine > 0 then
    raise exception 'You have already used that code.';
  end if;

  -- Got it right. Forget the fumbles: somebody who mistypes a code twice and
  -- then gets it right is not carrying two strikes for the rest of the hour.
  delete from public.voucher_attempts where user_id = p_passenger;

  return v_voucher;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- check_voucher — records the miss, and therefore cannot raise
-- ---------------------------------------------------------------------------
-- Dropped and recreated rather than replaced: `RETURNS TABLE` gains a column,
-- and Postgres refuses to widen one in place. The drop takes the grants with
-- it, so they are restated at the foot of this file.
--
-- The contract changes with it. Where this used to raise, it now returns one
-- row with `error` set and everything else null, because returning normally is
-- the only way the attempt it just recorded survives the call.

drop function public.check_voucher(uuid, text);

create function public.check_voucher(
  p_departure_id uuid,
  p_code         text
)
returns table (
  code       text,
  kind       public.voucher_kind,
  value      integer,
  expires_at timestamptz,
  error      text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_caller   uuid := auth.uid();
  v_operator uuid;
  v_voucher  public.vouchers;
begin
  if v_caller is null then
    raise exception 'Sign in to use a voucher code.';
  end if;

  select d.operator_id into v_operator
    from public.departures d where d.id = p_departure_id;

  if v_operator is null then
    raise exception 'That departure no longer exists.';
  end if;

  -- Housekeeping on the way past, so the table stays the size of an hour of
  -- traffic rather than growing forever.
  delete from public.voucher_attempts
   where attempted_at < now() - public.voucher_attempt_window();

  begin
    v_voucher := public.resolve_voucher(v_operator, p_code, v_caller, false);
  exception when others then
    -- The subtransaction that raised has rolled back; this insert belongs to
    -- the outer one, which commits as long as we return rather than re-raise.
    insert into public.voucher_attempts (user_id) values (v_caller);
    return query select null::text, null::public.voucher_kind, null::integer,
                        null::timestamptz, sqlerrm;
    return;
  end;

  return query select v_voucher.code, v_voucher.kind, v_voucher.value,
                      v_voucher.expires_at, null::text;
end;
$fn$;

revoke all on function public.resolve_voucher(uuid, text, uuid, boolean) from public;
revoke all on function public.voucher_attempt_window() from public;
revoke all on function public.voucher_attempt_limit() from public;
revoke all on function public.check_voucher(uuid, text) from public;
grant execute on function public.check_voucher(uuid, text) to authenticated;
