-- Corridor — complaints, and a way to tell the platform anything at all
--
-- Until now a passenger who had a bad trip had exactly one outlet: a 1–5 star
-- rating on the operator's public profile, written once and never read by
-- anybody who could act on it. There was no passenger→operator complaint, and
-- no channel from anyone — passenger, driver or operator — to a platform
-- admin. `profiles`' own edit form tells people to "contact support to change
-- it", and support did not exist.
--
-- Two tables here. A report is about a specific trip and reaches the operator
-- and an admin. Feedback is about the product and reaches admins only.
--
-- ---------------------------------------------------------------------------
-- What a report is about, and what it is not
-- ---------------------------------------------------------------------------
-- A passenger reports the *booking*, never a person. They cannot name a driver
-- because they never saw one: who drives and which vehicle turns up is the
-- operator's business, decided late and never shown. The operator and the
-- admin can look up the assignment from the booking, because they may.
--
-- The other direction already exists and is not duplicated here. An operator's
-- mark on a passenger is a `red_flag`, shown to the next operator at approval
-- time — a quiet signal between businesses rather than an escalation. The next
-- migration lets the driver who was actually in the van raise one.

create type public.report_category as enum (
  'driving',
  'lateness',
  'vehicle',
  'conduct',
  'overcharged',
  'safety',
  'other'
);

create type public.report_status as enum ('open', 'resolved');

create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings (id) on delete cascade,
  -- Denormalised from the booking's departure, so neither the policies below
  -- nor the operator's queue has to join back through departures to work out
  -- whose complaint this is. The function resolves it; the caller cannot set
  -- it.
  operator_id  uuid not null references public.operators (id) on delete cascade,
  reporter_id  uuid not null references public.profiles (id) on delete cascade,
  category     public.report_category not null,
  note         text not null,
  status       public.report_status not null default 'open',
  resolution   text,
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

-- The operator's queue and the admin's queue: open ones first, newest first.
create index reports_operator_idx on public.reports (operator_id, status, created_at desc);
create index reports_open_idx     on public.reports (status, created_at desc);
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);

alter table public.reports enable row level security;

create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter_id = auth.uid());

create policy reports_select_operator on public.reports
  for select to authenticated
  using (public.is_operator_member(operator_id));

create policy reports_select_admin on public.reports
  for select to authenticated
  using (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Read-only to the API, like bookings and notifications
-- ---------------------------------------------------------------------------
-- No insert, update or delete policy and no such privilege. RLS governs rows
-- and not columns, so an update policy scoped to "rows you can see" would let
-- a passenger flip their own complaint to resolved, and let an operator
-- rewrite the complaint made against it. Both writes are functions that can
-- touch one thing each.

create or replace function public.file_report(
  p_booking_id uuid,
  p_category   public.report_category,
  p_note       text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_reporter uuid := auth.uid();
  v_booking  record;
  v_id       uuid;
begin
  if v_reporter is null then
    raise exception 'You need to be signed in to report a trip.';
  end if;

  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'Tell us what happened.';
  end if;

  select b.id, b.passenger_id, b.status, d.operator_id
    into v_booking
    from public.bookings b
    join public.departures d on d.id = b.departure_id
   where b.id = p_booking_id;

  if not found then
    raise exception 'That booking no longer exists.';
  end if;

  if v_booking.passenger_id <> v_reporter then
    raise exception 'That booking is not yours to report.';
  end if;

  -- Something has to have happened. A held or declined request has no trip to
  -- complain about, and a complaint about a seat nobody sat in is a support
  -- question rather than a report.
  if v_booking.status not in ('approved', 'completed', 'settled', 'no_show') then
    raise exception 'You can report a trip once it has been confirmed.';
  end if;

  insert into public.reports (booking_id, operator_id, reporter_id, category, note)
  values (p_booking_id, v_booking.operator_id, v_reporter, p_category, btrim(p_note))
  returning id into v_id;

  return v_id;
end;
$fn$;

-- Either the operator complained about or a platform admin may close one. A
-- complaint about a driver is mostly the operator's to put right; the admin is
-- the backstop for when it is the operator that is the problem.
create or replace function public.resolve_report(p_id uuid, p_resolution text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_operator uuid;
  v_status   public.report_status;
begin
  select operator_id, status into v_operator, v_status
    from public.reports
   where id = p_id;

  if v_operator is null then
    raise exception 'That report no longer exists.';
  end if;

  if not (public.is_operator_manager(v_operator) or public.is_platform_admin()) then
    raise exception 'That report is not yours to close.';
  end if;

  if v_status <> 'open' then
    raise exception 'That report has already been closed.';
  end if;

  update public.reports
     set status      = 'resolved',
         resolution  = nullif(btrim(coalesce(p_resolution, '')), ''),
         resolved_at = now(),
         resolved_by = auth.uid()
   where id = p_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Feedback
-- ---------------------------------------------------------------------------
-- Not about a trip and not about anybody — "the search should remember my last
-- journey", "I could not find the cancel button". Anyone signed in may send
-- one; only a platform admin reads them.
--
-- A plain insert policy rather than a function, because there is nothing to
-- guard beyond who is writing: the row is theirs, the columns are theirs, and
-- there is no state anyone else can be misled by.

create type public.feedback_kind as enum ('idea', 'problem', 'praise', 'other');

create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        public.feedback_kind not null,
  message     text not null,
  created_at  timestamptz not null default now()
);

create index feedback_recent_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;

create policy feedback_insert_own on public.feedback
  for insert to authenticated
  with check (user_id = auth.uid());

create policy feedback_select_own on public.feedback
  for select to authenticated
  using (user_id = auth.uid());

create policy feedback_select_admin on public.feedback
  for select to authenticated
  using (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- 20260829000010 revoked default privileges on new tables for anon and
-- authenticated; 20260829000008 revoked EXECUTE from PUBLIC as a one-time
-- sweep, so every function written since defaults back to PUBLIC EXECUTE.
-- Both have to be restated, every time.
--
-- anon gets nothing on either table. A complaint names a passenger and a trip,
-- and feedback names its author.

grant select on table public.reports to authenticated;
grant select, insert, update, delete on table public.reports to service_role;

grant select, insert on table public.feedback to authenticated;
grant select, insert, update, delete on table public.feedback to service_role;

revoke all on function public.file_report(uuid, public.report_category, text) from public;
revoke all on function public.resolve_report(uuid, text) from public;

grant execute on function public.file_report(uuid, public.report_category, text) to authenticated;
grant execute on function public.resolve_report(uuid, text) to authenticated;
