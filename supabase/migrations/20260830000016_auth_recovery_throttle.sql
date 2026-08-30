-- Corridor — a rate limit for the forgot-password screen
--
-- /forgot-password mints its codes and links with `auth.admin.generateLink`
-- and delivers them through notify(), so the email is ours end to end. The
-- cost of that control is that the call is an admin call: it goes around
-- GoTrue's own per-address email rate limit. Left alone, an anonymous form on
-- the public internet would send as many emails as anyone cared to ask for, to
-- any address they liked. That is a spam cannon with our sending domain on it.
--
-- So the sends are counted here. Three per address per hour, which is more
-- than a person who has lost their password ever needs and far less than an
-- abuser wants.
--
-- The address is stored as a SHA-256 hash and never in the clear. If this
-- table held real addresses it would be a roster of who has an account, and
-- the recovery flow goes to some length elsewhere to avoid answering that
-- question.

create table public.auth_recovery_requests (
  email_hash    text        not null,
  requested_at  timestamptz not null default now()
);

create index auth_recovery_requests_lookup_idx
  on public.auth_recovery_requests (email_hash, requested_at desc);

alter table public.auth_recovery_requests enable row level security;

-- No policies, and no grant to anon or authenticated. RLS on with no policy
-- denies everything, which is exactly right: nobody signed in has any business
-- reading this, and the only caller is a Server Action holding the secret key.
--
-- 20260829000010 revoked default privileges on new tables, so the service role
-- needs saying out loud. DELETE is granted so the same action can drop rows
-- that have aged out of the window rather than growing the table forever.
grant select, insert, delete on table public.auth_recovery_requests to service_role;
