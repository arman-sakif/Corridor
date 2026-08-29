# Corridor

A multi-tenant booking platform for intercity rideshare operators in Ontario,
sold to those operators as a subscription.

Corridor is not a rideshare business. It owns no vehicles, employs no drivers,
sets no prices, and carries no passengers. It is software sold to small
companies that already do all of that — businesses running fixed daily
timetables between Windsor and Toronto that today take every booking by phone,
text, and WhatsApp.

The product is an **aggregator**. One passenger-facing site: search
`Toronto → Windsor, Sept 3`, see every operator's departures that day side by
side, request a seat on one.

Design and rationale live in [`docs/architecture.md`](docs/architecture.md).

---

## Running it

You need Node 22+ and a Supabase project. Everything else installs.

```bash
npm install
cp .env.example .env.local     # then fill it in
npm run dev
```

### Supabase

1. Create a project at [supabase.com](https://supabase.com). The free tier is
   enough.
2. Copy the project URL and both keys from **Project settings → API** into
   `.env.local`:
   - the **publishable** key (`sb_publishable_…`) is the browser one — RLS is
     what protects the data behind it;
   - the **secret** key (`sb_secret_…`) is server-only and must never reach the
     client bundle.

   Note the URL is `https://<ref>.supabase.co`, not the dashboard link.
3. Apply the schema:

   ```bash
   npx supabase link --project-ref <your-ref>
   npx supabase db push
   ```

4. Enable **Google** and **Email** providers under **Authentication →
   Providers**, and add `http://localhost:3000/auth/callback` to the redirect
   allow list.

There is no seed data. The first thing to do is make yourself a platform admin,
which is deliberately not something the app can do — see below.

### Becoming a platform admin

`platform_role` is not writable through any policy, and a trigger blocks the
change unless it comes from a platform admin or the service role. A direct
database session is exempt — someone holding one could disable the trigger
anyway — so the first admin is granted from the SQL editor:

```sql
update public.profiles set platform_role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

Then `/admin` lets you add cities and vet operators.

### Table and function grants

This project was created with **"automatically expose new tables" off**, so
Supabase grants the API roles nothing by default and the migrations grant
everything explicitly. Two gates rather than one: `GRANT` decides whether a
role may touch a table at all, RLS decides which rows once it may.

If you create a project with that setting **on**, the app still works — you
just have Supabase's defaults sitting underneath the explicit grants. The tests
in `supabase/tests/grants.test.ts` describe the intended state either way.

### The daily job

`/api/cron` rolls the 30-day departure window forward and relabels lapsed
holds. `vercel.json` schedules it; set `CRON_SECRET` or the route stays shut.

Neither job is load-bearing. Capacity excludes expired holds inline, so seats
free themselves whether or not the sweep has run.

---

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Development server. |
| `npm run build` | Production build, including a full typecheck. |
| `npm test` | Everything — unit tests and the database tests. |
| `npm run test:unit` | Fares, capacity, money, and time. Fast. |
| `npm run test:db` | The migrations, run against a real Postgres. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run db:types` | Regenerate `lib/supabase/database.types.ts` from a live schema. |

### The database tests

`npm run test:db` applies the real migration files to
[PGlite](https://pglite.dev) — Postgres compiled to WebAssembly — with a
minimal stand-in for Supabase's `auth` schema. No Docker, no running server.

That means `request_booking()` under test is the same function that will run in
production: the row lock, the per-leg scan, and the fare recomputation are
genuinely exercised. Each call runs in its own transaction with `set local
role` and JWT claims set the way PostgREST sets them, so RLS is tested as it
will actually behave.

Three real bugs came out of writing them, including a privilege escalation that
let any signed-in user make themselves a platform admin. Run them.

---

## Where things are

```
app/
  (public)/      search, departure detail, operator profiles, sign in
  (passenger)/   my rides, booking detail, profile, ratings
  (operator)/    setup, bookings queue, departures, fleet, team
  (driver)/      today, manifest
  (admin)/       operator vetting, cities, subscriptions
  api/           manifest CSV, the daily job
lib/
  booking/       fare calculation, capacity rules, search, actions
  operator/      setup actions
  supabase/      clients and generated types
  validation/    zod schemas
supabase/
  migrations/    numbered SQL — schema, RLS, and every Postgres function
  tests/         the migrations, run against a real Postgres
```

Two rules about these boundaries:

- **`lib/booking/fares.ts` is the only module that reads `pricing_mode`.** No
  other code decides what a segment costs.
- **`lib/incity` stays isolated.** Nothing in the intercity path imports from
  it. In-city is a Phase 6 add-on and must be removable without touching the
  booking flow.

---

## The parts most likely to break

Most of this app is CRUD. Four things are not, and each has a comment at the
top of its file explaining why it is written the way it is.

**Capacity is per leg, not per departure.** A 16-seat departure can carry far
more than 16 bookings, as long as no single stretch between two stops exceeds
16. The check and the insert are one locking Postgres function — a read-then-
write in TypeScript is a race that oversells seats. `lib/booking/capacity.ts`
exists for display only and says so in its first paragraph.

**Holds expire in an hour, without a cron.** Every capacity query excludes
expired holds inline, so a seat frees itself the instant its hold lapses.
Correctness never depends on a background job.

**Fares are operator-defined, in two modes.** `matrix` is the default and the
one these businesses actually use: Toronto→Windsor is priced explicitly and is
*not* the sum of its legs. Directional fares are independent, because a route
runs one way and the return trip is a different route.

**Money is integer cents and time is Ontario time.** No floats anywhere. A
departure is a `service_date` plus a `departure_time` in America/Toronto, and
the instant is derived — a 5:00 AM departure is 5:00 AM local on both sides of
the DST change.

---

## Not in the MVP

Maps or geocoding of any kind, GPS tracking, in-app payments, door-to-door
pickup, private vehicle bookings, SMS, a matching algorithm, driver-posted
rides, and multi-operator connecting trips.

Payment happens off-platform, after the trip, between the passenger and the
driver. No money moves through Corridor.

Ontario licensing and commercial passenger insurance are the operators'
responsibility, not the platform's.
