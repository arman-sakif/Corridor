-- Corridor — invite someone to a team before they have an account
--
-- `addTeamMember` looks the person up by email and refuses if they are not
-- registered: "Nobody signs in with that address yet. Ask them to create an
-- account first, then add them." So onboarding a driver took a phone call, a
-- wait, and a second visit to this screen to finish the job — and if the owner
-- forgot to come back, the driver had an account and no assignments.
--
-- An invite removes the ordering requirement. The owner records who should be
-- on the team whenever they think of it; the membership appears by itself the
-- moment that person signs up.
--
-- ---------------------------------------------------------------------------
-- Why an invite row and not an account
-- ---------------------------------------------------------------------------
-- The obvious alternative is to create the auth user here and send them a link
-- to set a password. It was rejected on three counts:
--
--   * it lets a vetted-but-still-arbitrary operator create accounts for email
--     addresses they do not own, squatting the address so its real owner
--     cannot sign up later;
--   * the link would carry a credential the operator holds on someone else's
--     behalf, and it expires in an hour, which is useless for "I will text
--     this to my driver tonight";
--   * it is more moving parts than the problem needs. Signing up is one screen
--     now.
--
-- So no credential is minted, nothing expires, and the invitee's account is
-- created by the invitee.

create table public.operator_invites (
  id           uuid primary key default gen_random_uuid(),
  operator_id  uuid not null references public.operators (id) on delete cascade,
  -- Stored as given, compared case-insensitively. Addresses are not
  -- case-sensitive in the half that matters, and an owner typing `Sam@` should
  -- not create a second invite alongside `sam@`.
  email        text not null,
  role         public.operator_member_role not null,
  invited_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  accepted_by  uuid references public.profiles (id) on delete set null
);

-- One open invite per address per operator. Accepted ones are left alone, so
-- the same person can be re-invited after being removed from the team.
create unique index operator_invites_open_idx
  on public.operator_invites (operator_id, lower(email))
  where accepted_at is null;

-- The lookup the signup trigger does, on every new account.
create index operator_invites_pending_idx
  on public.operator_invites (lower(email))
  where accepted_at is null;

alter table public.operator_invites enable row level security;

-- Owners only, matching addTeamMember. Staff run the office and the timetable;
-- deciding who else can act for the business is the owner's.
create policy operator_invites_select_owner on public.operator_invites
  for select to authenticated
  using (public.has_operator_role(operator_id, array['owner']::public.operator_member_role[]));

create policy operator_invites_insert_owner on public.operator_invites
  for insert to authenticated
  with check (public.has_operator_role(operator_id, array['owner']::public.operator_member_role[]));

-- Revoking an invite is a delete. There is no update policy: an invite has
-- nothing worth editing, and changing the role means revoking and re-inviting.
create policy operator_invites_delete_owner on public.operator_invites
  for delete to authenticated
  using (public.has_operator_role(operator_id, array['owner']::public.operator_member_role[]));

grant select, insert, delete on table public.operator_invites to authenticated;

-- 20260829000010 revoked default privileges for anon and authenticated, and the
-- service role is expected to reach every table — it is the one that bypasses
-- RLS, and grants.test.ts asserts there is no table it cannot read.
grant select, insert, delete on table public.operator_invites to service_role;

-- ---------------------------------------------------------------------------
-- Redeeming, on signup
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because the person signing up cannot see the invite: they
-- are not a member of that operator yet, which is the whole point.

create or replace function public.accept_pending_invites()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
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

  update public.operator_invites
     set accepted_at = now(),
         accepted_by = new.id
   where accepted_at is null
     and lower(email) = lower(new.email);

  return new;
end;
$fn$;

-- The name matters. Triggers on the same table and timing fire in alphabetical
-- order, and `on_auth_user_created` sorts before
-- `on_auth_user_created_invites` — which is required, because
-- operator_members.user_id references profiles(id) and it is
-- `handle_new_user()` that creates the profile row. Renaming either trigger
-- without checking that order would break signup for every invited user.
-- notifications.test.ts aside, `invites.test.ts` is what would catch it.
create trigger on_auth_user_created_invites
  after insert on auth.users
  for each row execute function public.accept_pending_invites();

-- A trigger function is run by the system and never called over the API, so it
-- gets no grant. The revoke is not optional though: 20260829000008 revoked
-- EXECUTE from PUBLIC as a one-time sweep over the functions that existed
-- *then*, and Postgres still grants EXECUTE to PUBLIC on every function
-- created since. Without this line, `accept_pending_invites()` would be
-- reachable unauthenticated over PostgREST — which grants.test.ts catches, and
-- did.
revoke all on function public.accept_pending_invites() from public;
