# Postgres functions

The transactional logic lives in Postgres — `request_booking()`, `set_fare()`,
`generate_departures()` — but the definitions are **in `../migrations/`**, not
in this directory.

They have to be. A function is schema, and schema has to replay in order onto a
fresh database. If the canonical copy lived here, `supabase db push` would apply
the migrations and silently skip the functions, and a new environment would come
up missing exactly the pieces that guarantee correctness.

So each function is created (and later replaced) by a numbered migration, and
this file is the signpost:

| Function | Defined in | Does |
|---|---|---|
| `toronto_instant(date, time)` | `20260827000001_initial_schema.sql` | Local wall clock → instant, DST-correct. |
| `is_platform_admin()`, `is_operator_member()`, `has_operator_role()` | `20260827000002_rls_baseline.sql` | RLS helpers. `SECURITY DEFINER`, pinned `search_path`. |
| `handle_new_user()` | `20260827000002_rls_baseline.sql` | Auth trigger — every new user gets a profile row. |
| `guard_operator_status()` | `20260827000002_rls_baseline.sql` | Only a platform admin changes operator status. |
| `attach_operator_owner()` | `20260829000003_operator_setup.sql` | Every operator gets an owner on insert. |
| `operator_is_active()`, `route_operator()`, `departure_operator()`, `is_operator_manager()` | `20260829000003_operator_setup.sql` | RLS lookups. |
| `set_fare()` | `20260829000004_fares_and_departures.sql` | Upsert a fare and write its audit row in one transaction. |
| `generate_departures()` | `20260829000004_fares_and_departures.sql` | Roll the 30-day departure window forward, idempotently. |
| `request_booking()` | `20260829000005_booking.sql` | **The capacity function.** Locks the departure, checks every leg, inserts the hold. |
| `approve_booking()`, `decline_booking()`, `cancel_booking()` | `20260829000005_booking.sql` | Guarded status transitions. |
| `expire_stale_holds()` | `20260829000005_booking.sql` | Cosmetic sweep. Capacity does not depend on it running. |
