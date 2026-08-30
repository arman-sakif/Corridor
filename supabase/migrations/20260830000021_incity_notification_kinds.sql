-- Corridor — notification kinds for the in-city add-on
--
-- Separate from 20260830000020 on purpose. `alter type … add value` is allowed
-- inside a transaction from Postgres 12, but the new value cannot be *used* in
-- the same transaction — and each migration runs in one. Keeping the additions
-- in their own file means the next migration that wants to write one of these
-- is free to, and nobody has to remember the rule.
--
-- These are the three moments a person needs telling about: the operator that a
-- ride has been asked for, and the passenger that it was taken or refused.
-- In-city has no settlement or rating in this phase, so there is nothing else
-- to say yet.

alter type public.notification_kind add value if not exists 'incity_requested';
alter type public.notification_kind add value if not exists 'incity_approved';
alter type public.notification_kind add value if not exists 'incity_declined';
