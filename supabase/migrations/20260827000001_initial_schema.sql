-- Corridor — initial schema
--
-- Conventions enforced here:
--   * money is integer cents, never float
--   * timestamps are timestamptz, dates are date, never naive timestamp
--   * a departure is a service_date + departure_time in America/Toronto;
--     the absolute instant is derived, not stored (see toronto_instant below)
--   * RLS is enabled on every table. No policies here: a table with RLS on and
--     no policy denies everything, which is the correct default. Policies are
--     added deliberately, per feature, in later migrations.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Local wall-clock (service_date + departure_time, America/Toronto) -> instant.
-- Ontario observes DST, so a 05:00 departure is 05:00 local on both sides of the
-- change and the UTC offset differs. This is STABLE, not IMMUTABLE (tzdata can
-- change), so it cannot be used in a generated column or an index predicate.
create or replace function public.toronto_instant(d date, t time)
returns timestamptz
language sql
stable
as $fn$
  select ((d + t) at time zone 'America/Toronto');
$fn$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.platform_role         as enum ('admin');
create type public.operator_type         as enum ('intercity', 'incity');
create type public.operator_status       as enum ('pending', 'active', 'suspended');
create type public.operator_member_role  as enum ('owner', 'staff', 'driver');
create type public.subscription_plan     as enum ('weekly', 'monthly');
create type public.subscription_status   as enum ('active', 'past_due', 'cancelled');
create type public.pricing_mode          as enum ('matrix', 'additive');
create type public.departure_status      as enum ('scheduled', 'cancelled', 'completed');
create type public.payment_method        as enum ('cash', 'etransfer');
create type public.rating_direction      as enum ('passenger_to_operator', 'operator_to_passenger');

create type public.booking_status as enum (
  'held',
  'approved',
  'declined',
  'expired',
  'cancelled_by_passenger',
  'cancelled_by_operator',
  'completed',
  'no_show',
  'settled'
);

create type public.red_flag_reason as enum (
  'no_show', 'did_not_pay', 'haggled', 'too_loud', 'messy', 'smelly', 'other'
);

create type public.incity_booking_status as enum (
  'held', 'approved', 'declined', 'cancelled', 'completed'
);

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

-- Signup asks for nothing; the profile is completed afterwards, so every
-- optional field here is genuinely nullable.
create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  full_name            text,
  phone                text,
  gender               text,
  photo_url            text,
  accommodation_notes  text,
  platform_role        public.platform_role,   -- null for everyone but admins
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index profiles_platform_role_idx on public.profiles (platform_role)
  where platform_role is not null;

-- ---------------------------------------------------------------------------
-- Operators
-- ---------------------------------------------------------------------------

-- Self-serve signup creates a 'pending' operator, invisible to passengers until
-- a platform admin activates it.
create table public.operators (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  type          public.operator_type not null default 'intercity',
  bio           text,
  public_phone  text,
  status        public.operator_status not null default 'pending',
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint operators_name_not_blank check (length(btrim(name)) > 0)
);

create index operators_status_idx on public.operators (status);

-- A user may belong to more than one operator.
create table public.operator_members (
  id           uuid primary key default gen_random_uuid(),
  operator_id  uuid not null references public.operators (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         public.operator_member_role not null,
  created_at   timestamptz not null default now(),
  unique (operator_id, user_id)
);

create index operator_members_user_idx on public.operator_members (user_id);

-- Payment is collected off-platform in the MVP; this table only records state.
create table public.subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  operator_id         uuid not null references public.operators (id) on delete cascade,
  plan                public.subscription_plan not null,
  status              public.subscription_status not null default 'active',
  current_period_end  date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index subscriptions_operator_idx on public.subscriptions (operator_id);

-- ---------------------------------------------------------------------------
-- Places
-- ---------------------------------------------------------------------------

-- Global and admin-managed. Search happens at this level.
create table public.cities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  province    text not null default 'ON',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- A specific physical pickup/dropoff point, defined by an operator.
-- Booking happens at this level. No coordinates: there is no map anywhere.
create table public.stops (
  id           uuid primary key default gen_random_uuid(),
  operator_id  uuid not null references public.operators (id) on delete cascade,
  city_id      uuid not null references public.cities (id) on delete restrict,
  label        text not null,
  description  text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (operator_id, city_id, label)
);

create index stops_operator_idx on public.stops (operator_id);
create index stops_city_idx     on public.stops (city_id);

-- ---------------------------------------------------------------------------
-- Routes and fares
-- ---------------------------------------------------------------------------

-- An ordered corridor of stops, in ONE direction. The return trip is a separate
-- route with its own stops and its own fares — that is what makes directional
-- fares independent (Toronto->London need not equal London->Toronto).
create table public.routes (
  id            uuid primary key default gen_random_uuid(),
  operator_id   uuid not null references public.operators (id) on delete cascade,
  name          text not null,
  pricing_mode  public.pricing_mode not null default 'matrix',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index routes_operator_idx on public.routes (operator_id);

create table public.route_stops (
  id        uuid primary key default gen_random_uuid(),
  route_id  uuid not null references public.routes (id) on delete cascade,
  stop_id   uuid not null references public.stops (id) on delete restrict,
  seq       integer not null,
  constraint route_stops_seq_positive check (seq >= 1),
  unique (route_id, seq),
  unique (route_id, stop_id)
);

create index route_stops_stop_idx on public.route_stops (stop_id);

-- One row per priced segment.
--   matrix   — every bookable segment is priced explicitly and independently.
--              Toronto->Windsor is NOT the sum of its legs.
--   additive — only consecutive pairs (to_seq = from_seq + 1) are stored, and a
--              segment's fare is the sum of the legs it spans.
-- The additive shape is a convention, not a constraint: enforcing it would need
-- a trigger reading routes.pricing_mode, and the fare calculation in
-- lib/booking is the single place that interprets the mode.
create table public.fares (
  id           uuid primary key default gen_random_uuid(),
  route_id     uuid not null references public.routes (id) on delete cascade,
  from_seq     integer not null,
  to_seq       integer not null,
  price_cents  integer not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint fares_forward_only  check (to_seq > from_seq),
  constraint fares_seq_positive  check (from_seq >= 1),
  constraint fares_price_non_negative check (price_cents >= 0),
  unique (route_id, from_seq, to_seq)
);

-- Recorded, never enforced: operators may change fares freely, but every change
-- writes a row here with a reason ("fuel prices", "winter traffic").
create table public.fare_changes (
  id               uuid primary key default gen_random_uuid(),
  route_id         uuid not null references public.routes (id) on delete cascade,
  from_seq         integer not null,
  to_seq           integer not null,
  old_price_cents  integer,                    -- null when the fare is new
  new_price_cents  integer not null,
  reason           text not null,
  changed_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint fare_changes_reason_not_blank check (length(btrim(reason)) > 0),
  constraint fare_changes_price_non_negative check (new_price_cents >= 0)
);

create index fare_changes_route_idx on public.fare_changes (route_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------

-- A recurring departure. days_of_week uses 0 = Sunday .. 6 = Saturday, matching
-- Postgres extract(dow) and JavaScript getDay().
create table public.schedules (
  id              uuid primary key default gen_random_uuid(),
  route_id        uuid not null references public.routes (id) on delete cascade,
  departure_time  time not null,
  days_of_week    smallint[] not null,
  max_seats       integer not null,
  active_from     date not null,
  active_to       date,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint schedules_days_valid check (
    array_length(days_of_week, 1) between 1 and 7
    and days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  constraint schedules_max_seats_positive check (max_seats > 0),
  constraint schedules_active_range check (active_to is null or active_to >= active_from)
);

create index schedules_route_idx on public.schedules (route_id);

-- One concrete instance on one date — what a passenger actually books onto.
-- schedule_id is nullable so an operator can add a one-off extra departure.
-- max_seats is SNAPSHOTTED: editing the schedule must never change the capacity
-- of a departure that has already been sold.
create table public.departures (
  id              uuid primary key default gen_random_uuid(),
  operator_id     uuid not null references public.operators (id) on delete cascade,
  route_id        uuid not null references public.routes (id) on delete restrict,
  schedule_id     uuid references public.schedules (id) on delete set null,
  service_date    date not null,
  departure_time  time not null,
  max_seats       integer not null,
  status          public.departure_status not null default 'scheduled',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint departures_max_seats_positive check (max_seats > 0)
);

-- Departure generation is idempotent: re-running it cannot double-create.
create unique index departures_schedule_date_uniq
  on public.departures (schedule_id, service_date)
  where schedule_id is not null;

create index departures_search_idx   on public.departures (service_date, status);
create index departures_route_idx    on public.departures (route_id, service_date);
create index departures_operator_idx on public.departures (operator_id, service_date);

create table public.vehicles (
  id           uuid primary key default gen_random_uuid(),
  operator_id  uuid not null references public.operators (id) on delete cascade,
  label        text not null,
  seat_count   integer not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint vehicles_seat_count_positive check (seat_count > 0)
);

create index vehicles_operator_idx on public.vehicles (operator_id);

-- One departure can have MANY of these: that is how a 12-passenger departure
-- splits across two vans. Assignment is late-bound and entirely the operator's
-- call, and is never exposed to passengers.
create table public.departure_vehicles (
  id            uuid primary key default gen_random_uuid(),
  departure_id  uuid not null references public.departures (id) on delete cascade,
  vehicle_id    uuid not null references public.vehicles (id) on delete restrict,
  driver_id     uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (departure_id, vehicle_id)
);

create index departure_vehicles_driver_idx on public.departure_vehicles (driver_id);

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------

-- from_seq / to_seq are denormalized from route_stops on purpose: the per-leg
-- capacity check must not join back through route_stops at query time.
--
-- Capacity is consumed PER LEG, not per departure. A booking occupies leg i for
-- every i where from_seq <= i and to_seq >= i + 1, so a 16-seat departure can
-- carry far more than 16 bookings as long as no single leg exceeds 16.
--
-- A booking counts against capacity when:
--   status in ('approved','completed','settled')
--   or (status = 'held' and hold_expires_at > now())
-- Expired holds are excluded inline, which makes capacity self-healing: a seat
-- frees itself the instant its hold lapses, whether or not any job has run.
create table public.bookings (
  id                    uuid primary key default gen_random_uuid(),
  departure_id          uuid not null references public.departures (id) on delete cascade,
  passenger_id          uuid not null references public.profiles (id) on delete restrict,

  from_stop_id          uuid not null references public.stops (id) on delete restrict,
  to_stop_id            uuid not null references public.stops (id) on delete restrict,
  from_seq              integer not null,
  to_seq                integer not null,
  seats                 integer not null default 1,

  status                public.booking_status not null default 'held',
  hold_expires_at       timestamptz,

  -- Fare snapshot, computed server-side from the operator's fare rows at
  -- booking time. Never trust a price from the client; never rewrite history
  -- when the operator later changes a fare.
  luggage_count         integer not null default 0,
  base_cents            integer not null,
  luggage_cents         integer not null default 0,
  airport_cents         integer not null default 0,
  total_cents           integer not null,

  passenger_note        text,
  assigned_vehicle_id   uuid references public.vehicles (id) on delete set null,

  payment_method         public.payment_method,
  passenger_confirmed_at timestamptz,
  driver_confirmed_at    timestamptz,

  approved_at           timestamptz,
  cancelled_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint bookings_forward_only    check (to_seq > from_seq),
  constraint bookings_seq_positive    check (from_seq >= 1),
  constraint bookings_seats_positive  check (seats > 0),
  constraint bookings_luggage_non_negative check (luggage_count >= 0),
  constraint bookings_money_non_negative check (
    base_cents >= 0 and luggage_cents >= 0 and airport_cents >= 0 and total_cents >= 0
  ),
  constraint bookings_total_is_sum check (
    total_cents = base_cents + luggage_cents + airport_cents
  ),
  -- A hold without an expiry would occupy capacity forever.
  constraint bookings_held_needs_expiry check (
    status <> 'held' or hold_expires_at is not null
  )
);

-- Serves the per-leg capacity scan for one departure.
create index bookings_capacity_idx   on public.bookings (departure_id, from_seq, to_seq);
create index bookings_status_idx     on public.bookings (departure_id, status);
create index bookings_passenger_idx  on public.bookings (passenger_id, created_at desc);
create index bookings_manifest_idx   on public.bookings (departure_id, assigned_vehicle_id);
-- Lets a job sweep stale holds for display, without correctness depending on it.
create index bookings_hold_expiry_idx on public.bookings (hold_expires_at)
  where status = 'held';

-- ---------------------------------------------------------------------------
-- Reputation
-- ---------------------------------------------------------------------------

create table public.ratings (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings (id) on delete cascade,
  direction     public.rating_direction not null,
  rater_id      uuid not null references public.profiles (id) on delete cascade,
  operator_id   uuid not null references public.operators (id) on delete cascade,
  passenger_id  uuid not null references public.profiles (id) on delete cascade,
  score         integer not null,
  comment       text,
  created_at    timestamptz not null default now(),
  constraint ratings_score_range check (score between 1 and 5),
  -- One rating per booking per direction.
  unique (booking_id, direction)
);

create index ratings_operator_idx  on public.ratings (operator_id);
create index ratings_passenger_idx on public.ratings (passenger_id);

-- An operator's negative mark on a passenger after a trip. Shown to operators
-- when they decide whether to approve a request.
create table public.red_flags (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings (id) on delete cascade,
  operator_id   uuid not null references public.operators (id) on delete cascade,
  passenger_id  uuid not null references public.profiles (id) on delete cascade,
  reason        public.red_flag_reason not null,
  note          text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index red_flags_passenger_idx on public.red_flags (passenger_id);

-- ---------------------------------------------------------------------------
-- In-city (Phase 6 — tables exist from day one, nothing else does)
-- ---------------------------------------------------------------------------

create table public.incity_zones (
  id                 uuid primary key default gen_random_uuid(),
  operator_id        uuid not null references public.operators (id) on delete cascade,
  name               text not null,
  flat_price_cents   integer not null,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint incity_zones_price_non_negative check (flat_price_cents >= 0),
  unique (operator_id, name)
);

-- An add-on to a parent intercity booking, with its own separate approval.
create table public.incity_bookings (
  id                   uuid primary key default gen_random_uuid(),
  booking_id           uuid not null references public.bookings (id) on delete cascade,
  operator_id          uuid not null references public.operators (id) on delete cascade,
  pickup_stop_id       uuid not null references public.stops (id) on delete restrict,
  zone_id              uuid not null references public.incity_zones (id) on delete restrict,
  destination_address  text not null,
  price_cents          integer not null,
  status               public.incity_booking_status not null default 'held',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint incity_bookings_price_non_negative check (price_cents >= 0)
);

create index incity_bookings_booking_idx  on public.incity_bookings (booking_id);
create index incity_bookings_operator_idx on public.incity_bookings (operator_id, status);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

do $mig$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'operators', 'subscriptions', 'stops', 'routes', 'fares',
    'schedules', 'departures', 'vehicles', 'bookings', 'incity_zones',
    'incity_bookings'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end;
$mig$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- On for every table. Policies are added per feature in later migrations; a
-- table with RLS on and no policy denies everything, which is the right default.

do $mig$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'operators', 'operator_members', 'subscriptions', 'cities',
    'stops', 'routes', 'route_stops', 'fares', 'fare_changes', 'schedules',
    'departures', 'vehicles', 'departure_vehicles', 'bookings', 'ratings',
    'red_flags', 'incity_zones', 'incity_bookings'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$mig$;
