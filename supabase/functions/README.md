# Postgres functions

The transactional logic lives in Postgres — `request_booking()`, `set_fare()`,
`generate_departures()` — but the definitions are **in `../migrations/`**, not
in this directory.

They have to be. A function is schema, and schema has to replay in order onto a
fresh database. If the canonical copy lived here, `supabase db push` would apply
the migrations and silently skip the functions, and a new environment would come
up missing exactly the pieces that guarantee correctness.

So each function is created (and later replaced) by a numbered migration, and
this file is the signpost. **The last migration listed is the live definition.**
Add a row whenever a migration creates or replaces a function — and give every
new one an explicit `revoke all … from public`, because nothing does it for you
(`supabase/tests/grants.test.ts` will fail otherwise).

Grants for the service role were added separately in
`20260829000012_service_role_cron_grants.sql` (`generate_departures`,
`expire_stale_holds`) and `20260829000013_service_role_leg_loads.sql`
(`departure_leg_loads`).

## Time and triggers

| Function | Defined in | Does |
|---|---|---|
| `toronto_instant(date, time)` | `20260827000001_initial_schema.sql` | Local wall clock → instant, DST-correct. STABLE, so it cannot back a generated column. |
| `set_updated_at()` | `20260827000001_initial_schema.sql` | Trigger — stamps `updated_at`. |
| `handle_new_user()` | `20260827000002_rls_baseline.sql`, replaced in `20260830000015_signup_metadata.sql` | Auth trigger — every new user gets a profile row, carrying the name and phone from signup metadata. |
| `accept_pending_invites()` | `20260830000019_operator_invites.sql`, replaced in `20260830000029_account_types.sql` | Auth trigger — attaches memberships an owner recorded before the person signed up, and starts that account without passenger. Must fire after `handle_new_user()`: triggers run alphabetically, so do not rename either. |
| `attach_operator_owner()` | `20260829000003_operator_setup.sql` | Every operator gets an owner on insert. |

## Guards — columns RLS cannot protect

| Function | Defined in | Does |
|---|---|---|
| `guard_operator_status()` | `20260827000002_rls_baseline.sql`, replaced in `20260829000011_bootstrap_admin.sql` | Only a platform admin, the service role or a direct database session changes `operators.status`. |
| `guard_platform_role()` | `20260829000007_guard_platform_role.sql`, replaced in `20260829000011_bootstrap_admin.sql` | The same for `profiles.platform_role`. Closed a live self-grant-admin escalation. |
| `guard_account_types()` | `20260830000029_account_types.sql` | `passenger_enabled` and `drives_enabled` change only through `set_account_mode()`. |

## RLS lookups

`SECURITY DEFINER` with a pinned `search_path`. A policy's subquery runs as the
caller with RLS on every table it reads, so a policy that needs another table
asks one of these rather than joining it.

| Function | Defined in | Does |
|---|---|---|
| `is_platform_admin()`, `is_operator_member()`, `has_operator_role()` | `20260827000002_rls_baseline.sql` | Who the caller is. |
| `operator_is_active()`, `route_operator()`, `departure_operator()`, `is_operator_manager()` | `20260829000003_operator_setup.sql` | Whose row this is, without granting sight of it. |
| `is_departure_driver()` | `20260829000005_booking.sql` | The caller is a driver assigned to this departure. |
| `shares_booking_with_operator()` | `20260829000005_booking.sql` | An operator may read a passenger's profile only while that passenger holds a booking on its departures. |
| `is_departure_passenger()` | `20260830000028_passenger_sees_booked_departures.sql` | A passenger keeps sight of a departure they booked after it has run — never its vehicle or driver. |

## Setup and fares

| Function | Defined in | Does |
|---|---|---|
| `save_route()` | `20260829000004_fares_and_departures.sql` | Replace a route's ordered stop list, dropping fares outside the new range in the same transaction. SECURITY INVOKER. |
| `set_fare()` | `20260829000004_fares_and_departures.sql` | Upsert a fare and write its `fare_changes` audit row in one transaction. |
| `generate_departures()` | `20260829000004_fares_and_departures.sql` | Roll the 30-day departure window forward, idempotently. |

## Booking

| Function | Defined in | Does |
|---|---|---|
| `request_booking()` | `20260829000005_booking.sql`, replaced in `20260829000009_surcharges.sql`, dropped and recreated in `20260920000030_vouchers.sql` | **The capacity function.** Locks the departure, checks every leg, prices server-side with surcharges, spends a voucher code if one was given, inserts the hold. Takes a code, never a price. |
| `quote_booking()` | `20260829000009_surcharges.sql` | The same arithmetic, read-only, for the booking page. A quote that disagrees with the charge is worse than none. |
| `departure_leg_loads()` | `20260829000005_booking.sql` | Seats taken per leg, expired holds excluded inline. |
| `approve_booking()`, `decline_booking()`, `cancel_booking()` | `20260829000005_booking.sql` | Guarded status transitions. |
| `expire_stale_holds()` | `20260829000005_booking.sql` | Cosmetic sweep. Capacity does not depend on it running. |
| `passenger_history()` | `20260829000005_booking.sql`, replaced in `20260829000014_passenger_history_leak.sql`, dropped and recreated in `20260830000026_rate_passenger.sql` | What an operator sees when approving: counts, plus an average rating. Zero rows when the caller has no claim on the passenger. |

## Departure day

| Function | Defined in | Does |
|---|---|---|
| `assign_booking_vehicle()` | `20260829000006_departure_day.sql` | Put a passenger in a van. Deliberately does not enforce the van's seat count. |
| `complete_departure()` | `20260829000006_departure_day.sql` | The trip ran: confirmed bookings → `completed`. Leaves `no_show` alone. |
| `mark_no_show()` | `20260829000006_departure_day.sql` | They did not turn up. |
| `confirm_payment_as_passenger()`, `confirm_payment_as_driver()` | `20260829000006_departure_day.sql` | Two-sided settlement. Both present → `settled`; driver says no → a `did_not_pay` red flag. |
| `rate_passenger()` | `20260830000026_rate_passenger.sql` | The operator side of a rating. Manager or assigned driver; the subject comes from the booking. |
| `raise_red_flag()` | `20260830000024_driver_red_flags.sql` | A mark on a passenger, raiseable by the driver who was actually there. |

## Accounts, notifications, reports

| Function | Defined in | Does |
|---|---|---|
| `normalise_phone()`, `phone_in_use()` | `20260830000017_phone_uniqueness_check.sql` | Digits-only phone comparison, so a duplicate check does not have to select every profile. Service role only. |
| `set_account_mode()` | `20260830000029_account_types.sql` | Switches passenger (or, for an owner, driving) on or off — only downstream of a role the caller already holds. |
| `mark_notifications_read()` | `20260830000018_notifications.sql` | Sets `read_at` on the caller's own notifications and nothing else. The table is read-only to the API. |
| `file_report()`, `resolve_report()` | `20260830000023_reports_and_feedback.sql` | A passenger complains about a trip; the operator or an admin closes it. |

## In-city

| Function | Defined in | Does |
|---|---|---|
| `request_incity_ride()` | `20260830000020_incity.sql` | The local ride. Checks the parent booking, the operator, the zone and the pickup city, then snapshots the zone price. |
| `approve_incity_ride()`, `decline_incity_ride()`, `cancel_incity_ride()` | `20260830000020_incity.sql` | Guarded status transitions for a local ride. |
| `cancel_incity_on_parent()` | `20260830000020_incity.sql` | Trigger — a seat that goes away takes its local ride with it. |

## Promotions and insights

| Function | Defined in | Does |
|---|---|---|
| `resolve_voucher()` | `20260920000030_vouchers.sql`, replaced in `20260920000032_alphanumeric_vouchers.sql`, `20260920000034_voucher_attempt_throttle.sql` and `20260920000035_voucher_throttle_does_not_extend.sql` | The voucher rules, in one place: the code belongs to this operator, is active, unexpired, under its ceiling, and unspent by this passenger. Locks the row when asked to. **Granted to nobody** — both callers are SECURITY DEFINER, and exposing it would be an oracle over every live code. |
| `voucher_discount_cents()` | `20260920000030_vouchers.sql` | Cents off, or a floored percentage of the fare, capped at the fare. IMMUTABLE. Mirrored for display by `lib/promotions/vouchers.ts`. |
| `check_voucher()` | `20260920000030_vouchers.sql`, dropped and recreated in `20260920000034_voucher_attempt_throttle.sql`, replaced in `20260920000035` | What the booking page asks before the passenger commits. Signed in only. **Returns a reason in `error` instead of raising** — a raise rolls the transaction back, and with it the row recording the failed guess. |
| `voucher_attempt_window()`, `voucher_attempt_limit()` | `20260920000034_voucher_attempt_throttle.sql` | Ten guesses an hour, named once so the rule and the tests read the same numbers. |
| `create_voucher()` | `20260920000030_vouchers.sql`, replaced in `20260920000032_alphanumeric_vouchers.sql` | Draws the six characters and computes the expiry from one of four windows. Neither is a value the browser sends. |
| `normalise_voucher_code()` | `20260920000032_alphanumeric_vouchers.sql` | Upper-cases and folds O to 0, I and L to 1, so a code heard down a phone line resolves however it was typed. Granted to nobody — the two callers reach it as the owner. |
| `set_voucher_active()` | `20260920000030_vouchers.sql` | Withdraw a code early, or put it back. Never a delete. |
| `voucher_uses()` | `20260920000030_vouchers.sql` | How far each code has got, counted the way `resolve_voucher()` counts — lapsed holds excluded inline. |
| `operator_insights()` | `20260920000031_insights.sql` | Per weekday: departures, seats offered, seats taken **at the busiest leg**, how many went out full, fares, discounts, and requests that went nowhere. |
