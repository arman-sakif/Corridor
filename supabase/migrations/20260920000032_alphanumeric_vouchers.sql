-- Corridor — voucher codes become alphanumeric
--
-- Six digits is a million codes. Six characters from a 32-letter alphabet is a
-- billion, which is the difference between a space an operator could exhaust
-- and one they never will — and, more to the point, between a code a script
-- can sweep in an afternoon and one it cannot.
--
-- ---------------------------------------------------------------------------
-- The alphabet, and what is missing from it
-- ---------------------------------------------------------------------------
-- `0123456789ABCDEFGHJKMNPQRSTVWXYZ` — the digits, and the letters without
-- I, L, O and U.
--
-- A code is read down a phone line and typed into a phone at a bus stop, so
-- the pairs that get misheard and mistyped are not worth the extra entropy:
-- O against 0, and I or L against 1. Dropping the letter of each pair rather
-- than the digit means a passenger who types the letter anyway can still be
-- understood — `resolve_voucher()` below folds O to 0 and I and L to 1 before
-- it looks anything up, so OIL2AB and 0112AB are the same code. U is out
-- because a random six-character string should not be able to spell something
-- an operator would rather not have printed on a card.
--
-- The stored shape stays deliberately wider than the generated alphabet:
-- `^[0-9A-Z]{6}$`. The constraint is a shape guard, not an alphabet guard, and
-- widening it this way means the numeric codes already issued stay valid
-- instead of failing the ALTER. Nothing but `create_voucher()` can insert a
-- row, so the alphabet is enforced where it is chosen.

alter table public.vouchers
  drop constraint vouchers_code_is_six_digits,
  add constraint vouchers_code_is_six_chars check (code ~ '^[0-9A-Z]{6}$');

-- ---------------------------------------------------------------------------
-- normalise_voucher_code — what the passenger typed, as the code it means
-- ---------------------------------------------------------------------------
-- Case folding and the O/I/L substitutions in one place, so the booking form,
-- the check, and the booking itself cannot disagree about whether `oil2ab`
-- is a code.

create or replace function public.normalise_voucher_code(p_code text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select translate(upper(btrim(coalesce(p_code, ''))), 'OIL', '011');
$fn$;

-- ---------------------------------------------------------------------------
-- resolve_voucher, normalising first
-- ---------------------------------------------------------------------------
-- Replaces the version in 20260920000030_vouchers.sql. Every rule is
-- unchanged; the only difference is that the code is normalised before it is
-- looked up, and the shape it is checked against is no longer digits-only.

create or replace function public.resolve_voucher(
  p_operator_id uuid,
  p_code        text,
  p_passenger   uuid,
  p_lock        boolean
)
returns public.vouchers
language plpgsql
-- Volatile, not stable: the locking branch below takes a FOR UPDATE, and
-- Postgres refuses one inside a function that claims not to change anything.
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_voucher public.vouchers;
  v_code    text := public.normalise_voucher_code(p_code);
  v_used    integer;
  v_mine    integer;
begin
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

  return v_voucher;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- create_voucher, drawing from the wider alphabet
-- ---------------------------------------------------------------------------
-- Replaces the version in 20260920000030_vouchers.sql. Only the draw changed.

create or replace function public.create_voucher(
  p_operator_id uuid,
  p_kind        public.voucher_kind,
  p_value       integer,
  p_window      public.voucher_window,
  p_max_uses    integer
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  -- Digits and letters, without I, L, O and U. See the head of this file.
  c_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_type     public.operator_type;
  v_expires  timestamptz;
  v_code     text;
begin
  if not public.is_operator_manager(p_operator_id) then
    raise exception 'Only this operator can create a voucher.';
  end if;

  select o.type into v_type from public.operators o where o.id = p_operator_id;

  if v_type <> 'intercity' then
    raise exception 'Vouchers apply to seat bookings, which in-city operators do not sell.';
  end if;

  if p_kind = 'percent' and (p_value < 1 or p_value > 100) then
    raise exception 'A percentage discount is between 1 and 100.';
  end if;

  if p_kind = 'amount' and (p_value < 1 or p_value > 100000) then
    raise exception 'An amount off is between $0.01 and $1,000.';
  end if;

  if p_max_uses < 1 or p_max_uses > 10000 then
    raise exception 'A code can be used between 1 and 10,000 times.';
  end if;

  v_expires := now() + case p_window
    when '3d' then interval '3 days'
    when '7d' then interval '7 days'
    when '1m' then interval '1 month'
    when '4m' then interval '4 months'
  end;

  -- A billion codes and an operator will hold a handful, so a collision is
  -- vanishingly rare and retrying is cheaper than reserving. The unique index
  -- is what actually decides, not the loop count.
  for i in 1 .. 40 loop
    v_code := '';
    for j in 1 .. 6 loop
      v_code := v_code
        || substr(c_alphabet, 1 + floor(random() * length(c_alphabet))::integer, 1);
    end loop;

    begin
      insert into public.vouchers (
        operator_id, code, kind, value, validity, expires_at, max_uses, created_by
      ) values (
        p_operator_id, v_code, p_kind, p_value, p_window, v_expires, p_max_uses, auth.uid()
      );
      return v_code;
    exception when unique_violation then
      -- Taken. Draw again.
    end;
  end loop;

  raise exception 'We could not find a free code. Try again in a moment.';
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- `create or replace` keeps the existing grants, but state them anyway so
-- reachability is a property of this file rather than of a previous one.
-- `normalise_voucher_code` is new, so it defaults to PUBLIC EXECUTE.

revoke all on function public.normalise_voucher_code(text) from public;
revoke all on function public.resolve_voucher(uuid, text, uuid, boolean) from public;
revoke all on function public.create_voucher(uuid, public.voucher_kind, integer, public.voucher_window, integer) from public;

-- Normalising is not a lookup — it reveals nothing about which codes exist —
-- but nothing outside the database needs it either, so it stays shut.
grant execute on function public.create_voucher(uuid, public.voucher_kind, integer, public.voucher_window, integer)
  to authenticated;
