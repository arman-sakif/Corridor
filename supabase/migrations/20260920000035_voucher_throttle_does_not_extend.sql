-- Corridor — a lockout that actually ends
--
-- 20260920000034 shut the enumeration oracle, and driving it against the live
-- database showed it shutting: ten guesses got a real answer and the next
-- thirty got "too many codes tried". But it recorded forty attempts, not ten.
--
-- The refusal `check_voucher()` catches is recorded whatever it was — and once
-- the counter is spent, the refusal *is* the throttle. So every further knock
-- wrote another row, the window never emptied, and "wait an hour" quietly
-- meant "wait an hour after you stop trying". Against an attacker holding down
-- a key that is arguably a feature; against a passenger who keeps prodding the
-- form it is a lie told by an error message, and the error message is the only
-- thing they have to go on.
--
-- So the throttle refusal is now marked, and marked refusals are not counted.
-- `PT429` is not an arbitrary code: PostgREST reads SQLSTATEs of the form
-- PTnnn as an HTTP status, so a throttle that escapes through
-- `request_booking()` surfaces as 429 Too Many Requests rather than as a
-- generic 400.

create or replace function public.resolve_voucher(
  p_operator_id uuid,
  p_code        text,
  p_passenger   uuid,
  p_lock        boolean
)
returns public.vouchers
language plpgsql
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
    -- Marked, so the recorder below knows not to count it. Without this the
    -- lockout renews itself for as long as somebody keeps knocking.
    raise exception 'Too many codes tried. Wait an hour, or ask the operator to read it to you again.'
      using errcode = 'PT429';
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
-- check_voucher, counting only what was actually a guess
-- ---------------------------------------------------------------------------
-- Same shape as 20260920000034; the handler now asks what it caught before it
-- writes anything down.

create or replace function public.check_voucher(
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
    -- The subtransaction that raised has rolled back; an insert here belongs
    -- to the outer one, which commits as long as we return rather than
    -- re-raise. Being turned away for knocking too often is not another
    -- knock, so it is not counted — otherwise the hour never ends.
    if sqlstate <> 'PT429' then
      insert into public.voucher_attempts (user_id) values (v_caller);
    end if;

    return query select null::text, null::public.voucher_kind, null::integer,
                        null::timestamptz, sqlerrm;
    return;
  end;

  return query select v_voucher.code, v_voucher.kind, v_voucher.value,
                      v_voucher.expires_at, null::text;
end;
$fn$;

revoke all on function public.resolve_voucher(uuid, text, uuid, boolean) from public;
revoke all on function public.check_voucher(uuid, text) from public;
grant execute on function public.check_voucher(uuid, text) to authenticated;
