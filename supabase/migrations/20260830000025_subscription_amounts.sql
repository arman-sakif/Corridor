-- Corridor — Phase 7: what an operator actually owes, and what they have paid
--
-- `subscriptions` has recorded a plan, a status and a paid-through date since
-- the first migration. What it has never recorded is an amount. There is no
-- price anywhere in this product — not in the database, not in the code, not
-- on the sales page — so the platform could not say what a business owes, and
-- the operator-facing view had nothing to show.
--
-- It also had no history. `saveSubscription` finds the newest row and
-- overwrites it, so every payment recorded destroys the record of the last
-- one. That is the wrong shape for the one table whose job is being an audit
-- trail of money.
--
-- Two changes, then. An amount on the subscription — per operator, because the
-- first few customers of anything are signed one at a time and a founding
-- discount should not need a code change — and a ledger beside it.

alter table public.subscriptions
  add column amount_cents integer not null default 0;

alter table public.subscriptions
  add constraint subscriptions_amount_non_negative check (amount_cents >= 0);

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------
-- One row per e-transfer that lands. Money is collected off-platform, so this
-- is a record of something that already happened rather than a thing that
-- makes anything happen — the same stance the original table comment takes.

create table public.subscription_payments (
  id            uuid primary key default gen_random_uuid(),
  operator_id   uuid not null references public.operators (id) on delete cascade,
  amount_cents  integer not null,
  paid_on       date not null,
  -- What this payment bought. Kept beside the amount rather than only on the
  -- subscription, so the history still reads correctly after the plan changes.
  covers_until  date,
  note          text,
  recorded_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint subscription_payments_amount_non_negative check (amount_cents >= 0)
);

create index subscription_payments_operator_idx
  on public.subscription_payments (operator_id, paid_on desc);

alter table public.subscription_payments enable row level security;

-- An operator reads its own history — it is their money, and "what have I
-- paid you" should never require an email. Any member may look; this is not
-- more sensitive than the subscription row they can already read.
create policy subscription_payments_select_own on public.subscription_payments
  for select to authenticated
  using (public.is_operator_member(operator_id));

-- Only an admin writes one, because only an admin has seen the bank.
create policy subscription_payments_admin_all on public.subscription_payments
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- 20260829000010 revoked default privileges on new tables for anon and
-- authenticated, so both roles have to be named. anon gets nothing: what a
-- business pays Corridor is between Corridor and the business.
--
-- No update or delete for `authenticated` beyond what the admin policy allows,
-- and the policy is the only thing that permits either — a ledger that can be
-- quietly edited is not a ledger.

grant select, insert, update, delete on table public.subscription_payments to authenticated;
grant select, insert, update, delete on table public.subscription_payments to service_role;
