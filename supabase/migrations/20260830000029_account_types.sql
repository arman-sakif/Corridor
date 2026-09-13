-- Corridor — account types: passenger, driver, operator, admin
--
-- One person, one login, and a choice of which hat they are wearing. What
-- someone *can* be still comes from what they are: `platform_role` for admin,
-- `operator_members` for operator (owner or staff) and for driver. Two things
-- become the person's own to switch, and only downstream of a role they
-- already hold:
--
--   passenger_enabled  Anyone above passenger — an admin, or any member of a
--                      business — can switch it on or off. For a plain
--                      passenger it is their only account type, and stays on.
--
--   drives_enabled     A business owner can switch driving on for themselves.
--                      Drivers and staff are added by the business, never
--                      self-made.
--
-- Which type is *active* is not stored here. It is a cookie the app checks
-- against these rules on every request. The database goes on permitting what
-- the person really is, so no policy is loosened or tightened by the choice.

alter table public.profiles
  add column passenger_enabled boolean not null default true,
  add column drives_enabled    boolean not null default false;

-- Existing accounts. An operator, driver or admin who has never booked starts
-- with passenger off; anyone who has booked keeps it, so nobody loses sight of
-- a ride they already hold. An owner who has already driven keeps driving.
update public.profiles p
   set passenger_enabled = false
 where (p.platform_role is not null
        or exists (select 1 from public.operator_members m where m.user_id = p.id))
   and not exists (select 1 from public.bookings b where b.passenger_id = p.id);

update public.profiles p
   set drives_enabled = true
 where exists (select 1 from public.operator_members m where m.user_id = p.id and m.role = 'owner')
   and exists (select 1 from public.departure_vehicles dv where dv.driver_id = p.id);

-- ---------------------------------------------------------------------------
-- The guard
-- ---------------------------------------------------------------------------
-- RLS governs rows, not columns: `profiles_update_own` would let anyone flip
-- these on their own row, including a passenger switching on driving. The same
-- lesson as `20260829000007_guard_platform_role.sql`, with one difference —
-- these *are* self-service, so the way through is `set_account_mode()`, which
-- applies the hierarchy and marks its own transaction as allowed.
--
-- The mark is a transaction-local setting. PostgREST exposes no way to set an
-- arbitrary one, so it can only come from a function defined here.

create or replace function public.guard_account_types()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if (new.passenger_enabled is distinct from old.passenger_enabled
      or new.drives_enabled is distinct from old.drives_enabled)
     and coalesce(auth.role(), '') <> 'service_role'
     and coalesce(current_setting('corridor.account_type_change', true), '') <> 'on'
  then
    raise exception 'Account types are changed with set_account_mode(), not directly';
  end if;
  return new;
end;
$fn$;

create trigger profiles_guard_account_types
  before update on public.profiles
  for each row execute function public.guard_account_types();

-- A trigger function, never called over the API. The revoke is not optional:
-- every function created since 20260829000008 defaults back to PUBLIC EXECUTE.
revoke all on function public.guard_account_types() from public;

-- ---------------------------------------------------------------------------
-- set_account_mode — the one way to switch an account type
-- ---------------------------------------------------------------------------

create or replace function public.set_account_mode(p_mode text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user   uuid := auth.uid();
  v_admin  boolean;
  v_member boolean;
  v_owner  boolean;
begin
  if v_user is null then
    raise exception 'Sign in first.';
  end if;

  select coalesce(p.platform_role = 'admin', false) into v_admin
    from public.profiles p where p.id = v_user;
  select exists (select 1 from public.operator_members m where m.user_id = v_user)
    into v_member;
  select exists (select 1 from public.operator_members m where m.user_id = v_user and m.role = 'owner')
    into v_owner;

  if p_mode = 'passenger' then
    -- Downstream of admin or of any role in a business. A plain passenger has
    -- nothing else to be, so switching it off would leave them no account.
    if not (coalesce(v_admin, false) or v_member) then
      raise exception 'Passenger is your only account type, so it stays on.';
    end if;

    perform set_config('corridor.account_type_change', 'on', true);
    update public.profiles set passenger_enabled = p_enabled where id = v_user;

  elsif p_mode = 'driver' then
    if not v_owner then
      raise exception 'Only a business owner can switch on driving for themselves. Drivers are added by their business.';
    end if;

    perform set_config('corridor.account_type_change', 'on', true);
    update public.profiles set drives_enabled = p_enabled where id = v_user;

  else
    raise exception 'Operator and admin access is granted, not switched on.';
  end if;

  perform set_config('corridor.account_type_change', '', true);
end;
$fn$;

revoke all on function public.set_account_mode(text, boolean) from public;
grant execute on function public.set_account_mode(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Joining by invite starts without passenger
-- ---------------------------------------------------------------------------
-- Someone who signs up because a business invited them is joining as its
-- driver or staff. They switch passenger on in Profile if they also ride.
-- Unchanged otherwise from 20260830000019 — including the trigger name, whose
-- alphabetical order after `on_auth_user_created` signup depends on.

create or replace function public.accept_pending_invites()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_joined integer;
begin
  if new.email is null then
    return new;
  end if;

  insert into public.operator_members (operator_id, user_id, role)
  select invite.operator_id, new.id, invite.role
    from public.operator_invites as invite
   where invite.accepted_at is null
     and lower(invite.email) = lower(new.email)
  -- Already on that team by another route: take the membership they have
  -- rather than failing the signup.
  on conflict (operator_id, user_id) do nothing;

  get diagnostics v_joined = row_count;

  update public.operator_invites
     set accepted_at = now(),
         accepted_by = new.id
   where accepted_at is null
     and lower(email) = lower(new.email);

  if v_joined > 0 then
    perform set_config('corridor.account_type_change', 'on', true);
    update public.profiles set passenger_enabled = false where id = new.id;
    perform set_config('corridor.account_type_change', '', true);
  end if;

  return new;
end;
$fn$;

revoke all on function public.accept_pending_invites() from public;
