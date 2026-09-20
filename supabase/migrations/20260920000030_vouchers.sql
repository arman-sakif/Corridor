-- Corridor — voucher codes
--
-- An operator hands out a six-digit code — on a Kijiji ad, in a WhatsApp
-- group, on a card in the van — and a passenger types it when they request a
-- seat. It comes off the total.
--
-- ---------------------------------------------------------------------------
-- The rules, and why they are these rules
-- ---------------------------------------------------------------------------
--   * Six digits, because it is read aloud down a phone line. That is a small
--     space (a million), so the code is scoped to ONE operator and is only
--     resolvable by a signed-in passenger. Two operators may both issue
--     123456 and neither can spend the other's.
--
--   * It expires. The operator picks one of four windows — 3 days, 7 days, 1
--     month, 4 months — and the instant is computed here, never sent by the
--     browser.
--
--   * It has a ceiling. `max_uses` caps the whole promotion, and one passenger
--     may spend a given code once. A code that leaks is then a bounded loss
--     rather than an unbounded one.
--
--   * A lapsed hold does not consume a use. Exactly the rule §5.2 states for
--     seats: the count below excludes expired holds INLINE, so a use frees
--     itself the moment its hold lapses, whether or not any sweep has run.
--
--   * The discount is recomputed and snapshotted at booking time, like every
--     other number on a booking. `request_booking()` takes a code, never an
--     amount — a discount that arrived from a browser is a discount the
--     passenger chose.
--
-- Deliberately intercity-only. `incity_bookings` is a separate flow that
-- nothing in the intercity path imports, and giving it vouchers means giving
-- it its own redemption rules; `create_voucher()` refuses an in-city operator
-- rather than half-building it.

create type public.voucher_kind   as enum ('amount', 'percent');
create type public.voucher_window as enum ('3d', '7d', '1m', '4m');

create table public.vouchers (
  id           uuid primary key default gen_random_uuid(),
  operator_id  uuid not null references public.operators (id) on delete cascade,

  -- Exactly six digits, stored as text: leading zeros are part of the code.
  code         text not null,

  kind         public.voucher_kind not null,
  -- Cents off for 'amount', whole percent for 'percent'. One column because
  -- the two are never both meaningful, and the check constraint below keeps
  -- each in its own range.
  value        integer not null,

  validity     public.voucher_window not null,
  expires_at   timestamptz not null,

  max_uses     integer not null,
  is_active    boolean not null default true,

  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint vouchers_code_is_six_digits check (code ~ '^[0-9]{6}$'),
  constraint vouchers_max_uses_positive  check (max_uses >= 1),
  constraint vouchers_value_in_range check (
    case kind
      when 'percent' then value between 1 and 100
      when 'amount'  then value between 1 and 100000  -- $1 to $1,000 off
    end
  )
);

-- One meaning per code per business, forever. Reusing a retired code would
-- make an operator's own records ambiguous.
create unique index vouchers_operator_code_uniq on public.vouchers (operator_id, code);
create index vouchers_operator_idx on public.vouchers (operator_id, created_at desc);

create trigger vouchers_set_updated_at
  before update on public.vouchers
  for each row execute function public.set_updated_at();

-- The loop in the initial schema turned RLS on for the tables that existed
-- then. A table added later gets nothing by default, and a table with RLS off
-- is readable by anyone holding the anon key — every live promotion on the
-- platform, one select away.
alter table public.vouchers enable row level security;

-- ---------------------------------------------------------------------------
-- What a redeemed voucher leaves on the booking
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column voucher_id     uuid references public.vouchers (id) on delete set null,
  add column discount_cents integer not null default 0;

create index bookings_voucher_idx on public.bookings (voucher_id)
  where voucher_id is not null;

-- The fare snapshot has always had to add up. It still does — with one more
-- term. `discount_cents` can never exceed what was charged before it, so
-- `total_cents >= 0` continues to hold without a second rule saying so.
alter table public.bookings
  drop constraint bookings_total_is_sum,
  add constraint bookings_total_is_sum check (
    total_cents = base_cents + luggage_cents + airport_cents - discount_cents
  ),
  add constraint bookings_discount_non_negative check (discount_cents >= 0),
  add constraint bookings_discount_within_fare check (
    discount_cents <= base_cents + luggage_cents + airport_cents
  );

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- A passenger never reads this table. A code is something they are told, and
-- `check_voucher()` below is the only way to ask about one — otherwise every
-- live promotion on the platform would be one select away.
--
-- Read-only to the API even for the operator that owns it, for the reason
-- stated in §8: RLS governs rows, not columns. An update policy scoped to
-- "your own voucher" is also an update policy on `expires_at` and `code`.

create policy vouchers_select_own on public.vouchers
  for select to authenticated
  using (public.is_operator_member(operator_id));

create policy vouchers_select_admin on public.vouchers
  for select to authenticated
  using (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- The arithmetic
-- ---------------------------------------------------------------------------
-- Integer division, so a percentage of an odd total rounds in the operator's
-- favour by at most a cent, and never produces a fraction. Money is cents.
--
-- Capped at the total: a $20 code against a $15 fare makes the trip free, not
-- a fare the operator owes the passenger.

create or replace function public.voucher_discount_cents(
  p_kind        public.voucher_kind,
  p_value       integer,
  p_total_cents integer
)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select greatest(
    least(
      case when p_kind = 'percent' then (p_total_cents * p_value) / 100 else p_value end,
      p_total_cents
    ),
    0
  );
$fn$;

-- ---------------------------------------------------------------------------
-- resolve_voucher — one set of rules, two callers
-- ---------------------------------------------------------------------------
-- `check_voucher()` asks so the booking page can show the discount before the
-- passenger commits; `request_booking()` asks again, holding the row, at the
-- moment it matters. Both have to answer identically or the page lies, so
-- neither has its own copy of the rules.
--
-- Raises rather than returning null, because every refusal has a different
-- thing the passenger can do about it and "invalid code" tells them none of
-- them.

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
  v_code    text := btrim(coalesce(p_code, ''));
  v_used    integer;
  v_mine    integer;
begin
  if v_code !~ '^[0-9]{6}$' then
    raise exception 'A voucher code is six digits.';
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
-- check_voucher — what the booking page asks
-- ---------------------------------------------------------------------------
-- Takes a departure rather than an operator, because the departure is what the
-- passenger is looking at. Signed-in only: six digits is a small space, and
-- there is no reason for a stranger to be able to sweep it.

create or replace function public.check_voucher(
  p_departure_id uuid,
  p_code         text
)
returns table (
  code       text,
  kind       public.voucher_kind,
  value      integer,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_operator uuid;
  v_voucher  public.vouchers;
begin
  if auth.uid() is null then
    raise exception 'Sign in to use a voucher code.';
  end if;

  select d.operator_id into v_operator
    from public.departures d where d.id = p_departure_id;

  if v_operator is null then
    raise exception 'That departure no longer exists.';
  end if;

  v_voucher := public.resolve_voucher(v_operator, p_code, auth.uid(), false);

  return query select v_voucher.code, v_voucher.kind, v_voucher.value, v_voucher.expires_at;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- create_voucher — the operator's side
-- ---------------------------------------------------------------------------
-- The code is generated here, not chosen: an operator picking their own would
-- pick 111111, and two of them would pick it on the same day.
--
-- The expiry window is one of four, and the instant is computed from now()
-- inside the database. A browser that sent an expiry could send any expiry.

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
  v_type    public.operator_type;
  v_expires timestamptz;
  v_code    text;
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

  -- Six digits is a million codes and an operator will hold a handful, so a
  -- collision is rare and retrying is cheaper than reserving. The unique index
  -- is what actually decides, not the count below it.
  for i in 1 .. 40 loop
    v_code := lpad((floor(random() * 1000000))::integer::text, 6, '0');

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

-- Withdrawing a code, and putting it back. Not a delete: the bookings that
-- already spent it point at the row, and an operator's own history of what
-- they offered is worth keeping.
create or replace function public.set_voucher_active(
  p_voucher_id uuid,
  p_active     boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_operator uuid;
begin
  select operator_id into v_operator from public.vouchers where id = p_voucher_id;

  if v_operator is null then
    raise exception 'That code no longer exists.';
  end if;

  if not public.is_operator_manager(v_operator) then
    raise exception 'Only this operator can change that code.';
  end if;

  update public.vouchers set is_active = p_active where id = p_voucher_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- voucher_uses — how far a promotion has got
-- ---------------------------------------------------------------------------
-- The promotions page needs a live count per code, and it has to be the same
-- count resolve_voucher() enforces — including the inline exclusion of lapsed
-- holds. Counting it in TypeScript from a list of bookings would be a second
-- answer to a question that already has one.

create or replace function public.voucher_uses(p_operator_id uuid)
returns table (voucher_id uuid, uses integer, discount_cents bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select v.id,
         count(b.id)::integer,
         coalesce(sum(b.discount_cents), 0)::bigint
    from public.vouchers v
    left join public.bookings b
      on b.voucher_id = v.id
     and (
       b.status in ('approved', 'completed', 'settled', 'no_show')
       or (b.status = 'held' and b.hold_expires_at > now())
     )
   where v.operator_id = p_operator_id
     and (public.is_operator_member(p_operator_id) or public.is_platform_admin())
   group by v.id;
$fn$;

-- ---------------------------------------------------------------------------
-- request_booking, with the voucher applied
-- ---------------------------------------------------------------------------
-- Replaces the version in 20260829000009_surcharges.sql. The lock, the per-leg
-- capacity scan and the fare recomputation are untouched; what is new is the
-- last parameter and the two lines that spend it.
--
-- Dropped and recreated rather than replaced: the signature gains an argument,
-- and leaving the six-argument version in place would make every existing call
-- ambiguous. The new argument defaults, so a caller that passes six still
-- resolves here.

drop function public.request_booking(uuid, uuid, uuid, integer, integer, text);

create function public.request_booking(
  p_departure_id   uuid,
  p_from_stop_id   uuid,
  p_to_stop_id     uuid,
  p_seats          integer,
  p_luggage_count  integer,
  p_passenger_note text,
  p_voucher_code   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_passenger      uuid := auth.uid();
  v_departure      record;
  v_operator       record;
  v_from_seq       integer;
  v_to_seq         integer;
  v_pricing_mode   public.pricing_mode;
  v_base_per_seat  integer;
  v_leg            integer;
  v_taken          integer;
  v_hold_expires   timestamptz;
  v_booking_id     uuid;
  v_luggage        integer := greatest(coalesce(p_luggage_count, 0), 0);
  v_extra_bags     integer;
  v_luggage_cents  integer;
  v_airport_cents  integer;
  v_touches_airport boolean;
  v_code           text := nullif(btrim(coalesce(p_voucher_code, '')), '');
  v_voucher        public.vouchers;
  v_voucher_id     uuid;
  v_before_discount integer;
  v_discount       integer := 0;
begin
  if v_passenger is null then
    raise exception 'You need to be signed in to request a seat.';
  end if;

  if p_seats < 1 then
    raise exception 'A booking needs at least one seat.';
  end if;

  if coalesce(p_luggage_count, 0) < 0 then
    raise exception 'Luggage cannot be negative.';
  end if;

  -- Lock the departure. Every concurrent request for the same departure
  -- queues here, which is precisely the point: the count below is then taken
  -- against a state nobody else can be changing.
  select d.id, d.route_id, d.operator_id, d.max_seats, d.status,
         d.service_date, d.departure_time
    into v_departure
    from public.departures d
   where d.id = p_departure_id
     for update;

  if not found then
    raise exception 'That departure no longer exists.';
  end if;

  if v_departure.status <> 'scheduled' then
    raise exception 'That departure is no longer running.';
  end if;

  if public.toronto_instant(v_departure.service_date, v_departure.departure_time) <= now() then
    raise exception 'That departure has already left.';
  end if;

  if not public.operator_is_active(v_departure.operator_id) then
    raise exception 'That operator is not taking bookings.';
  end if;

  select rs.seq into v_from_seq
    from public.route_stops rs
   where rs.route_id = v_departure.route_id and rs.stop_id = p_from_stop_id;

  select rs.seq into v_to_seq
    from public.route_stops rs
   where rs.route_id = v_departure.route_id and rs.stop_id = p_to_stop_id;

  if v_from_seq is null or v_to_seq is null then
    raise exception 'Those stops are not both on this route.';
  end if;

  if v_to_seq <= v_from_seq then
    raise exception 'This departure travels the other way along those stops.';
  end if;

  -- ---- capacity, leg by leg -------------------------------------------
  -- Not per departure. A 16-seat van can carry far more than 16 bookings, so
  -- long as no single stretch between two stops exceeds 16.
  for v_leg in v_from_seq .. (v_to_seq - 1) loop
    select coalesce(sum(b.seats), 0) into v_taken
      from public.bookings b
     where b.departure_id = p_departure_id
       and b.from_seq <= v_leg
       and b.to_seq   >= v_leg + 1
       and (
         b.status in ('approved', 'completed', 'settled')
         or (b.status = 'held' and b.hold_expires_at > now())
       );

    if v_taken + p_seats > v_departure.max_seats then
      raise exception 'There are not enough seats left on this departure for that trip.'
        using errcode = 'check_violation';
    end if;
  end loop;

  -- ---- fare, recomputed from the operator's rows -----------------------
  select r.pricing_mode into v_pricing_mode
    from public.routes r where r.id = v_departure.route_id;

  if v_pricing_mode = 'matrix' then
    select f.price_cents into v_base_per_seat
      from public.fares f
     where f.route_id = v_departure.route_id
       and f.from_seq = v_from_seq
       and f.to_seq = v_to_seq;
  else
    -- additive: sum the consecutive legs the segment spans. A single missing
    -- leg leaves this null, which means the segment is not for sale.
    select case
             when count(*) = (v_to_seq - v_from_seq) then sum(f.price_cents)::integer
             else null
           end
      into v_base_per_seat
      from public.fares f
     where f.route_id = v_departure.route_id
       and f.from_seq >= v_from_seq
       and f.to_seq <= v_to_seq
       and f.to_seq = f.from_seq + 1;
  end if;

  if v_base_per_seat is null then
    raise exception 'This operator does not sell that pair of stops.';
  end if;

  -- ---- surcharges, from the operator's own settings --------------------
  select o.free_luggage_per_seat, o.extra_luggage_cents, o.airport_fee_cents
    into v_operator
    from public.operators o
   where o.id = v_departure.operator_id;

  -- The allowance is per seat, so a party of two carries two bags free.
  v_extra_bags := greatest(v_luggage - (v_operator.free_luggage_per_seat * p_seats), 0);
  v_luggage_cents := v_extra_bags * v_operator.extra_luggage_cents;

  select exists (
    select 1 from public.stops s
    where s.id in (p_from_stop_id, p_to_stop_id) and s.is_airport
  ) into v_touches_airport;

  v_airport_cents := case when v_touches_airport
                          then v_operator.airport_fee_cents * p_seats
                          else 0 end;

  -- ---- the voucher, if they brought one --------------------------------
  -- The code is spent against the whole fare, surcharges included. A wrong,
  -- withdrawn, expired or already-spent code stops the booking here with a
  -- message saying which — quietly charging full price for a trip somebody
  -- thought was discounted is the one outcome nobody wants.
  v_before_discount := (v_base_per_seat * p_seats) + v_luggage_cents + v_airport_cents;

  if v_code is not null then
    v_voucher := public.resolve_voucher(v_departure.operator_id, v_code, v_passenger, true);
    v_voucher_id := v_voucher.id;
    v_discount := public.voucher_discount_cents(
      v_voucher.kind, v_voucher.value, v_before_discount
    );
  end if;

  -- ---- the hold --------------------------------------------------------
  -- An hour to decide, but never past the departure itself.
  v_hold_expires := least(
    now() + interval '1 hour',
    public.toronto_instant(v_departure.service_date, v_departure.departure_time)
  );

  insert into public.bookings (
    departure_id, passenger_id,
    from_stop_id, to_stop_id, from_seq, to_seq, seats,
    status, hold_expires_at,
    luggage_count, base_cents, luggage_cents, airport_cents,
    voucher_id, discount_cents, total_cents,
    passenger_note
  ) values (
    p_departure_id, v_passenger,
    p_from_stop_id, p_to_stop_id, v_from_seq, v_to_seq, p_seats,
    'held', v_hold_expires,
    v_luggage,
    v_base_per_seat * p_seats,
    v_luggage_cents,
    v_airport_cents,
    v_voucher_id,
    v_discount,
    v_before_discount - v_discount,
    nullif(btrim(coalesce(p_passenger_note, '')), '')
  )
  returning id into v_booking_id;

  return v_booking_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Every function created above defaults to PUBLIC EXECUTE; the sweep in
-- 20260829000008 covered only what existed then. And the drop above took
-- request_booking's grants with it.

grant select on table public.vouchers to authenticated;
grant select, insert, update, delete on table public.vouchers to service_role;

revoke all on function public.voucher_discount_cents(public.voucher_kind, integer, integer) from public;
revoke all on function public.resolve_voucher(uuid, text, uuid, boolean) from public;
revoke all on function public.check_voucher(uuid, text) from public;
revoke all on function public.create_voucher(uuid, public.voucher_kind, integer, public.voucher_window, integer) from public;
revoke all on function public.set_voucher_active(uuid, boolean) from public;
revoke all on function public.voucher_uses(uuid) from public;
revoke all on function public.request_booking(uuid, uuid, uuid, integer, integer, text, text) from public;

-- `resolve_voucher` is not granted to anybody. It is the shared rule set, and
-- the two functions that call it are SECURITY DEFINER, so they reach it as the
-- owner. Exposing it directly would hand out an oracle over every code.
grant execute on function public.voucher_discount_cents(public.voucher_kind, integer, integer)
  to authenticated;
grant execute on function public.check_voucher(uuid, text) to authenticated;
grant execute on function public.create_voucher(uuid, public.voucher_kind, integer, public.voucher_window, integer)
  to authenticated;
grant execute on function public.set_voucher_active(uuid, boolean) to authenticated;
grant execute on function public.voucher_uses(uuid) to authenticated;
grant execute on function public.request_booking(uuid, uuid, uuid, integer, integer, text, text)
  to authenticated;
