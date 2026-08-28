# CLAUDE.md

Project guidance for Claude Code. Read this before writing any code.

---

## 1. What this is

A **multi-tenant booking platform for intercity rideshare operators in Ontario**, sold as a subscription to the operators.

We are **not** a rideshare business. We do not own vehicles, employ drivers, set prices, or carry passengers. We sell software to small businesses that already do all of that — companies like Harbour Line and Applicant Rides, who today run fixed daily timetables between Windsor and Toronto and take every booking by phone, text, and WhatsApp, advertised on Kijiji.

The product replaces that with a real booking system.

**It is an aggregator.** One passenger-facing site. A passenger searches `Toronto → Windsor, Sept 3` and sees every operator's departures that day side by side, then requests a seat on one.

### The passenger's mental model

A passenger does **not** choose a driver or a car. They choose a **company** and a **departure time**. Who drives and what vehicle shows up is entirely the operator's business, decided late and never exposed in the UI. The passenger picks "Harbour, 9:00 AM, Yorkdale → Windsor, $45" and can attach a short free-text request like *"female, front seat preferred"*.

This is closer to booking a bus than hailing an Uber. Build it that way.

---

## 2. Domain glossary

Use these exact terms in code, tables, and UI. Do not invent synonyms.

| Term | Meaning |
|---|---|
| **Operator** | A rideshare business on the platform. Two kinds: `intercity` and `incity`. |
| **City** | Global, admin-managed. Toronto, Mississauga, London, Chatham, Windsor. Search happens at this level. |
| **Stop** | A specific physical pickup/dropoff point belonging to a city, defined **by an operator**. "Yorkdale Mall — Shoppers Drug Mart entrance". Booking happens at this level. |
| **Route** | An operator's ordered corridor of stops. e.g. Windsor → Chatham → London → Mississauga → Yorkdale. |
| **Leg** | The span between two *consecutive* stops on a route. A 5-stop route has 4 legs. |
| **Segment** | Any bookable pair of stops (from → to). A 5-stop route has 10 forward segments. Passengers book segments; capacity is consumed on legs. |
| **Schedule** | A recurring departure. Route + time of day + days of week + max seats. |
| **Departure** | One concrete instance of a schedule on one date. This is what a passenger books onto. |
| **Booking** | One passenger's seats on one departure, from one stop to another. |
| **Hold** | A booking awaiting operator approval. Occupies capacity. Expires in 1 hour. |
| **Manifest** | The passenger list for one vehicle on one departure. Drivers download it. |
| **Red flag** | An operator's negative mark on a passenger after a trip. |

---

## 3. Stack

- **Next.js (App Router) + TypeScript** — frontend and backend in one codebase. Server Actions and Route Handlers *are* the backend. No separate API server.
- **Supabase** — Postgres, Auth, Row Level Security, Storage. Free tier.
- **Vercel** — hosting.
- **Tailwind CSS** for styling.
- **Zod** for all input validation.
- **`@supabase/supabase-js`** with generated types. **No ORM.** Complex/transactional logic lives in Postgres functions called via RPC.
- **Resend** for transactional email.

Phase 7 adds Android + iOS. Keep all business logic server-side so the mobile apps can reuse it.

### Not in the MVP — do not build these

Maps or geocoding of any kind, real-time GPS tracking, in-app payments or Stripe, door-to-door home pickup, private/whole-vehicle bookings, SMS, a matching algorithm, driver-posted rides, multi-operator connecting trips ("ride hopping").

---

## 4. The four hard rules

Most of this app is CRUD. These four things are where it can silently break. Get them right.

### 4.1 Per-leg capacity

Seats are consumed **per leg, not per departure**. A departure with `max_seats = 16` can hold more than 16 bookings total, as long as no single leg carries more than 16.

Windsor → London and London → Yorkdale can occupy the same physical seat.

The rule, for a booking spanning stop sequence `a` to `b`:

```
for every leg i in [a, b-1]:
    seats_taken(i) + requested_seats <= max_seats
```

where `seats_taken(i)` sums all bookings on that departure where `from_seq <= i AND to_seq >= i+1` and the booking still counts (see 4.2).

**Store `from_seq` and `to_seq` denormalized on the booking row.** Do not join back through route_stops to figure out sequence at query time.

**This check and the insert must be atomic.** Two passengers requesting the last seat simultaneously must not both succeed. Implement it as a Postgres function that does `SELECT ... FOR UPDATE` on the departure row before checking, then inserts. Call it via RPC.

```
create function request_booking(...) returns ...
-- 1. lock the departure row
-- 2. compute per-leg usage
-- 3. reject if any leg would exceed max_seats
-- 4. insert booking with status 'held'
```

**Never implement the capacity check in TypeScript.** A read-then-write in application code is a race condition and will oversell seats.

### 4.2 Holds expire in one hour, without a cron

A booking request is `held` immediately and occupies capacity. The operator has 1 hour to approve or decline.

```
hold_expires_at = least(now() + interval '1 hour', departure_datetime)
```

The capacity query must **exclude expired holds inline**:

```sql
where status in ('approved', 'completed', 'settled')
   or (status = 'held' and hold_expires_at > now())
```

This makes capacity self-healing. A seat frees itself the instant its hold lapses, whether or not any background job has run. A scheduled job may later flip stale rows to `expired` for display purposes, but **correctness must never depend on that job running.**

### 4.3 Fares are operator-defined, in two modes

We do not fix prices, legs, or corridors. Operators define everything. A route stores `pricing_mode`:

- **`matrix`** — the operator prices each segment explicitly. Toronto→London $35, London→Windsor $30, Toronto→Windsor $45. Note that Toronto→Windsor is *not* the sum. This is how these businesses actually price, and it's the default.
- **`additive`** — the operator prices each consecutive leg, and any segment's fare is the sum of the legs it spans. Toronto→London $35 + London→Windsor $30 means Toronto→Windsor is $65.

In the operator UI, explain these with a concrete worked example rather than the words "matrix" and "additive."

Directional fares are independent. Toronto→London and London→Toronto are separate rows and may differ.

Surcharges are **fixed amounts** set by the operator: per luggage item over the free allowance, and a flat airport fee. Cash and e-transfer are the **same price**.

**Always recompute the fare server-side at booking time from the operator's fare rows. Never trust a price sent by the client.** Snapshot the computed total onto the booking so later fare changes don't rewrite history.

Operators may change fares without approval, but every change writes a row to `fare_changes` with a required reason ("fuel prices", "winter traffic"). This is recorded, never enforced.

### 4.4 Money and time

- **Money is integer cents.** `4500` is $45.00. Never use floats for money anywhere.
- **All timestamps are `timestamptz`.** A departure is stored as a `service_date` (date) plus a `departure_time` (time), both in **America/Toronto**, and the absolute instant is derived. Do not store naive local datetimes. Ontario observes DST and a 5:00 AM departure is 5:00 AM local on both sides of the change.

---

## 5. Data model

Full SQL lives in `supabase/migrations/`. Shape and intent:

**Identity**
- `profiles` — extends `auth.users`. Full name, phone, optional gender, optional photo, optional accommodation notes. Signup asks for nothing; profile is completed after.
- `platform_role` — `admin` or `null`. Platform admins vet operators.

**Operators**
- `operators` — business name, `type` (`intercity` | `incity`), bio, public phone, `status` (`pending` | `active` | `suspended`).
- `operator_members` — user ↔ operator with role `owner` | `staff` | `driver`. A user can belong to more than one operator.
- `subscriptions` — plan (`weekly` | `monthly`), status, current period end. Payment is collected **off-platform** in the MVP; this table only records state.

**Routes and fares**
- `cities` — global, admin-managed.
- `stops` — operator-owned, belongs to a city, has a label and description.
- `routes` — operator-owned, named, has `pricing_mode`.
- `route_stops` — route + stop + `seq` (1-based, ordered).
- `fares` — route + `from_seq` + `to_seq` + `price_cents`. Under `additive`, only consecutive pairs are stored and segment prices are summed at read time.
- `fare_changes` — audit log with mandatory `reason`.

**Operations**
- `schedules` — route, `departure_time`, `days_of_week` (int array, 0–6), `max_seats`, active date range.
- `departures` — schedule (nullable, so one-off extra departures are possible), `service_date`, `departure_time`, `max_seats` (**snapshotted**, so changing a schedule never alters departures already sold), status.
- `vehicles` — operator-owned. Label, seat count.
- `departure_vehicles` — vehicle + driver assigned to a departure. **One departure can have many.** This is how a 12-passenger departure splits across two vans. Assignment is late-bound and entirely the operator's call.

**Bookings**
- `bookings` — departure, passenger, `from_stop_id`/`to_stop_id`, `from_seq`/`to_seq`, seats, status, `hold_expires_at`, fare breakdown (`base_cents`, `luggage_cents`, `airport_cents`, `total_cents`), passenger note, `assigned_vehicle_id` (nullable until the operator allocates), `payment_method`, `passenger_confirmed_at`, `driver_confirmed_at`.

**Reputation**
- `ratings` — both directions: passenger rates operator, operator rates passenger.
- `red_flags` — booking + passenger + `reason` enum (`no_show`, `did_not_pay`, `haggled`, `too_loud`, `messy`, `smelly`, `other`) + note.

**In-city (Phase 6, tables from day one)**
- `incity_zones` — operator, zone name, `flat_price_cents`.
- `incity_bookings` — links to the parent intercity booking, pickup stop, zone, destination address, price, status, own approval.

---

## 6. Booking lifecycle

```
held ──approve──▶ approved ──trip runs──▶ completed ──both confirm──▶ settled
 │                    │                        │
 ├─ decline ──▶ declined                       └─ no_show
 ├─ 1hr lapse ─▶ expired
 └─ cancel ────▶ cancelled_by_passenger
                      │
                      └─ cancel ─▶ cancelled_by_operator
```

**Approval is manual.** Operators approve or decline every request. There is no auto-confirmation.

**Cancellation is free and unlimited**, because nothing is prepaid. But every cancellation is recorded and visible to operators, who may decline service to repeat offenders.

**Payment happens off-platform, after the trip.** No money moves through us.

1. Trip completes.
2. Passenger is prompted: *"How did you pay — cash or e-transfer?"* → writes `payment_method` and `passenger_confirmed_at`.
3. Driver is prompted: *"Did you receive payment?"* → writes `driver_confirmed_at`.
4. Both present → `settled`. Driver says no → raises a `did_not_pay` red flag.

---

## 7. Roles and surfaces

| Role | Can do |
|---|---|
| **Passenger** | Search, request a seat, cancel, view their rides, confirm payment, rate the operator. |
| **Driver** | See their assigned departures, view and **download the manifest**, mark no-shows, confirm payment received. |
| **Operator staff/owner** | Everything for their own operator: stops, routes, fares, schedules, vehicles, drivers, approve/decline bookings, assign vehicles, view passenger history, raise red flags. |
| **Platform admin** | Vet and activate operators, manage the city list, manage subscriptions, suspend operators. |

Operators are **vetted manually by a platform admin** before appearing in search. Self-serve signup creates a `pending` operator that is invisible to passengers.

**Manifest download** is CSV (opens cleanly in Excel), generated server-side by a Route Handler, one file per vehicle per departure. Columns: pickup stop, dropoff stop, passenger name, phone, seats, luggage, fare, payment status, note.

**What an operator sees when approving:** passenger name, phone, gender if given, photo if given, accommodation notes, the free-text request, plus their platform history — completed rides, cancellations, and red flags.

---

## 8. Build order

Ship in this sequence. Each phase should be usable before starting the next.

- **Phase 0** — Supabase project, schema, RLS, auth (Google + email/password), profiles, role routing.
- **Phase 1** — Admin dashboard: vet and activate operators. Manage cities.
- **Phase 2** — Operator setup: stops, routes, fares (both pricing modes), schedules, vehicles, drivers.
- **Phase 3** — Departure generation (rolling 30-day window) and passenger search: city pair + date → list of departures across all operators with fares.
- **Phase 4** — Booking: the hold, the capacity function, operator approve/decline, cancellation, email notifications.
- **Phase 5** — Departure day: vehicle assignment and fleet split, driver dashboard, manifest download, completion, payment confirmation, ratings, red flags.
- **Phase 6** — In-city add-on: zones, checkout add-on, separate approval.
- **Phase 7** — Subscription tracking, then mobile apps.

**Phases 0–5 are the MVP.** That is a complete, sellable product: an operator can be onboarded, publish a timetable, take real bookings, run the day, and settle payment.

---

## 9. Directory structure

```
app/
  (public)/            search, departure detail, operator profiles
  (passenger)/         my rides, booking detail, ratings
  (operator)/          setup, bookings queue, departures, fleet
  (driver)/            today, manifest
  (admin)/             operator vetting, cities, subscriptions
  api/                 route handlers (manifest CSV export, webhooks)
lib/
  supabase/            client, server client, generated types
  booking/             fare calculation, capacity rules, status transitions
  operator/            routes, schedules, departure generation
  incity/              Phase 6 — keep isolated
  validation/          zod schemas
supabase/
  migrations/          numbered SQL migrations
  functions/           Postgres functions (request_booking, etc.)
```

Keep in-city fully isolated in its own module. Nothing in the intercity path should import from it.

---

## 10. Conventions

- Every table has RLS **enabled**. A table with RLS on and no policy denies everything — that is the correct default. Add policies deliberately, per feature.
- Mutations go through **Server Actions**, validated with Zod at the boundary. Never trust client input.
- Operator-scoped queries must always filter by the caller's operator membership, in RLS *and* in the query. Defence in depth: a bug in one layer should not leak another operator's bookings.
- The service-role key is server-only and never reaches the client bundle.
- Prices, seat counts, and status transitions are computed server-side. The client displays; it does not decide.
- Timestamps: `timestamptz` everywhere. Dates: `date`. Never `timestamp`.
- Enums live in Postgres, mirrored as TypeScript types generated from the schema.

### UI

Two audiences with opposite needs. Passengers get a **calm, mobile-first booking flow** — most will arrive on a phone from a Kijiji link, and the search-to-request path should take under a minute with no jargon. Operators and drivers get **dense, functional dashboards** — tables, filters, and fast bulk actions, used daily on a laptop or in a van.

Write interface copy in plain terms from the user's side of the screen. A button says what happens when you press it, and keeps the same word through the whole flow: "Request seat" produces "Seat requested." Empty states tell the operator what to do next. Errors say what went wrong and how to fix it.

---

## 11. Common mistakes to avoid

1. **Treating capacity as per-departure.** It is per-leg. This is the single most likely bug.
2. **Checking capacity in TypeScript.** Race condition. Use the locking Postgres function.
3. **Depending on a cron for hold expiry.** Exclude expired holds inline in the capacity query.
4. **Assuming fares are additive.** `matrix` is the default; segment prices are independent of leg prices.
5. **Assuming fares are symmetric.** A→B and B→A are separate rows.
6. **Using the live schedule's `max_seats` for an existing departure.** It is snapshotted on the departure.
7. **Exposing driver or vehicle details to passengers.** They see the operator and the time. Nothing else.
8. **Building a driver-side "post a ride" flow.** Drivers do not create rides. Operators publish schedules.
9. **Reaching for a maps or geocoding API.** Stops are a fixed operator-defined list. In-city uses flat-priced zones. No coordinates are needed anywhere in the MVP.
10. **Floats for money.** Integer cents.

---

## 12. Open decisions

- **Notifications.** MVP uses email (Resend) plus an in-app list. Given that a hold expires in an hour, SMS may prove necessary for approval alerts — revisit after the first operator is live. Build notifications behind a small `notify()` abstraction so adding a channel is one implementation, not a refactor.
- **Departure generation.** Rolling 30-day window, generated by a scheduled job. If free-tier scheduling proves awkward, generate lazily on first search for a date instead.
- **Subscription billing.** Recorded in-app, collected off-platform (e-transfer) at launch. Automate only once there are enough operators to justify it.
- **Ontario licensing and commercial passenger insurance** are the operators' responsibility, not the platform's. Worth confirming with a lawyer what the platform's own exposure is as an intermediary before going live. Not a blocker for building.
