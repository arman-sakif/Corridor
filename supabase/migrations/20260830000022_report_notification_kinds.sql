-- Corridor — notification kinds for complaints and feedback
--
-- Its own file, for the reason 20260830000021 records: `alter type … add
-- value` may run inside a transaction from Postgres 12, but the new value
-- cannot be *used* in that same transaction — and each migration is one. The
-- next migration files reports and feedback, and needs these to already exist.
--
-- `report_filed` goes to two audiences at once: the operator being complained
-- about, who has to fix it, and a platform admin, who has to know it happened.
-- `report_resolved` closes the loop with the person who complained, because a
-- complaint that vanishes is worse than no complaint box at all.

alter type public.notification_kind add value if not exists 'report_filed';
alter type public.notification_kind add value if not exists 'report_resolved';
alter type public.notification_kind add value if not exists 'feedback_filed';
