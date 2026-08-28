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
              └── Route Handlers    — manifest CSV, webhooks
                         │
                         ▼
              Supabase (Postgres + Auth + RLS + Storage)
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
| **Route Handlers** | Non-HTML responses — the manifest CSV, later webhooks. |
| **Postgres functions** | Anything that must be atomic. Called via RPC. |
| **RLS** | The backstop. Assume every other layer has a bug. |

Phase 7 adds Android and iOS. That is the reason business logic stays
server-side and in the database: the mobile apps re-use it rather than
reimplementing it.

---

## 2. Module boundaries

```
app/
  (public)/      search, departure detail, operator profiles
  (passenger)/   my rides, booking detail, ratings
  (operator)/    setup, bookings queue, departures, fleet
  (driver)/      today, manifest
  (admin)/       operator vetting, cities, subscriptions
  api/           route handlers (manifest CSV export, webhooks)
lib/
  supabase/      client, server client, generated types
  booking/       fare calculation, capacity rules, status transitions
  operator/      routes, schedules, departure generation
  incity/        Phase 6 — isolated
  validation/    zod schemas
supabase/
  migrations/    numbered SQL migrations
  functions/     Postgres functions (request_booking, etc.)
```

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
| **Stop** | A physical pickup/dropoff point in a city, defined *by an operator*. Booking happens at this level. |
| **Route** | An operator's ordered corridor of stops, in one direction. |
| **Leg** | The span between two *consecutive* stops. A 5-stop route has 4 legs. |
| **Segment** | Any bookable pair of stops. A 5-stop route has 10 forward segments. Passengers book segments; capacity is consumed on legs. |
| **Schedule** | A recurring departure: route + time + days of week + max seats. |
| **Departure** | One concrete instance of a schedule on one date. What a passenger books onto. |
| **Booking** | One passenger's seats on one departure, from one stop to another. |
| **Hold** | A booking awaiting operator approval. Occupies capacity. Expires in 1 hour. |
| **Manifest** | The passenger list for one vehicle on one departure. |
| **Red flag** | An operator's negative mark on a passenger after a trip. |

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

Surcharges are fixed amounts set by the operator: per luggage item over the free
allowance, and a flat airport fee. Cash and e-transfer are the same price.

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
| **Passenger** | Search, request a seat, cancel, view rides, confirm payment, rate the operator. |
| **Driver** | See assigned departures, view and download the manifest, mark no-shows, confirm payment received. |
| **Operator staff/owner** | Everything for their own operator: stops, routes, fares, schedules, vehicles, drivers, approve/decline, assign vehicles, view passenger history, raise red flags. |
| **Platform admin** | Vet and activate operators, manage cities, manage subscriptions, suspend operators. |

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

**What an operator sees when approving:** passenger name, phone, gender if
given, photo if given, accommodation notes, the free-text request, and platform
history — completed rides, cancellations, red flags.

**What a passenger never sees:** the driver, the vehicle, or the assignment.
Operator and time, nothing else.

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
| **0** | Supabase project, schema, RLS, auth (Google + email/password), profiles, role routing | schema and RLS baseline written |
| **1** | Admin: vet and activate operators, manage cities | not started |
| **2** | Operator setup: stops, routes, fares, schedules, vehicles, drivers | not started |
| **3** | Departure generation (rolling 30 days) and passenger search | not started |
| **4** | Booking: the hold, `request_booking()`, approve/decline, cancellation, email | not started |
| **5** | Departure day: vehicle assignment, driver dashboard, manifest, completion, payment confirmation, ratings, red flags | not started |
| **6** | In-city add-on: zones, checkout add-on, separate approval | tables only |
| **7** | Subscription tracking, then mobile apps | tables only |

**Phases 0–5 are the MVP** — a complete, sellable product: onboard an operator,
publish a timetable, take real bookings, run the day, settle payment.

### Explicitly not in the MVP

Maps or geocoding of any kind, real-time GPS tracking, in-app payments or
Stripe, door-to-door home pickup, private/whole-vehicle bookings, SMS, a
matching algorithm, driver-posted rides, and multi-operator connecting trips
("ride hopping").

---

## 9. Open decisions

- **Notifications.** MVP is email (Resend) plus an in-app list. Because a hold
  expires in an hour, SMS may prove necessary for approval alerts — revisit
  after the first operator is live. Build behind a small `notify()` abstraction
  so adding a channel is one implementation, not a refactor. No notifications
  table exists yet.
- **Departure generation.** Rolling 30-day window from a scheduled job. If
  free-tier scheduling proves awkward, generate lazily on first search for a
  date instead.
- **Subscription billing.** Recorded in-app, collected off-platform by
  e-transfer at launch. Automate only when operator count justifies it.
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
