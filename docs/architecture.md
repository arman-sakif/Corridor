# Corridor — Architecture

Corridor is a multi-tenant booking platform for intercity rideshare operators in
Ontario, sold to those operators as a subscription.

We are not a rideshare business. We do not own vehicles, employ drivers, set
prices, or carry passengers. We sell software to small companies that already do
all of that — businesses running fixed daily timetables between Windsor and
Toronto that today take every booking by phone, text, and WhatsApp.

The product is an **aggregator**. One passenger-facing site. A passenger
searches `Toronto → Windsor, Sept 3` and sees every operator's departures that
day side by side, then requests a seat on one.

**The passenger's mental model:** they choose a *company* and a *departure
time*, not a driver or a car. Who drives and which vehicle shows up is the
operator's business, decided late and never shown in the UI. This is closer to
booking a bus than hailing an Uber, and the architecture reflects that.

---

## 1. System shape

Everything is one Next.js codebase. There is no separate API server.

```
   Passenger (phone)      Operator / Driver (laptop, van)      Admin
          │                          │                           │
          └──────────────┬───────────┴───────────────┬───────────┘
                         ▼                           ▼
              Next.js App Router (Vercel)
              ├── Server Components — reads, rendered on the server
              ├── Server Actions    — every mutation, Zod-validated
              ├── Route Handlers    — manifest CSV, daily job, auth callbacks
              └── proxy.ts          — refreshes the session on every request
                         │
                         ▼
              Supabase (Postgres + Auth + RLS)
              ├── tables with RLS on by default
              ├── Postgres functions — transactional logic (RPC)
              └── auth.users ──trigger──▶ profiles
                         │
                         ▼
                 Resend (transactional email)
```

| Layer | Responsibility |
|---|---|
| **Client components** | Display and input only. They never decide a price, a seat count, or a status. |
| **Server Components** | Read data with the caller's session, so RLS applies. |
| **Server Actions** | Every mutation. Parse input with Zod at the boundary, re-derive anything that matters, then write. |
| **Route Handlers** | Non-HTML responses — the manifest CSV, the daily job, the two auth callbacks. |
| **Postgres functions** | Anything that must be atomic. Called via RPC. |
| **RLS** | The backstop. Assume every other layer has a bug. |

The database layer is tested by applying the real migration files to PGlite —
Postgres compiled to WebAssembly — so `request_booking()` under test is the
same function that runs in production. Each call runs in its own transaction
with `set local role` and JWT claims set the way PostgREST sets them, which
makes RLS testable as it actually behaves rather than as it is intended to.
The harness issues no blanket grant, so the tests exercise production's real
privilege set rather than a more permissive one.

What PGlite cannot do is contention: it is a single connection. The row lock in
`request_booking()` is therefore raced separately by `scripts/race-test.mjs`,
which fires simultaneous requests at a live database. It asserts both halves —
that contention is refused, and that passengers on disjoint legs are *not*, since
a lock held too coarsely would pass the first check while silently collapsing
per-leg capacity into per-departure capacity.

Reads have one more rule. Every page, layout, route handler and query module
unwraps a PostgREST result through `rows()`, `one()` or `count()`
(`lib/supabase/rows.ts`), which throw on a refused query. PostgREST answers a
refused query with an error and no data, and `data ?? []` turns that into a
calm empty page — which is exactly how a complaints page told two operators
they had none. A thrown read reaches `app/error.tsx` and the server log
instead. RLS is untouched: it hides rows by returning fewer, never by erroring.

Phase 7 was to add Android and iOS; subscription tracking is built and the
apps are not started. They are the reason business logic stays server-side and
in the database: the mobile apps re-use it rather than reimplementing it.

---

## 2. Module boundaries

```
app/
  (public)/      search, departure detail, operator profiles, sign in and up,
                 the "Log in as" picker, recovery
  (passenger)/   my rides and history, booking detail, the local ride,
                 notifications, profile, reports, feedback
  (operator)/    setup, requests and history, departures, fleet, team, zones,
                 in-city requests, complaints, billing
  (driver)/      trips, manifest
  (admin)/       operator vetting, cities, subscriptions, complaints, feedback
  api/           manifest CSV export, the daily housekeeping job
  auth/          PKCE callback and token-hash confirm
components/      presentational primitives and shared form plumbing
lib/
  supabase/      clients (request-scoped, browser, service-role), types,
                 rows()/one()/count()
  auth/          session, account types, sign-in, recovery
  booking/       fares, capacity, seat map, ride lists, search, booking and
                 departure-day actions
  operator/      setup actions
  incity/        the in-city add-on — isolated
  notifications/ the in-app list
  reports/       complaints and feedback
  validation/    zod schemas
  notify.ts      the one seam every notification goes through
proxy.ts         Next 16's middleware — session refresh
supabase/
  migrations/    numbered SQL — schema, RLS, and every Postgres function
  tests/         the migrations, run against a real Postgres
```

**Postgres functions live in `migrations/`, not in `functions/`.** A function
is schema, and schema has to replay in order onto a fresh database. If the
canonical copy lived elsewhere, `supabase db push` would apply the migrations
and silently skip the functions, and a new environment would come up missing
exactly the pieces that guarantee correctness. `supabase/functions/README.md`
is the index of which migration defines what.

Two rules about these boundaries:

- **`lib/incity` is isolated.** Nothing in the intercity path imports from it.
  In-city is an add-on with its own approval; it must be removable without
  touching the core booking flow.
- **`lib/booking` owns fare interpretation.** `pricing_mode` is read in exactly
  one place. No other module decides what a segment costs.

---

## 3. Domain model

The vocabulary is fixed. Use these words in code, tables, and UI; do not invent
synonyms.

| Term | Meaning |
|---|---|
| **Operator** | A rideshare business on the platform (`intercity` or `incity`). |
| **City** | Global, admin-managed. Search happens at this level. |
| **Stop** | A physical pickup/dropoff point in a city, defined *by an operator*. Booking happens at this level. An operator may have several in one city — Yorkdale and Pearson are both Toronto — and `is_airport` marks the ones that carry the airport fee. |
| **Route** | An operator's ordered corridor of stops, in one direction. |
| **Leg** | The span between two *consecutive* stops. A 5-stop route has 4 legs. |
| **Segment** | Any bookable pair of stops. A 5-stop route has 10 forward segments. Passengers book segments; capacity is consumed on legs. |
| **Schedule** | A recurring departure: route + time + days of week + max seats. |
| **Departure** | One concrete instance of a schedule on one date. What a passenger books onto. |
| **Booking** | One passenger's seats on one departure, from one stop to another. |
| **Hold** | A booking awaiting operator approval. Occupies capacity. Expires in 1 hour. |
| **Boarding** | One sellable stop-pair on a departure for a searched city pair. Several may exist for the same journey, priced independently. |
| **Manifest** | The passenger list for one vehicle on one departure. |
| **Red flag** | An operator's negative mark on a passenger after a trip. Platform-wide, never shown to the passenger. Raised by a manager or by the driver who was on the trip. |
| **Rating** | 1–5 in both directions. A passenger's rating of an operator is public. An operator's rating of a passenger is seen only as an average at approval time, and never by that passenger. |
| **Zone** | A named area an `incity` operator drops off in, at one flat price. A name and a number — no geography. |
| **Local ride** | An in-city add-on to a confirmed intercity booking: pickup point → zone, approved separately by the in-city operator. |
| **Report** | A passenger's complaint about a *trip*, never a person. Reaches the operator and a platform admin; either closes it. |
| **Feedback** | Product feedback from anyone signed in. Admins only. |
| **Notification** | An in-app row plus an email. Credentials are emailed and never filed. |
| **Account type** | Which hat a signed-in person is wearing: passenger, driver, operator or admin. See §6. |

The full schema is in [`supabase/migrations`](../supabase/migrations). A few
shape decisions worth stating outright:

- **A route is one direction.** `fares.to_seq > from_seq` is enforced, so the
  return trip is a separate route with its own stops and fares. That is what
  makes Toronto→London and London→Toronto independently priced.
- **`departures.max_seats` is snapshotted** from the schedule at generation
  time. Editing a schedule must never change the capacity of a departure that
  has already been sold.
- **`departure_vehicles` is many-per-departure.** That is how a 12-passenger
  departure splits across two vans. Assignment is late-bound.
- **No coordinates anywhere.** Stops are a fixed operator-defined list, and
  in-city uses flat-priced zones. There is no map or geocoding in the MVP.
- **`departures.route_id` is ON DELETE RESTRICT**, deliberately: a route with
  sold departures must not be deletable, or an operator tidying up their routes
  would take paid bookings with them. The same guard sits on
  `bookings.from_stop_id` and `departure_vehicles.vehicle_id`. Anything that
  removes an operator has to unwind child-first rather than lean on the
  cascade — `scripts/seed.mjs` shows the order.

---

## 4. The four invariants

Most of this app is CRUD. These four are where it can silently break.

### 4.1 Capacity is per leg, not per departure

A departure with `max_seats = 16` can hold more than 16 bookings, as long as no
single leg carries more than 16. Windsor→London and London→Yorkdale can occupy
the same physical seat.

For a booking spanning sequence `a` → `b`:

```
for every leg i in [a, b-1]:
    seats_taken(i) + requested_seats <= max_seats
```

where `seats_taken(i)` sums bookings on that departure with
`from_seq <= i AND to_seq >= i+1` that still count (§4.2).

```
   seq:     1 ────── 2 ────── 3 ────── 4
            Windsor  Chatham  London   Yorkdale
   legs:        L1       L2       L3

   booking A (1→3, 2 seats)   ██████████
   booking B (3→4, 1 seat)                  █████
   booking C (2→4, 1 seat)             ███████████

   load:        2        3        2      (max_seats = 16 → all fit)
```

`from_seq` and `to_seq` are **denormalized onto the booking row** so this scan
never joins back through `route_stops`.

**The check and the insert are one atomic operation.** Two passengers taking the
last seat at the same instant must not both succeed. `request_booking()` locks
the departure row with `SELECT … FOR UPDATE`, computes per-leg usage, rejects if
any leg would exceed `max_seats`, then inserts with status `held`.

Never implement this check in TypeScript. A read-then-write in application code
is a race and will oversell seats.

### 4.2 Holds expire in an hour, without a cron

A request is `held` immediately and occupies capacity. The operator has one hour
to approve or decline.

```
hold_expires_at = least(now() + interval '1 hour', departure_datetime)
```

The capacity query excludes expired holds **inline**:

```sql
where status in ('approved', 'completed', 'settled')
   or (status = 'held' and hold_expires_at > now())
```

This makes capacity self-healing: a seat frees itself the instant its hold
lapses. A scheduled job may later flip stale rows to `expired` for display, but
**correctness never depends on that job running.**

### 4.3 Fares are operator-defined, in two modes

`routes.pricing_mode` is one of:

- **`matrix`** (default) — each segment priced explicitly. Toronto→London $35,
  London→Windsor $30, Toronto→Windsor $45. Note the last is *not* the sum. This
  is how these businesses actually price.
- **`additive`** — each consecutive leg is priced, and a segment costs the sum
  of the legs it spans. $35 + $30 means Toronto→Windsor is $65.

Surcharges are fixed amounts set by the operator: per luggage item beyond a
per-seat free allowance, and a flat fee when either end of the trip is a stop
marked `is_airport`. Cash and e-transfer are the same price, and nothing in the
model can make them differ.

Because a city can hold both an ordinary stop and an airport one — Yorkdale and
Pearson are both Toronto — the same search can return two boardings at very
different totals. Search therefore quotes the **all-in** price rather than the
base fare: a card advertising $45 for a journey that costs $105 is worse than a
card with no price on it.

The fare is **always recomputed server-side at booking time** from the
operator's fare rows, and the result is snapshotted onto the booking so later
fare changes never rewrite history. A price sent by the client is ignored.

Fare changes need no approval, but each one writes a `fare_changes` row with a
required reason ("fuel prices", "winter traffic"). Recorded, never enforced.

In the operator UI, explain the two modes with a worked example — never with the
words "matrix" and "additive".

### 4.4 Money and time

- **Money is integer cents.** `4500` is $45.00. No floats, anywhere.
- **All timestamps are `timestamptz`; dates are `date`.** Never naive
  `timestamp`.
- A departure is a `service_date` + `departure_time` in **America/Toronto**, and
  the instant is *derived* via `toronto_instant()`. Ontario observes DST: a 5:00
  AM departure is 5:00 AM local on both sides of the change. The conversion is
  STABLE, not IMMUTABLE, so it cannot live in a generated column — and a
  trigger-maintained copy would go stale when tzdata updates.

---

## 5. Booking lifecycle

```
held ──approve──▶ approved ──trip runs──▶ completed ──both confirm──▶ settled
 │                    │                        │
 ├─ decline ──▶ declined                       └─ no_show
 ├─ 1hr lapse ─▶ expired
 └─ cancel ────▶ cancelled_by_passenger
                      │
                      └─ cancel ─▶ cancelled_by_operator
```

**Approval is manual.** Operators approve or decline every request; there is no
auto-confirmation.

**Cancellation is free and unlimited**, because nothing is prepaid. Every
cancellation is recorded and visible to operators, who may decline service to
repeat offenders.

**Payment happens off-platform, after the trip.** No money moves through us.

1. Trip completes.
2. Passenger: *"How did you pay — cash or e-transfer?"* → `payment_method`,
   `passenger_confirmed_at`.
3. Driver: *"Did you receive payment?"* → `driver_confirmed_at`.
4. Both present → `settled`. Driver says no → a `did_not_pay` red flag.

---

## 6. Roles, access, and trust

| Role | Can do |
|---|---|
| **Passenger** | Search, request a seat, cancel, view rides and history, confirm payment, rate the operator, add a local ride, report a trip, send feedback. |
| **Driver** | See assigned departures, view and download the manifest, mark no-shows, confirm payment received, rate or flag a passenger on a trip they drove. |
| **Operator staff/owner** | Everything for their own operator: stops, routes, fares, schedules, vehicles, team and invites, approve/decline, assign vehicles, view passenger history, rate passengers, raise red flags, complaints, billing. |
| **Platform admin** | Vet and activate operators, manage cities, manage subscriptions, suspend operators, read every complaint and all feedback. |

### Account types

One person has one login. What they *can* be comes from what they are —
`platform_role` for admin, `operator_members` for operator (owner or staff) and
for driver — plus two switches on `profiles`, each only downstream of a role
already held:

- `passenger_enabled` — an admin or any team member may switch it. A plain
  passenger has nothing else to be, so theirs stays on. Invited team members
  start with it off.
- `drives_enabled` — an owner may switch driving on for themselves. Drivers and
  staff are added by the business, never self-made.

Operator and admin are granted, never switched on. Both switches change only
through `set_account_mode()`.

Which type is **active** is a cookie, re-checked against those rules on every
request, so a stale one — an owner who switched driving off, a driver removed
from a team — never holds a door open. Someone with more than one type is asked
*Log in as* at every sign-in; someone with one never sees the picker. The active
type decides the header, the landing page, which sections open (each section's
layout calls `requireMode()`), and the palette: passenger blue, operator
violet, driver amber, admin slate.

It is a view, not a permission. No policy reads it; the database goes on
permitting what the person really is.

Operators are **vetted manually by a platform admin**. Self-serve signup creates
a `pending` operator that is invisible to passengers. Status changes are guarded
by a trigger, so an operator cannot activate or unsuspend itself.

**Access control is layered on purpose:**

1. **RLS** is enabled on every table. A table with RLS on and no policy denies
   everything — that is the correct default, and policies are added deliberately
   per feature. Membership checks are `SECURITY DEFINER` helpers
   (`is_platform_admin`, `is_operator_member`, `has_operator_role`) with a
   pinned `search_path`, because a policy that reads an RLS-protected table
   would otherwise recurse.
2. **Every operator-scoped query also filters by membership explicitly.** A bug
   in one layer must not leak another operator's bookings.
3. **The service-role key is server-only** and never reaches the client bundle.
4. **Four columns are guarded by triggers, not policies.** RLS governs rows, not
   columns, so a user permitted to update their own row is permitted to update
   every column of it. `profiles.platform_role` and `operators.status` are the
   two that must not work that way — self-granted admin and self-vetting
   respectively — and each has a `before update` trigger that refuses the
   change unless it comes from a platform admin or the service role. The
   privilege escalation this closes was live until the database tests caught
   it. `profiles.passenger_enabled` and `drives_enabled` *are* self-service,
   but only within the hierarchy above, so their trigger admits only
   `set_account_mode()`, which marks its own transaction with a local setting
   PostgREST has no way to set.
5. **Functions are granted deliberately.** Postgres grants `EXECUTE` to
   `PUBLIC` by default and Supabase exposes everything in `public` as an RPC
   endpoint, so a new function is internet-reachable the moment it exists.
   `20260829000008_function_grants.sql` revokes that and grants per role;
   `supabase/tests/grants.test.ts` fails the next time one is added without a
   grant.
6. **A policy that needs another table asks a `SECURITY DEFINER` lookup.** A
   policy's subquery runs as the caller with RLS on every table it reads, so a
   join can vanish exactly when it matters — see §10, #16.

**What an operator sees when approving:** passenger name, phone, gender if
given, photo if given, accommodation notes, the free-text request, and platform
history — completed rides, cancellations, no-shows, red flags, and the average
rating operators who carried them have given.

**What a passenger never sees:** the driver, the vehicle, or the assignment.
Operator and time, nothing else. Nor their red flags, nor ratings written about
them — a rater who knows the subject is reading is a less honest rater.

**Manifest download** is CSV (opens cleanly in Excel), generated server-side by
a Route Handler, one file per vehicle per departure: pickup stop, dropoff stop,
passenger name, phone, seats, luggage, fare, payment status, note.

---

## 7. UI stance

Two audiences with opposite needs.

**Passengers** get a calm, mobile-first booking flow. Most arrive on a phone
from a Kijiji link; search to request should take under a minute with no jargon.

**Operators and drivers** get dense, functional dashboards — tables, filters,
fast bulk actions — used daily on a laptop or in a van.

Interface copy is written in plain terms from the user's side of the screen. A
button says what happens when you press it and keeps the same word through the
whole flow: "Request seat" produces "Seat requested." Empty states say what to
do next. Errors say what went wrong and how to fix it.

---

## 8. Build order

Each phase should be usable before the next begins.

| Phase | Scope | State |
|---|---|---|
| **0** | Supabase project, schema, RLS, auth (Google + email/password), profiles, role routing | **built** |
| **1** | Admin: vet and activate operators, manage cities | **built** |
| **2** | Operator setup: stops, routes, fares, schedules, vehicles, drivers | **built** |
| **3** | Departure generation (rolling 30 days) and passenger search | **built** |
| **4** | Booking: the hold, `request_booking()`, approve/decline, cancellation, email | **built** |
| **5** | Departure day: vehicle assignment, driver dashboard, manifest, completion, payment confirmation, ratings, red flags | **built** |
| **6** | In-city add-on: zones, checkout add-on, separate approval | **built** |
| **7** | Subscription tracking, then mobile apps | tracking **built**; mobile not started |

**Phases 0–5 are the MVP** — a complete, sellable product: onboard an operator,
publish a timetable, take real bookings, run the day, settle payment.

### Explicitly not in the MVP

Maps or geocoding of any kind, real-time GPS tracking, in-app payments or
Stripe, door-to-door home pickup, private/whole-vehicle bookings, SMS, a
matching algorithm, driver-posted rides, and multi-operator connecting trips
("ride hopping").

---

## 9. Open decisions

- **Notifications.** Built: `notify()` in `lib/notify.ts` files an in-app row
  and sends an email. In-app is the channel that works today — email uses
  Resend's sandbox sender, which delivers only to the Resend account owner,
  until a domain is verified. A refused or unconfigured send logs the whole
  message. Credentials (`login_code`, `password_reset`) are emailed and never
  filed; the `notification_kind` enum omits them so a slip fails at the insert.
  Because a hold expires in an hour, SMS may prove necessary for approval
  alerts — revisit after the first operator is live. The same SMS provider
  would unlock phone-number sign-in, so decide both together. Adding a channel
  is one implementation inside `notify()`, not a refactor.
- **One phone number, one account.** Built and switched off by
  `ENFORCE_UNIQUE_CONTACT`, so demo accounts can share a number. Turning it on
  for good also wants the unique index sketched at the foot of
  `20260830000017_phone_uniqueness_check.sql`. The rule is one account per
  contact, not one per role: a driver who also rides is one person with two
  account types.
- **Email confirmation at signup is off.** Nothing is prepaid and every booking
  is approved by hand, so an unproven address costs little; a click-this-link
  step is the largest friction before a first booking. Revisit if fake signups
  become real, with Resend as custom SMTP.
- **Search display.** The headline price includes the airport fee. If more
  surcharge types appear, revisit whether one number can stay honest.
- **Departure generation.** Rolling 30-day window, generated by `/api/cron` on
  a daily Vercel schedule, and again whenever an operator saves a timetable
  entry so departures appear immediately. `generate_departures()` is
  idempotent, so a missed run costs nothing. If free-tier scheduling proves
  awkward, the fallback is to generate lazily on the first search for a date.
- **Subscription billing.** A per-operator amount and a payment ledger,
  recorded in-app and collected off-platform by e-transfer. `past_due` warns
  the operator and never cuts them off — that would strand passengers already
  holding confirmed seats. Automate only when operator count justifies it.
- **Licensing and insurance.** Ontario licensing and commercial passenger
  insurance are the operators' responsibility, not the platform's. Worth
  confirming the platform's own exposure as an intermediary before going live.
  Not a blocker for building.

---

## 10. Failure modes to design against

The ten mistakes most likely to be made in this codebase:

1. Treating capacity as per-departure. It is per leg — the single most likely bug.
2. Checking capacity in TypeScript. Race condition; use the locking function.
3. Depending on a cron for hold expiry. Exclude expired holds inline.
4. Assuming fares are additive. `matrix` is the default.
5. Assuming fares are symmetric. A→B and B→A are separate rows.
6. Using the live schedule's `max_seats` for an existing departure. It is snapshotted.
7. Exposing driver or vehicle details to passengers.
8. Building a driver-side "post a ride" flow. Operators publish schedules.
9. Reaching for a maps or geocoding API. No coordinates are needed anywhere.
10. Floats for money. Integer cents.

More, learned the hard way once the schema met a real database:

11. **Assuming an RLS policy protects a column.** It governs rows. A user
    allowed to update their own row can reach every column of it, which is how
    `platform_role` was self-grantable until a trigger closed it.
12. **Adding a Postgres function without a deliberate grant, or granting it to
    the wrong role.** `generate_departures` was granted to `authenticated` but
    called by the cron as `service_role`; the job would have half-failed
    weeks later with departures quietly thinning out.
13. **Trusting `insert … returning` under RLS.** The SELECT policies are checked
    against the new row *before* AFTER triggers fire, so a row whose visibility
    depends on a trigger is invisible at exactly that moment.
14. **Letting PostgREST silently truncate.** A select caps at 1000 rows and an
    RPC the caller cannot execute returns `null` data rather than throwing.
    Both read as an answer.
15. **Unwinding a delete through a RESTRICT.** Removing an operator cannot lean
    on the cascade: the cascade reaches `stops` before `route_stops` is
    cleared, and `route_stops.stop_id`, `departures.route_id` and
    `bookings.passenger_id` all restrict. The order that works is departures →
    schedules → routes → stops → operator → accounts, checking every error —
    `removeOperator()` in `scripts/operator-loop.mjs`. A teardown that ignored
    its errors once left five test businesses on production.
16. **Joining another table inside a policy.** The subquery runs as the caller,
    with RLS on every table it touches. A passenger cannot see a *finished*
    departure, so a rating policy that joined `departures` refused every real
    rating at the exact moment passengers were invited to rate. Ask a
    `SECURITY DEFINER` lookup instead — `departure_operator()`,
    `is_departure_driver()`, `is_departure_passenger()`.
17. **Leaving a PostgREST embed ambiguous.** A table with two foreign keys into
    the same table — `reports`, `ratings` and `operator_invites` into
    `profiles`, `bookings` into `stops` — must name the constraint
    (`profiles!reports_reporter_id_fkey`), or PostgREST refuses the whole
    query. The database tests speak SQL and cannot see this; only opening the
    page can.
18. **Reading `data ?? []`.** Turns #17, a missing grant, or a malformed select
    into a plausible empty page. Use `rows()`, `one()`, `count()`.
19. **Asserting a denied UPDATE rejects.** It does not raise — the rows are
    invisible to it, so it succeeds having changed nothing. Assert the value is
    unchanged. (A denied INSERT does raise.)
20. **Widening a `RETURNS TABLE` with `create or replace`.** Postgres refuses.
    Drop and recreate, and restate the grants the drop took with it.
21. **Using an enum value in the migration that adds it.** `alter type … add
    value` needs its own migration file.
22. **Renaming a trigger on `auth.users`.** They fire alphabetically;
    `on_auth_user_created` must run before `on_auth_user_created_invites`,
    because memberships reference the profile the first one creates.
23. **Authorising on the active account type.** It is a cookie that picks a
    view. RLS and the functions decide what is allowed.
24. **Minting a magic link on a public form.** `generateLink({ type:
    'magiclink' })` creates the user if the address has none — account
    conjuring plus an open mailer. Recovery mints `type: 'recovery'`.
25. **Trusting a third-party call to throw.** `resend.emails.send()` returns
    `{ error }`; `auth.admin.listUsers()` quietly returns only the first 50.
    Check the error, walk the pages.
26. **Seeding a state the product cannot reach.** An empty screen hid a broken
    query for weeks; local rides seeded onto last week's trips showed operators
    passengers nobody could act on. Seed every screen, and seed it plausibly.
