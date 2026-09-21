-- Corridor — a rate limit for guessing at passwords
--
-- GoTrue already refuses too many attempts from one IP: hammering
-- `/auth/v1/token` gets a 429 after a few dozen tries. Two things make that
-- insufficient here, and neither is Supabase's fault.
--
-- **It counts the wrong caller.** Sign-in runs in a Server Action, so the
-- request GoTrue sees comes from the Vercel function, not from the person
-- typing. Every sign-in on the site therefore shares one bucket. That is worse
-- than no limit in one specific way: somebody who wants the site down only has
-- to spend the shared allowance, and everyone else is locked out of their own
-- accounts. The limit becomes the attack.
--
-- **It counts per IP and never per account.** Nothing anywhere counts failures
-- against one address, so spraying a single common password across many
-- accounts from rotating addresses is unthrottled — and that is the attack
-- that actually works against a site this size.
--
-- So failures are counted here, keyed both ways, by a Server Action that can
-- see the real caller. `auth_recovery_requests` is the same idea and this
-- table is deliberately its twin; the difference is that one guards sending
-- email and this one guards guessing.
--
-- ---------------------------------------------------------------------------
-- What is stored, and what is deliberately not
-- ---------------------------------------------------------------------------
-- The subject is a SHA-256 hash, never the address or the IP in the clear. In
-- the clear, this table would be two things we should not keep: a roster of
-- which addresses have been tried, and a log of who was where. Hashed, a row
-- answers "has this same subject failed recently" and nothing else.
--
-- Only failures are recorded, and a success clears the account's rows. Someone
-- who fumbles a password twice and then gets in is not carrying two strikes
-- into tomorrow.

create type public.auth_attempt_kind as enum ('email', 'ip');

create table public.auth_sign_in_attempts (
  kind          public.auth_attempt_kind not null,
  subject_hash  text        not null,
  attempted_at  timestamptz not null default now()
);

create index auth_sign_in_attempts_lookup_idx
  on public.auth_sign_in_attempts (kind, subject_hash, attempted_at desc);

alter table public.auth_sign_in_attempts enable row level security;

-- No policies and no grant to anon or authenticated, exactly as with
-- `auth_recovery_requests`. RLS on with no policy denies everything, which is
-- right: nobody signed in has any business reading this, and the only caller
-- is a Server Action holding the secret key.
--
-- 20260829000010 revoked default privileges on new tables, so the service role
-- needs saying out loud. DELETE is granted so the same action can drop rows
-- that have aged out rather than growing the table forever, and can clear an
-- account's failures when somebody signs in successfully.
grant select, insert, delete on table public.auth_sign_in_attempts to service_role;
