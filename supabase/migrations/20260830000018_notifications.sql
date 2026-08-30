-- Corridor — the in-app notification list
--
-- notify() has always been email-only, and email currently reaches exactly one
-- person: the project sends through Resend's sandbox sender, which refuses
-- every recipient but the account owner until a domain is verified. So today a
-- passenger whose seat is approved is told nothing at all, and the operator
-- who approved it has no idea the message went nowhere.
--
-- That is the gap this closes. An approval, a decline, a cancellation and the
-- day-before reminder are now also rows the recipient can read when they next
-- open the site — which works with no sending domain, no SMS provider, and no
-- money spent.
--
-- ---------------------------------------------------------------------------
-- What is deliberately NOT storable here
-- ---------------------------------------------------------------------------
-- The enum below omits `login_code` and `password_reset`, and that omission is
-- load-bearing rather than an oversight.
--
-- Those two carry credentials. Writing a working sign-in code into a table is
-- wrong on its own terms, and pointless besides: their recipient is by
-- definition locked out, so an in-app list is the one place they cannot look.
-- Leaving them out of the type means a mistake in TypeScript fails loudly at
-- the insert instead of quietly filing a credential.

create type public.notification_kind as enum (
  'seat_requested',
  'booking_approved',
  'booking_declined',
  'booking_cancelled',
  'departure_tomorrow',
  'payment_reminder'
);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        public.notification_kind not null,
  subject     text not null,
  body        text not null,
  -- A path within the site, not an absolute URL: the origin is whatever the
  -- reader is already on, and a stored origin is a stored mistake waiting for
  -- the next domain change.
  link        text,
  booking_id  uuid references public.bookings (id) on delete set null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- The inbox query: this person's notifications, newest first.
create index notifications_inbox_idx
  on public.notifications (user_id, created_at desc);

-- The badge query, which runs on every page load, so it gets its own partial
-- index rather than scanning a growing pile of read rows.
create index notifications_unread_idx
  on public.notifications (user_id)
  where read_at is null;

alter table public.notifications enable row level security;

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Read-only to the API, like bookings
-- ---------------------------------------------------------------------------
-- No update policy and no update privilege. RLS governs rows, not columns, so
-- "you may update your own row" is really "you may rewrite every column of
-- it" — including the subject and body of a message an operator sent you.
-- Marking something read is the only change anyone needs, so that is the only
-- change on offer, through a function that can touch nothing else.

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user  uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then
    raise exception 'not signed in';
  end if;

  -- A null id list means "everything unread", which is what the "mark all
  -- read" button sends. Passing ids marks just those.
  update public.notifications
     set read_at = now()
   where user_id = v_user
     and read_at is null
     and (p_ids is null or id = any (p_ids));

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- 20260829000010 revoked default privileges on new tables and 20260829000008
-- revoked EXECUTE from PUBLIC, so both have to be stated.
--
-- anon gets nothing: a signed-out visitor has no notifications and no business
-- discovering that the table exists.

grant select on table public.notifications to authenticated;
grant select, insert, delete on table public.notifications to service_role;

revoke all on function public.mark_notifications_read(uuid[]) from public;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
